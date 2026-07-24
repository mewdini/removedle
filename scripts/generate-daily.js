import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { runFfmpeg } from './lib/ffmpeg.js';
import { BUCKETS, readObject } from './lib/r2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../out/data');
const REGISTRY_FILE = path.join(DATA_DIR, 'song-registry.json');
const MASTERS_DIR = process.env.MASTERS_DIR || path.resolve(__dirname, '../out/masters');
const OUTPUT_BASE_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../out/dailies');
const VOLUME_THRESHOLD = -35;
const MAX_RETRIES = 5;
const DEDUPLICATE_DAYS = 5;
const MAX_PER_ALBUM = 2;
const TODAY_DATE = new Date().toISOString().split('T')[0];

function createSeededRandom(seed) {
    let hash = crypto.createHash('sha256').update(seed).digest('hex');
    let index = 0;

    return function () {
        if (index + 8 > hash.length) {
            hash = crypto.createHash('sha256').update(hash).digest('hex');
            index = 0;
        }
        const val = parseInt(hash.substring(index, index + 8), 16) / 0xffffffff;
        index += 8;
        return val;
    };
}

async function getMeanVolume(masterPath, startTime, duration) {
    let volume = -100;

    try {
        await runFfmpeg(
            [
                '-i',
                masterPath,
                '-ss',
                startTime.toString(),
                '-t',
                duration.toString(),
                '-af',
                'volumedetect',
                '-vn',
                '-f',
                'null',
                '-',
            ],
            {
                onStderr: (line) => {
                    const match = line.match(/mean_volume: ([-\d.]+) dB/);
                    if (match) {
                        volume = parseFloat(match[1]);
                    }
                },
            }
        );
        return volume;
    } catch (err) {
        console.error(`    Volume detection error: ${err.message}`);
        return -100;
    }
}

// All date arithmetic here is UTC, matching the rest of the app (challenge dates
// are UTC days). Using the local-time accessors instead is correct for fixed
// offsets but silently wrong across a DST transition: the changing offset shifts
// the computed instant by an hour, which can step over a UTC midnight. On a
// machine in a DST-observing zone, generating 2026-11-03 skipped 2026-11-01 and
// reached back to 2026-10-28, checking the wrong five days for repeats.
function getPreviousDays(dateArg) {
    const dates = [];

    for (let i = 1; i <= DEDUPLICATE_DAYS; i++) {
        const oldDate = new Date(`${dateArg}T00:00:00Z`);
        oldDate.setUTCDate(oldDate.getUTCDate() - i);
        dates.push(oldDate.toISOString().split('T')[0]);
    }

    return dates;
}

async function getPreviousSongIds(dateArg) {
    const previousSongsSet = new Set();
    const previousDates = getPreviousDays(dateArg);

    // Read via the S3 API, not over HTTP: the challenges bucket is private (it
    // holds unreleased days), so there is no public URL to fetch. Errors are NOT
    // swallowed here: a silent failure would return an empty set and quietly
    // disable de-duplication, producing a challenge that repeats recent songs.
    await Promise.all(
        previousDates.map(async (date) => {
            const raw = await readObject(BUCKETS.challenges, `${date}/meta.json`);

            if (raw === null) {
                console.log(`   No challenge stored for ${date}, skipping`);
                return;
            }

            const metaResult = JSON.parse(raw);
            metaResult.rounds?.forEach((round) => {
                previousSongsSet.add(round.songId);
            });
        })
    );

    return previousSongsSet;
}

// Two different recordings of the same song (an album cut and a single, an
// original and a remix) live under different IDs but should never share a day.
// Collapse a title to a rough key so those variants compare equal: drop
// parentheticals, keep only the part before a "+" / "/" split (medleys and
// alt titles), and strip punctuation. "Cage Girl / Camgirl" and "Cage Girl"
// both reduce to "cagegirl".
function songKey(title) {
    return title
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .split(/[+/]/)[0]
        .replace(/[^a-z0-9]/g, '');
}

async function generateDaily() {
    try {
        const dateArg = process.argv[2] || TODAY_DATE;
        console.log(`Generating challenge for: ${dateArg}`);

        console.log(`Retrieving songs for last ${DEDUPLICATE_DAYS} days of challenges...`);
        const previousSongsSet = await getPreviousSongIds(dateArg);

        const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));
        const songIds = Object.keys(registry);

        if (songIds.length < 5) {
            throw new Error('Not enough songs in registry (need at least 5)');
        }

        const random = createSeededRandom(dateArg);

        const availableIds = [...songIds];
        const selectedRounds = [];

        // Song-level de-duplication, on top of the exact-ID check above. A song
        // used in the last few days, or already chosen for today, blocks every
        // other version of itself from being picked.
        const previousTitleKeys = new Set(
            [...previousSongsSet]
                .map((id) => registry[id]?.title)
                .filter(Boolean)
                .map(songKey)
        );
        const selectedTitleKeys = new Set();

        // Cap how many rounds can come from one album in a single day, so a day
        // never leans on a single record (the whole reason the pool was widened).
        const albumCounts = new Map();

        console.log('\nSelecting and Validating Songs...');

        while (selectedRounds.length < 5 && availableIds.length > 0) {
            const idx = Math.floor(random() * availableIds.length);
            const songId = availableIds.splice(idx, 1)[0];
            const song = registry[songId];

            if (previousSongsSet.has(songId)) {
                console.log(`  - [${song.title}] Skipping since it was used previously`);
                continue;
            }

            const titleKey = songKey(song.title);
            if (previousTitleKeys.has(titleKey) || selectedTitleKeys.has(titleKey)) {
                console.log(`  - [${song.title}] Skipping another version of a recent/selected song`);
                continue;
            }

            if ((albumCounts.get(song.album) || 0) >= MAX_PER_ALBUM) {
                console.log(`  - [${song.title}] Skipping, already ${MAX_PER_ALBUM} from ${song.album}`);
                continue;
            }

            const masterPath = path.join(MASTERS_DIR, song.filename);
            const songRandom = createSeededRandom(dateArg + songId);
            const snippetConfigs = [
                { id: 1, duration: 0.5, type: 'random' },
                { id: 2, duration: 1.0, type: 'random' },
                { id: 3, duration: 3.0, type: 'start' },
            ];

            const validatedSnippets = [];
            let songOk = true;

            for (const config of snippetConfigs) {
                let startTime = 0;
                let snippetOk = false;

                for (let retry = 0; retry <= MAX_RETRIES; retry++) {
                    if (config.type === 'random' || retry > 0) {
                        const min = song.duration * 0.1;
                        const max = song.duration * 0.9 - config.duration;
                        startTime = min + songRandom() * (max - min);
                    } else {
                        startTime = 0;
                    }

                    const volume = await getMeanVolume(masterPath, startTime, config.duration);
                    if (volume >= VOLUME_THRESHOLD) {
                        validatedSnippets.push({ ...config, startTime });
                        snippetOk = true;
                        break;
                    }
                    console.log(
                        `  - [${song.title}] Snippet ${config.id} too quiet (${volume}dB) at ${startTime.toFixed(2)}s. Retry ${retry + 1}/${MAX_RETRIES}`
                    );
                }

                if (!snippetOk) {
                    songOk = false;
                    break;
                }
            }

            if (songOk) {
                selectedRounds.push({
                    songId,
                    song,
                    snippets: validatedSnippets,
                });
                selectedTitleKeys.add(titleKey);
                albumCounts.set(song.album, (albumCounts.get(song.album) || 0) + 1);
                console.log(`  + Accepted: ${song.title}`);
            } else {
                console.log(`  ! Rejected: ${song.title} (too quiet after retries)`);
            }
        }

        if (selectedRounds.length < 5) {
            throw new Error('Could not find 5 valid songs with audible snippets');
        }

        const dayDir = path.join(OUTPUT_BASE_DIR, dateArg);
        await fs.mkdir(dayDir, { recursive: true });

        console.log('\nGenerating Snippets...');

        const roundsMeta = [];

        for (let i = 0; i < selectedRounds.length; i++) {
            const { songId, song, snippets } = selectedRounds[i];
            const round = i + 1;
            const masterPath = path.join(MASTERS_DIR, song.filename);

            console.log(`Round ${round}: ${song.title}`);

            for (const snip of snippets) {
                const outputName = `round-${round}-guess-${snip.id}.opus`;
                const outputPath = path.join(dayDir, outputName);

                try {
                    await runFfmpeg([
                        // -y: overwrite without prompting. runFfmpeg gives ffmpeg
                        // no stdin, so without this a regeneration of a date whose
                        // snippet files already exist silently keeps the OLD audio
                        // (ffmpeg reads EOF at the overwrite prompt and skips the
                        // write) while meta.json updates -- new answers, stale audio.
                        '-y',
                        '-i',
                        masterPath,
                        '-ss',
                        snip.startTime.toString(),
                        '-t',
                        snip.duration.toString(),
                        '-c:a',
                        'libopus',
                        '-f',
                        'opus',
                        outputPath,
                    ]);
                } catch (err) {
                    console.error(`Error processing snippet ${outputName}:`, err);
                    throw err;
                }
                console.log(`  - Generated: ${outputName} (Start: ${snip.startTime.toFixed(2)}s)`);
            }

            roundsMeta.push({
                round,
                songId,
            });
        }

        const challengeMeta = {
            date: dateArg,
            rounds: roundsMeta,
        };

        await fs.writeFile(path.join(dayDir, 'meta.json'), JSON.stringify(challengeMeta, null, 2));

        console.log(`\nDaily challenge generation complete! Files in: ${dayDir}`);
    } catch (error) {
        console.error('Generation failed:', error);
        process.exit(1);
    }
}

generateDaily();
