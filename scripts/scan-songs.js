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
// The RAW tagged sources (masters/), not the converted out/masters/*.m4a this
// script otherwise walks. ffmpeg drops tags on FLAC -> m4a, so a few fields can
// only be read here -- see resolveReleaseDate, and readIsrc in resolve-links.js
// for the same trick. Local only: `push-masters` uploads out/masters, never
// these, so on CI this directory does not exist at all.
const SRC_MASTERS_DIR = DIRS.srcMasters;
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

// A readable credit list from whatever the tag actually holds.
//
// The source masters tag collaborations properly, as a MULTI-VALUE Vorbis ARTIST
// field (["Jane Remover", "Lucy Bedroque"]). ffmpeg cannot represent that in m4a,
// so converting flattens it to a single semicolon-joined string -- and since this
// script reads out/masters/*.m4a, that flattened form is what reached the catalog:
// two tracks rendered "Jane Remover;Lucy Bedroque" and "Jane Remover;Tinashe" in
// the browser. Same family as the ISRC and originaldate losses noted above; the
// tags are not wrong, the conversion is lossy.
//
// Deliberately normalised here rather than read back from the source master. The
// source array is not ordered the way the credit reads -- "Nasty (Match My Tweak)"
// tags ["Tinashe", "Jane Remover"], which would credit Tinashe first -- whereas the
// flattened m4a preserves the intended order. Normalising also keeps working on a
// CI runner, which pulls only out/masters and has no source files at all.
function normalizeArtist(value) {
    return (
        String(value)
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .join(', ') || 'Unknown Artist'
    );
}

// When the recording came out, for the catalog browser's release-date sort.
//
// Priority is originaldate > date > year, and the order matters -- for album
// tracks `year`/`date` are frequently the REISSUE or tagging year while
// `originaldate` carries the real one. "Census Designated - 02 - Lips.flac" tags
// year 2024 and date 2024-01-01, but the record came out 2023-10-20, which is
// exactly what its originaldate says.
//
// Coverage is uneven and that is fine: masters/ has year on 89/89 and
// originaldate on 68/89, masters/challenger/ has year on 39/48 and originaldate
// on none, so most challenger tracks resolve to a bare year and 9 resolve to
// nothing at all. The field is left off entirely in that case (undefined keys
// drop out of JSON.stringify) and the client sorts those to the end.
function normalizeReleaseDate(value) {
    if (value === undefined || value === null) return undefined;
    // Both ID3 and Vorbis allow YYYY, YYYY-MM and YYYY-MM-DD, and taggers append
    // a time component ("2023-10-20T00:00:00Z") often enough to be worth
    // tolerating. Anything not starting with a plausible year is dropped rather
    // than guessed at -- a wrong date sorts silently, which is the worst kind.
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(value).trim());
    if (!match) return undefined;
    const [, year, month, day] = match;
    if (Number(year) < 1900 || Number(year) > 2999) return undefined;
    if (month && day) return `${year}-${month}-${day}`;
    if (month) return `${year}-${month}`;
    return year;
}

// Base name -> source master path, built once. A missing directory is the normal
// CI case, not an error: `push-masters` only ever uploads out/masters, so a
// runner that ran `pull-masters` has the m4a copies and no sources whatsoever.
// Same shape as sourcePath() in resolve-links.js.
let sourceByBase = null;
let warnedNoSources = false;
async function sourcePath(filename) {
    if (!sourceByBase) {
        sourceByBase = {};
        try {
            for (const f of await fs.readdir(SRC_MASTERS_DIR)) {
                sourceByBase[f.replace(/\.[^.]+$/, '')] = path.join(SRC_MASTERS_DIR, f);
            }
        } catch {
            // Warn once and carry on. A scan must stay possible on a machine
            // without the sources -- it just falls back to the registry below.
            warnedNoSources = true;
            console.warn(
                `\n⚠ No source masters at ${SRC_MASTERS_DIR}.\n` +
                    '  Release dates will be carried forward from the registry only; tag edits\n' +
                    '  to originaldate/date/year cannot be seen from here.\n'
            );
        }
    }
    return sourceByBase[filename.replace(/\.[^.]+$/, '')] || null;
}

// Resolve one track's release date, and say WHERE it came from so the run can
// report the split.
//
// Read from the SOURCE master, never from the converted out/masters/*.m4a this
// script walks. ffmpeg drops `originaldate` on FLAC -> m4a, so the m4a's tags are
// always a subset of the source's -- the priority chain silently falls through to
// `date` there and every album track resolves to its tagging year (Lips came out
// as 2024-01-01 instead of 2023-10-20). The m4a can therefore never supply a
// value the source did not already have, which is why there is no m4a fallback
// at all: its only possible contribution is a value that is known to be wrong.
//
// When the source is unreachable, carry the registry's existing value forward
// untouched. This is NOT a hole in the "tags are the source of truth, fix it at
// the tag" rule -- it is the same precedent as `entry.isrc`, which
// resolve-links.js persists into the registry for exactly this reason: the m4a
// cannot carry the tag, so the registry is where the value lives. Without it the
// Sync Metadata workflow (which pulls m4a masters and re-scans) would recompute
// every date from tags it cannot see and wipe a correct local scan.
//
// The source WINS over the persisted value when both exist, which is the one
// place this differs from readIsrc's "persisted first". An ISRC never changes; a
// release date is a tag that can be corrected, and a fix has to be able to land.
async function resolveReleaseDate(filename, existingEntry) {
    const src = await sourcePath(filename);
    if (src) {
        try {
            const tags = (await mm.parseFile(src)).common;
            for (const candidate of [tags.originaldate, tags.date, tags.year]) {
                const normalized = normalizeReleaseDate(candidate);
                if (normalized) return { releaseDate: normalized, from: 'source' };
            }
            // The source really has no usable date. Fall through rather than
            // returning: a value already in the registry (hand-checked, or read
            // before a re-tag stripped it) is better than dropping the field.
        } catch (err) {
            console.warn(`  Could not read tags from ${path.basename(src)}: ${err.message}`);
        }
    }

    if (existingEntry?.releaseDate) {
        return { releaseDate: existingEntry.releaseDate, from: 'carried' };
    }
    return { releaseDate: undefined, from: 'none' };
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
        // Where each release date came from. Reported at the end so a run that
        // silently lost the sources (CI, or a machine without masters/) is
        // visible as a wall of "carried" rather than passing for a clean scan.
        const dateSources = { source: 0, carried: 0, none: 0 };

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
                const artist = normalizeArtist(metadata.common.artist || 'Unknown Artist');
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

                // Needs the matched entry, so it runs after identification: the
                // registry is the fallback when the source master is unreachable.
                const { releaseDate, from: dateFrom } = await resolveReleaseDate(
                    file,
                    existingEntry
                );
                dateSources[dateFrom]++;

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
                    releaseDate,
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
                //
                // releaseDate rides along for the same reason: the browser's
                // release sort would otherwise need the registry, which is not
                // something the client ever loads. It is not provenance and does
                // NOT feed a badge -- trackProvenance looks only at title and
                // album, so adding this field to every entry on the next scan
                // announces nothing.
                songList.push({
                    id: foundId,
                    title,
                    artist,
                    album: albumName,
                    releaseDate,
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
        console.log(
            `Release dates: ${dateSources.source} from source tags, ` +
                `${dateSources.carried} carried from the registry, ${dateSources.none} unknown.`
        );
        if (warnedNoSources && dateSources.carried) {
            console.warn(
                '  (carried because the source masters were unavailable -- run this scan\n' +
                    '   locally to pick up any tag corrections)'
            );
        }

        reportRetired(registry, songList);
        await reportDuplicates(registry);
    } catch (error) {
        console.error('Error scanning songs:', error);
        process.exit(1);
    }
}

scanSongs();
