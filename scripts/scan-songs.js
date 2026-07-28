import * as mm from 'music-metadata';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { encode } from '@msgpack/msgpack';
import { runFfmpeg } from './lib/ffmpeg.js';
import { modeDirs, NON_ALBUM_LABELS, parseMode } from './lib/modes.js';
import { findDuplicates } from './lib/similarity.js';
import { gameDate } from './lib/dates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODE = parseMode();
const DIRS = modeDirs(MODE);

const MASTERS_DIR = DIRS.masters;
const DATA_DIR = DIRS.data;
const COVER_DIR = DIRS.covers;
const REGISTRY_FILE = path.join(DATA_DIR, 'song-registry.json');

const SONGLIST_OUTPUT_FILE = path.join(DATA_DIR, 'songs.json');
const SONGLIST_MIN_OUTPUT_FILE = path.join(DATA_DIR, 'songs.min.json');
const COVERS_OUTPUT_FILE = path.join(DATA_DIR, 'covers.json');
const COVERS_MIN_OUTPUT_FILE = path.join(DATA_DIR, 'covers.min.json');

const SUPPORTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg'];

// The live game day, not the calendar day. The catalog browser measures its
// "new for 14 days" window by comparing these stamps against the same reckoning
// on the client, so a scan published after 21:00 PT has to agree with the day the
// player is being shown or the badge reads as a day old the moment it appears.
const TODAY = gameDate();

// Provenance for the in-game catalog browser, which badges recent arrivals and
// retitles so it doubles as a changelist.
//
// Three cases, and the middle one is what makes this need no backfill script:
//   - no existing entry            -> genuinely new, stamp today
//   - existing entry, no addedAt   -> predates this field, so it was in the
//                                     catalog at launch: stamp the mode's day 1
//   - existing entry with addedAt  -> carry it, forever
// Seeding the launch batch with startDate rather than today is what stops the
// first scan after this change from badging all 137 tracks as new, and the
// browser treats "added on day 1" as the baseline rather than as an event.
//
// Only TITLE and ALBUM changes count as an update. Both are player-visible (the
// title is literally the answer they type, the album picks the cover art), and
// both are rare and deliberate -- the `untitled` -> `BEGGIN ON YOUR KNEES` fix
// is exactly the case worth surfacing. contentHash changes are excluded on
// purpose: a re-tag or re-encode moves the hash without changing anything a
// player can see, and those happen often enough to drown the list.
//
// Returns the fields to persist SEPARATELY from whether the change happened on
// this run, because `previousTitle` is carried forward forever once set --
// reading it back as "a retitle just happened" would re-announce the same edit
// in the scan log on every run from now on.
function trackProvenance(existingEntry, title, albumName) {
    if (!existingEntry) {
        return { fields: { addedAt: TODAY }, retitled: false, rebadged: false };
    }

    const addedAt = existingEntry.addedAt || MODE.startDate;
    const retitled = existingEntry.title !== title;
    const rebadged = existingEntry.album !== albumName;

    // A change record replaces the previous one wholesale rather than merging,
    // so `previousAlbum` never lingers next to a later title-only edit and
    // describes a change that is two revisions old.
    if (retitled || rebadged) {
        return {
            fields: {
                addedAt,
                updatedAt: TODAY,
                previousTitle: retitled ? existingEntry.title : undefined,
                previousAlbum: rebadged ? existingEntry.album : undefined,
            },
            retitled,
            rebadged,
        };
    }

    return {
        fields: {
            addedAt,
            updatedAt: existingEntry.updatedAt,
            previousTitle: existingEntry.previousTitle,
            previousAlbum: existingEntry.previousAlbum,
        },
        retitled: false,
        rebadged: false,
    };
}

async function getFileHash(filePath) {
    const content = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

// Cover file names are derived from the album name. The replacement is kept
// exactly as it always was so existing slugs (and the R2 objects behind them)
// do not move -- the only addition is a fallback for names that contain no
// alphanumerics at all, which used to collapse to a single "-.webp" shared by
// every such album. The fallback hashes the name rather than using a song id so
// it stays stable no matter which track of the album is scanned first.
function albumSlug(albumName) {
    const slug = albumName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (/[a-z0-9]/.test(slug)) return slug;
    return `album-${crypto.createHash('sha256').update(albumName).digest('hex').slice(0, 8)}`;
}

// Some tags are filing labels, not records ("Singles"). Under a mode that opts
// in, a track tagged with one becomes its own one-track album keyed by its
// title. That makes generate-daily's per-album cap meaningful (it would
// otherwise treat the whole loosies pile as a single record and starve the
// selection), and gives each track its own cover instead of one shared image.
// The one-track grouping also sets isSingle, which the UI already uses to hide
// the album line.
function effectiveAlbum(albumName, title) {
    if (MODE.singlesAsOwnAlbum && NON_ALBUM_LABELS.has(albumName)) return title;
    return albumName;
}

async function extractArt(songPath, albumName, metadata) {
    const slug = albumSlug(albumName);
    const outputPath = path.join(COVER_DIR, `${slug}.webp`);

    try {
        await fs.access(outputPath);
        return `/art/${slug}.webp`;
    } catch {
        if (metadata.common.picture && metadata.common.picture.length > 0) {
            const picture = metadata.common.picture[0];
            console.log(`  Extracting art from metadata for ${albumName}...`);

            const imgExt = picture.format === 'image/png' ? '.png' : '.jpg';
            const tempInput = path.join(path.dirname(outputPath), `temp-${slug}${imgExt}`);
            await fs.writeFile(tempInput, picture.data);

            try {
                await runFfmpeg([
                    '-i',
                    tempInput,
                    '-frames:v',
                    '1',
                    '-vf',
                    'scale=80:80',
                    outputPath,
                ]);
                await fs.unlink(tempInput).catch(() => {});
                return `/art/${slug}.webp`;
            } catch (err) {
                console.warn(`  Could not convert art for ${albumName}: ${err.message}`);
                await fs.unlink(tempInput).catch(() => {});
                return null;
            }
        }

        console.log(`  No embedded cover art found for ${albumName}.`);
        return null;
    }
}

// Two masters that are the same recording are invisible to everything else: the
// tags differ, the content hashes differ, and generate-daily's songKey does not
// collapse them -- so the same audio can become the answer to two days, or even
// to two rounds of one day. Warn rather than fail: a false positive must not
// block a scan, and the fix (retire one master, delete its registry entry) is a
// judgement call.
async function reportDuplicates(registry) {
    const tracks = Object.entries(registry).map(([id, e]) => ({
        id,
        title: e.title,
        duration: e.duration,
        file: path.join(MASTERS_DIR, e.filename),
    }));

    const { pairs, compared } = await findDuplicates(tracks);
    if (!compared) return;

    if (!pairs.length) {
        console.log(`Duplicate check: ${compared} similar-length pair(s) compared, none matched.`);
        return;
    }

    console.warn(`\n⚠ Possible duplicate recordings (${pairs.length}):`);
    for (const p of pairs) {
        console.warn(`   ${p.score.toFixed(3)}  "${p.a.title}" (${p.a.id})`);
        console.warn(`          == "${p.b.title}" (${p.b.id})`);
    }
    console.warn(
        '  Same audio under two ids can be drawn as two rounds of one day. To retire one:\n' +
            '  move its master out of masters/<mode>/, DELETE its entry from song-registry.json\n' +
            '  (scan never removes entries), then regenerate any day that referenced it.'
    );
}

// The registry is a superset of the catalog: this script only ever adds and
// updates, so an entry whose master has been moved out of the masters directory
// is carried forward untouched and silently outlives the track.
//
// generate-daily.js now refuses to draw those (its pool is the catalog, not the
// registry), so a leftover row can no longer produce an unguessable round. It is
// still dead weight that makes the two files disagree, and only a human can
// decide whether a master went missing on purpose, so say so.
function reportRetired(registry, songList) {
    const live = new Set(songList.map((s) => s.id));
    const retired = Object.keys(registry).filter((id) => !live.has(id));
    if (!retired.length) return;

    console.warn(`\n⚠ ${retired.length} registry entr(y/ies) have no master in ${MASTERS_DIR}:`);
    for (const id of retired) {
        console.warn(`   ${id}  "${registry[id].title}"  (${registry[id].filename})`);
    }
    console.warn(
        '  They are excluded from the catalog and from daily generation. If a track was\n' +
            '  retired on purpose, DELETE its entry from song-registry.json to match; if not,\n' +
            '  the master is missing and should be restored before the next scan.'
    );
}

async function scanSongs() {
    try {
        console.log(`Mode: ${MODE.id}`);
        console.log(`Scanning directory: ${MASTERS_DIR}`);
        const files = await fs.readdir(MASTERS_DIR);

        let registry = {};
        try {
            registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));
        } catch (_) {
            console.warn('No registry found. Please run bootstrap-registry.js first.');
            process.exit(1);
        }

        const songList = [];
        const albumsMap = new Map();

        await fs.mkdir(path.dirname(SONGLIST_OUTPUT_FILE), { recursive: true });
        await fs.mkdir(COVER_DIR, { recursive: true });

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (SUPPORTED_EXTENSIONS.includes(ext)) {
                const fullPath = path.join(MASTERS_DIR, file);
                console.log(`Processing: ${file}...`);

                const metadata = await mm.parseFile(fullPath);
                const title = metadata.common.title || path.basename(file, ext);
                const albumName = effectiveAlbum(metadata.common.album || 'Unknown Album', title);
                const artist = metadata.common.artist || 'Unknown Artist';
                const duration = Math.floor(metadata.format.duration * 1000) / 1000;
                const contentHash = await getFileHash(fullPath);

                let foundId = null;
                let existingEntry = null;

                // match file name
                for (const [id, entry] of Object.entries(registry)) {
                    if (entry.filename === file) {
                        foundId = id;
                        existingEntry = entry;
                        break;
                    }
                }

                // match file hash
                if (!foundId) {
                    for (const [id, entry] of Object.entries(registry)) {
                        if (entry.contentHash === contentHash) {
                            foundId = id;
                            existingEntry = entry;
                            console.log(
                                `  Detected rename (hash match): ${entry.filename} -> ${file}`
                            );
                            break;
                        }
                    }
                }

                // match title + artist
                if (!foundId) {
                    for (const [id, entry] of Object.entries(registry)) {
                        if (entry.title === title && entry.artist === artist) {
                            foundId = id;
                            existingEntry = entry;
                            console.log(
                                `  Detected rename/mod (metadata match): ${entry.filename} -> ${file}`
                            );
                            break;
                        }
                    }
                }

                // it is a new song
                if (!foundId) {
                    foundId = crypto.randomBytes(6).toString('hex');
                    console.log(`  New song detected. Assigned ID: ${foundId}`);
                }

                const provenance = trackProvenance(existingEntry, title, albumName);
                if (provenance.retitled) {
                    console.log(`  Retitled: "${existingEntry.title}" -> "${title}"`);
                }
                if (provenance.rebadged) {
                    console.log(`  Album changed: "${existingEntry.album}" -> "${albumName}"`);
                }

                registry[foundId] = {
                    filename: file,
                    title,
                    artist,
                    album: albumName,
                    duration,
                    contentHash,
                    // Owned by scan-songs.js like the master fields above, not by
                    // resolve-links.js: they are derived from the tags and from
                    // what the previous scan saw, so nothing else writes them.
                    ...provenance.fields,
                    links: existingEntry?.links || {},
                    // Preserve resolve-links.js state across re-scans (undefined
                    // keys drop out of JSON). scan-songs.js owns only the master
                    // fields above; these link fields belong to resolve-links.js
                    // and are carried untouched so a re-scan never clobbers link
                    // health: the ISRC read from source masters, the dated "no
                    // hit" stamps per source, and the hidden dead links.
                    isrc: existingEntry?.isrc,
                    tried: existingEntry?.tried,
                    deadLinks: existingEntry?.deadLinks,
                    coderived: existingEntry?.coderived,
                    // Cautious-resolution state (strict link policy): candidates
                    // awaiting a human accept/reject, URLs a human already
                    // rejected, and the "zero links is expected here" marker.
                    // Manual triage is stored in the registry, so leaving these
                    // out would make the next scan silently discard the review.
                    needsReview: existingEntry?.needsReview,
                    rejectedLinks: existingEntry?.rejectedLinks,
                    linksOptional: existingEntry?.linksOptional,
                };

                const slug = albumSlug(albumName);
                await extractArt(fullPath, albumName, metadata);

                if (!albumsMap.has(slug)) {
                    albumsMap.set(slug, {
                        name: albumName,
                        file: `${slug}.webp`,
                        isSingle: true,
                    });
                } else {
                    let album = albumsMap.get(slug);
                    album.isSingle = false;
                    albumsMap.set(slug, album);
                }

                // Published so the catalog browser can badge and sort without a
                // second manifest. Undefined keys drop out of JSON.stringify, so
                // an unchanged track costs one extra field, not four.
                songList.push({
                    id: foundId,
                    title,
                    artist,
                    album: albumName,
                    links: registry[foundId].links,
                    ...provenance.fields,
                });
            }
        }

        await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));

        const albums = Array.from(albumsMap.values());

        await fs.writeFile(SONGLIST_OUTPUT_FILE, JSON.stringify(songList, null, 2));
        await fs.writeFile(SONGLIST_MIN_OUTPUT_FILE, encode(songList));

        await fs.writeFile(COVERS_OUTPUT_FILE, JSON.stringify(albums, null, 2));
        await fs.writeFile(COVERS_MIN_OUTPUT_FILE, encode(albums));

        console.log(`\nSuccess! Generated manifest for ${songList.length} songs.`);
        console.log(`Output saved to: ${SONGLIST_OUTPUT_FILE}`);

        reportRetired(registry, songList);
        await reportDuplicates(registry);
    } catch (error) {
        console.error('Error scanning songs:', error);
        process.exit(1);
    }
}

scanSongs();
