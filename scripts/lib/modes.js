import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// Game modes. Everything that differs between them lives here, so the pipeline
// scripts stay single-copy and thread a mode object through instead.
//
// `normal` is the original game and its values are deliberately the empty/legacy
// ones: no key prefix, no storage prefix, no seed prefix, and the same on-disk
// paths it has always used. That is what keeps already-published R2 keys, already
// generated challenges and live players' data byte-for-byte unchanged.
export const MODES = {
    normal: {
        id: 'normal',
        label: 'Normal',
        // R2 key prefix, with trailing slash. '' means "at the bucket root".
        prefix: '',
        // Sub-directory of masters/ holding this mode's source audio.
        srcDir: '',
        startDate: '2026-07-24',
        // Mixed into the daily PRNG seed. MUST stay '' for normal: changing it
        // re-rolls every past and future day's song selection.
        seedPrefix: '',
        // 'permissive' = the original resolver behaviour. 'strict' = never
        // publish a link we are not sure about; see scripts/resolve-links.js.
        linkPolicy: 'permissive',
        // When true, tracks tagged with a non-album label (e.g. "Singles") are
        // treated as their own one-track album, keyed by title.
        singlesAsOwnAlbum: false,
    },
    challenger: {
        id: 'challenger',
        label: 'Challenger',
        prefix: 'challenger/',
        srcDir: 'challenger',
        startDate: '2026-07-24',
        seedPrefix: 'challenger:',
        linkPolicy: 'strict',
        singlesAsOwnAlbum: true,
        // SoundCloud accounts that exist to archive THIS artist. Most of this
        // catalog was never officially released, so re-uploads are the only
        // thing that exists -- but a search hit from an arbitrary account is
        // exactly the wrong-link the strict policy forbids. The compromise is a
        // hand-curated allowlist swept catalog-first (same shape as the official
        // profile sweep) and accepted only on an exact title match.
        //
        // Names this artist has released under. Re-uploads of pre-2022 material
        // are almost always credited to the old name rather than the current one,
        // so a resolver that only ever searches "Jane Remover" and only accepts a
        // channel containing "jane remover" cannot see them at all.
        //
        //   dltzk        the pre-June-2022 stage name; most of this catalog's era
        //   leroy        the dariacore side project
        //   high zoey    the "No Words, Just A Picture Of Me" EP and the
        //                robloxcore tracks -- both are albums in THIS catalog
        //   h8p8ge       the garage/DnB side project
        //   jamie        earliest material (a track here is titled "Jamie - ...")
        //   venturia online support system / venturing
        //                the remix + experimental-cover project, then indie rock
        //
        // Used to widen search QUERIES and to accept a channel/uploader credited
        // to any of them. It never relaxes the title match.
        //
        // "JR" is deliberately EXCLUDED: matching is substring-based on the
        // normalised text, and "jr" occurs inside unrelated names ("DJ Rex" ->
        // "djrex"), so it would credit the artist for arbitrary uploaders.
        // Taken from the community lore list (rateyourmusic.com/list/romance/
        // jane-remover-lore-list). That list deliberately omits one early
        // comedy-rap alias at the artist's request; it is omitted here too, and
        // should not be added -- the material is deleted and the artist has
        // asked for it not to be connected to them.
        artistAliases: [
            'dltzk',
            'high zoey',
            'leroy',
            'h8p8ge',
            'jamison bleached waters',
            'venturia online support system',
            'venturing',
            'coolgirl 9',
            'jamie',
            'mondai1112',
            'inka-yami',
        ],
        // Every account here was corroborated before being added: it turned up
        // holding several DIFFERENT tracks from this catalog under their exact
        // titles. Do not add an account just because it matched one song.
        archiveAccounts: [
            'user-883875226', // "Jane Remover archive"
            'jane-remover-149364304', // "jane remover archive"
            'personalpalace',
            'jane-reuploader',
            'eriased',
            'iphone3user',
            'adfgdfgaf',
            'elitank',
            'agr1a', // "chews" -- surfaced via the playlist, now carries 4 catalog tracks
        ],
        // Curated SoundCloud PLAYLISTS of this artist's unreleased material.
        // Swept exactly like archiveAccounts and held to the same guards, but
        // they reach further: a playlist collects re-uploads from accounts that
        // would never be worth allowlisting on their own.
        archivePlaylists: ['https://soundcloud.com/farewell11/sets/jane-unreleased'],
    },
};

export const DEFAULT_MODE = MODES.normal;

// Album tags that are filing labels rather than records. Under
// `singlesAsOwnAlbum` a track tagged with one of these gets its title as its
// effective album, so it groups, caps and gets cover art as its own release.
export const NON_ALBUM_LABELS = new Set(['Singles', 'Singles & EPs', 'Loosies']);

// Local directory layout.
//
// masters/data/covers are mode-rooted (out/<mode>/...) because the R2 push
// helpers walk recursively: if challenger data lived at out/data/challenger,
// normal's push-data would walk into it and re-upload challenger manifests from
// whatever stale copy happened to be on disk.
//
// dailies instead mirror the R2 key space (out/dailies/challenger/<date>), because
// link-assets junctions static/challenges -> out/dailies wholesale and the dev
// URL has to match production exactly. The recursive-walk hazard there is handled
// explicitly by syncPush's excludeDirs.
export function modeDirs(mode) {
    const sub = (base, name) =>
        mode.prefix ? path.join(base, mode.id, name) : path.join(base, name);

    return {
        masters: process.env.MASTERS_DIR || sub(path.join(ROOT, 'out'), 'masters'),
        data: process.env.DATA_DIR || sub(path.join(ROOT, 'out'), 'data'),
        covers: process.env.COVERS_DIR || sub(path.join(ROOT, 'out'), 'covers'),
        dailies:
            process.env.OUTPUT_DIR || path.join(ROOT, 'out', 'dailies', mode.srcDir ? mode.id : ''),
        // Raw tagged sources, not the converted out/masters copies. ffmpeg drops
        // ISRC on FLAC->m4a, so the link resolver reads tags from here.
        srcMasters: process.env.SRC_MASTERS_DIR || path.join(ROOT, 'masters', mode.srcDir),
    };
}

const DIR_ENV_VARS = ['MASTERS_DIR', 'DATA_DIR', 'COVERS_DIR', 'OUTPUT_DIR', 'SRC_MASTERS_DIR'];

// A stray inherited DATA_DIR=./out/data would make `scan --mode=challenger`
// rewrite the NORMAL registry with challenger songs, destroying 89 permanent
// song IDs that every historical meta.json references. Refuse rather than
// silently obey an override that clearly belongs to another mode.
function guardEnvOverrides(mode) {
    if (mode.id === DEFAULT_MODE.id) return;

    for (const name of DIR_ENV_VARS) {
        const value = process.env[name];
        if (!value) continue;
        if (!value.replace(/\\/g, '/').includes(mode.id)) {
            console.error(
                `Refusing to run: ${name}=${value} does not look like a ${mode.id} path.\n` +
                    `Unset it, or point it somewhere containing "${mode.id}".`
            );
            process.exit(1);
        }
    }
}

// Resolve the mode for a script run: `--mode=challenger`, or MODE=challenger.
export function parseMode(argv = process.argv) {
    const arg = argv.find((a) => a.startsWith('--mode='));
    const id = (arg ? arg.split('=')[1] : process.env.MODE) || DEFAULT_MODE.id;
    const mode = MODES[id];

    if (!mode) {
        console.error(`Unknown mode: ${id}. Expected one of: ${Object.keys(MODES).join(', ')}`);
        process.exit(1);
    }

    guardEnvOverrides(mode);
    return mode;
}

export function modeById(id) {
    return MODES[id] || null;
}

// Key prefixes owned by every OTHER mode. A mode pulling from a shared bucket
// must exclude these, or it drags another mode's objects into its local tree and
// re-uploads them on the next (wholesale-overwrite) push.
export function otherPrefixes(mode) {
    return Object.values(MODES)
        .filter((m) => m.id !== mode.id && m.prefix)
        .map((m) => m.prefix);
}

// Push prefixes carry no trailing slash: the push helpers path.join them.
export function pushPrefix(mode, sub = '') {
    return [mode.prefix.replace(/\/$/, ''), sub].filter(Boolean).join('/');
}

// Top-level directory names owned by other modes, for excluding from a
// recursive push of a shared local root (out/dailies).
export function otherModeDirNames(mode) {
    return Object.values(MODES)
        .filter((m) => m.id !== mode.id && m.srcDir)
        .map((m) => m.id);
}
