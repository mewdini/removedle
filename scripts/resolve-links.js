// Populate `links` on each song in song-registry.json, so the game's results
// screen and the 404 attribution can show streaming links.
//
// Resolution order (fill MISSING platforms; hand-added links are never touched):
//   1. MusicLink (https://ml.jadquir.com, Songlink/Odesli successor) by ISRC.
//      Fills ~6 platforms for official releases. Attribution lives in the README.
//      Runs FIRST and only when needed, to protect the 300/mo cap (see below).
//   2. Bandcamp: scrape janeremover.bandcamp.com/music ONCE into a title -> URL
//      map, then match every track (no lookup API exists). Mostly the official
//      ISRC releases, but the loosies are checked against it too.
//   3. SoundCloud: api-v2 search (client_id scraped from the site) for every
//      track still missing a soundcloud link -- most tracks live there, and the
//      ones that don't usually have unofficial re-uploads.
//   4. YouTube is resolved SEPARATELY from YouTube Music: `youtube` is the real
//      music video (official YouTube Data API, so cron-safe), `youtubeMusic` is
//      the Art Track -- the "<artist> - Topic" Song, via YT Music's internal
//      search (unofficial, local only). MusicLink co-derives the two (one video
//      id, both URLs), which is wrong wherever a distinct Art Track exists, so
//      fixYouTube reconciles them -- co-deriving + flagging entry.coderived only
//      as a last-resort fallback.
//   Bandcamp/SoundCloud/YouTube-Music scrape, so they are fragile -- see --verify.
//
// Modes:
//   pnpm links               LOCAL: fill missing platforms via MusicLink + the
//                            Bandcamp/SoundCloud scrapers (incremental).
//   pnpm links --verify      LEAN CRON: HEAD-check every existing link; heal a
//                            dead one via MusicLink/Data API (no fragile scraping);
//                            and HIDE what can't be healed by moving it to
//                            entry.deadLinks, out of the client-facing links and
//                            marked heal-attempted. Patches songs.json so the hide
//                            publishes without a masters-dependent `pnpm scan`.
//                            Records hidden links in out/data/link-issues.json.
//   pnpm links --fix-youtube LOCAL: reconcile youtube (real video) vs youtubeMusic
//                            (Art Track) across the catalog -- corrects MusicLink's
//                            co-derived pair. Uses YT Music's internal search.
//   --only=<id,...>          Scope any mode to specific song ids.
//   --challenge=<date>       Scope to the songs in out/dailies/<date>/meta.json --
//                            used to verify a day's challenge tracks before publish.
//
// Link policy (per mode, see scripts/lib/modes.js):
//   permissive (normal)   the behaviour described above.
//   strict (challenger)   the catalog is leaks, demos, remixes and covers. Few
//                         have official uploads and some are not online at all,
//                         so a plausible-but-wrong link is worse than no link --
//                         it spoils the answer on the results screen. Under
//                         strict, only authoritative sources auto-publish (ISRC
//                         via MusicLink, the artist's own SoundCloud profile,
//                         Bandcamp, a title+channel-matched YouTube video). A
//                         loose match is NEVER written to `links`; it goes to
//                         entry.needsReview for a human to accept or reject, and
//                         nothing is ever co-derived. Songs that have been swept
//                         and genuinely missed everywhere get entry.linksOptional
//                         so "no links" stops being reported as a problem.
//
// This script owns ONLY the registry's link fields (links, deadLinks, tried,
// isrc, coderived, needsReview, rejectedLinks, linksOptional); scan-songs.js owns
// the master fields. They never write the same keys, so the two can alternate on
// the shared registry -- provided each starts from a fresh pull-data (pull-data
// before a scan or --verify, push after).
//
// MUSICLINK_API_KEY + YOUTUBE_API_KEY come from .env (server-side only; never
// client, never committed). ISRCs are read from the master files in out/masters.

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mm from 'music-metadata';
import { encode } from '@msgpack/msgpack';
import { modeDirs, parseMode } from './lib/modes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODE = parseMode();
const DIRS = modeDirs(MODE);
const STRICT = MODE.linkPolicy === 'strict';

const DATA_DIR = DIRS.data;
// ISRC lives in the SOURCE files (masters/), not the converted out/masters/*.m4a
// (ffmpeg drops the tag on FLAC -> m4a). Read the source by base name.
const SRC_MASTERS_DIR = DIRS.srcMasters;
const REGISTRY_FILE = path.join(DATA_DIR, 'song-registry.json');
const ISSUES_FILE = path.join(DATA_DIR, 'link-issues.json');
// Client-facing catalog derived from the registry; `--verify` patches its links
// in place (no masters / no full scan) so a lean cron can publish heals + hides.
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const SONGS_MIN_FILE = path.join(DATA_DIR, 'songs.min.json');

const ML_KEY = process.env.MUSICLINK_API_KEY;
const YT_KEY = process.env.YOUTUBE_API_KEY;
const VERIFY = process.argv.includes('--verify');
const FIX_YT = process.argv.includes('--fix-youtube');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
// Scope a run to specific songs: --only=<id,id,...> directly, or --challenge=<date>
// to resolve the ids from that day's out/dailies/<date>/meta.json. Used by the
// daily pipeline to verify a challenge's tracks before it goes live.
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY_IDS = onlyArg ? onlyArg.split('=')[1].split(',').filter(Boolean) : [];
const challengeArg = process.argv.find((a) => a.startsWith('--challenge='));
const CHALLENGE_DATE = challengeArg ? challengeArg.split('=')[1] : null;
const DAILIES_DIR = DIRS.dailies;

// MusicLink link key -> the app's StreamingLinks key (src/lib/interfaces.ts)
const ML_MAP = {
    spotify: 'spotify',
    apple_music: 'appleMusic',
    soundcloud: 'soundcloud',
    tidal: 'tidal',
    youtube: 'youtube',
    youtube_music: 'youtubeMusic',
    bandcamp: 'bandcamp',
};

const UA = 'Mozilla/5.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Scraper fetches can hang; cap every request so one stuck socket can't stall
// the whole batch. Returns a normal Response, or throws on timeout/network.
const fetchT = (url, opts = {}, ms = 15000) =>
    fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
const hasLinks = (l) => l && Object.values(l).some((v) => typeof v === 'string' && v.trim());
// spotify/appleMusic/tidal/youtube only ever come from MusicLink here, so their
// presence means MusicLink already ran successfully for this track -- used to
// avoid re-billing the cap regardless of what the scrape adapters have filled.
const musicLinked = (l) => !!(l.spotify || l.appleMusic || l.tidal || l.youtube);

// A confirmed "no hit" for a source is stamped with the date on entry.tried[source]
// so we stop re-querying it until it goes stale (in case the track appears later).
const STALE_DAYS = 30;
// How many of the artist's other names to re-query on YouTube when the primary
// name finds nothing. SoundCloud is unmetered so it tries them all; the YouTube
// Data API is not.
const YT_ALIAS_ATTEMPTS = 3;
const today = () => new Date().toISOString().slice(0, 10);
function triedRecently(entry, source) {
    const d = entry.tried?.[source];
    if (!d) return false;
    return (Date.now() - new Date(d).getTime()) / 86400000 < STALE_DAYS;
}
// --- manual review queue (strict policy) ------------------------------------
// A candidate that matches too loosely to publish is parked on
// entry.needsReview[platform] until a human accepts it (moves the url into
// entry.links) or rejects it (moves it into entry.rejectedLinks[platform], which
// stops it ever being proposed again). scripts/link-review.js does both.
const MAX_REVIEW_PER_PLATFORM = 5;

function isRejected(entry, platform, url) {
    return !!entry.rejectedLinks?.[platform]?.includes(url);
}

function recordReview(entry, candidates) {
    for (const c of candidates) {
        if (!c?.url || !c.platform) continue;
        if (isRejected(entry, c.platform, c.url)) continue;
        if (entry.links?.[c.platform]) continue;

        entry.needsReview = entry.needsReview || {};
        const list = (entry.needsReview[c.platform] = entry.needsReview[c.platform] || []);
        if (list.some((existing) => existing.url === c.url)) continue;
        if (list.length >= MAX_REVIEW_PER_PLATFORM) continue;
        list.push({
            url: c.url,
            title: c.title || '',
            uploader: c.uploader || '',
            source: c.source || '',
            seen: today(),
        });
    }
}

// A platform that now has a real link no longer needs triage.
function clearReview(entry, platforms) {
    if (!entry.needsReview) return;
    for (const p of platforms) delete entry.needsReview[p];
    if (Object.keys(entry.needsReview).length === 0) delete entry.needsReview;
}

// Never re-publish something a human already threw out.
function dropRejected(entry, links) {
    const kept = {};
    for (const [platform, url] of Object.entries(links || {})) {
        if (isRejected(entry, platform, url)) continue;
        kept[platform] = url;
    }
    return kept;
}

// Run one source; merge any links found. On a genuine miss (ok with no links)
// stamp entry.tried[source] with today's date. A failed request (ok:false) is
// left unstamped so it retries on the next run. Ambiguous candidates (strict
// policy) come back as `review` and are queued rather than published -- they
// still count as a confirmed miss for the purposes of the dated stamp, so the
// source is not re-queried until the stamp goes stale.
async function trySource(entry, source, fn) {
    const { ok, links, review } = await fn();
    const offered = dropRejected(entry, links);

    // FILL ONLY -- never replace a link that is already there. A source can
    // return several platforms at once (MusicLink returns up to 7), so a call
    // made to fill a missing `bandcamp` could otherwise silently overwrite a
    // hand-picked `soundcloud` with whatever the API happened to have. Curated
    // links are the whole point of the strict policy; nothing automatic may
    // clobber them.
    const publishable = {};
    for (const [platform, url] of Object.entries(offered)) {
        const existing = entry.links[platform];
        if (typeof existing === 'string' && existing.trim()) continue;
        publishable[platform] = url;
    }

    if (Object.keys(publishable).length) {
        Object.assign(entry.links, publishable);
        if (entry.tried) delete entry.tried[source];
        clearReview(entry, Object.keys(publishable));
        return true;
    }
    // The source did answer with something; it was just already covered. That is
    // still a successful lookup, so clear any stale miss-marker.
    if (Object.keys(offered).length) {
        if (entry.tried) delete entry.tried[source];
        return true;
    }
    if (review?.length) recordReview(entry, review);
    if (ok) {
        entry.tried = entry.tried || {};
        entry.tried[source] = today();
    }
    return false;
}

let sourceByBase = null;
async function sourcePath(filename) {
    if (!sourceByBase) {
        sourceByBase = {};
        try {
            for (const f of await fs.readdir(SRC_MASTERS_DIR)) {
                sourceByBase[f.replace(/\.[^.]+$/, '')] = path.join(SRC_MASTERS_DIR, f);
            }
        } catch {
            /* no source dir (e.g. CI) -> rely on entry.isrc persisted earlier */
        }
    }
    return sourceByBase[filename.replace(/\.[^.]+$/, '')] || null;
}

// Prefer a persisted isrc (survives to R2/CI); otherwise read it from the source
// master and cache it onto the entry so it is published on the next push-data.
async function readIsrc(entry) {
    if (entry.isrc) return entry.isrc;
    const src = await sourcePath(entry.filename);
    if (!src) return null;
    try {
        const isrc = ((await mm.parseFile(src)).common.isrc || [])[0] || null;
        if (isrc) entry.isrc = isrc;
        return isrc;
    } catch {
        return null;
    }
}

// --- Source 2: MusicLink by ISRC -------------------------------------------
// Every adapter returns { ok, links }. ok:false means the request itself failed
// (network/429/malformed) -> caller should retry later, NOT record a miss.
// ok:true with empty links means a genuine "nothing found" -> record a dated miss.
async function musiclinkByIsrc(isrc) {
    if (!ML_KEY) throw new Error('MUSICLINK_API_KEY not set (see .env.example)');

    // Retry once on an empty result: the first lookup of an unindexed ISRC can
    // return success with no links while it resolves, then fill on a second call.
    for (let attempt = 1; attempt <= 2; attempt++) {
        let res;
        try {
            res = await fetchT(`https://api.ml.jadquir.com/v1/lookup/isrc/${isrc}`, {
                headers: { Authorization: `Bearer ${ML_KEY}` },
            });
        } catch (e) {
            // A timeout or socket error is a failed REQUEST, not a "no hit". Every
            // other adapter honours that contract; this one used to let the
            // exception escape, which aborted main() before it wrote the registry
            // -- losing the whole run's work (and reddening the cron) because one
            // API call was slow.
            console.warn(`  musiclink: request failed for ${isrc} (${e.message})`);
            return { ok: false, links: {} };
        }
        if (res.status === 429) {
            await sleep(3000);
            continue;
        }
        // 404 is this API's authoritative "no such track", not a failure: the
        // ISRC is simply not in any streaming catalog. Return it as a confirmed
        // miss so the caller records a dated stamp -- otherwise every run
        // re-queries the same never-distributed track forever, burning the
        // 300/mo cap. Unreleased material tagged with an ISRC hits this a lot.
        if (res.status === 404) return { ok: true, links: {} };
        if (!res.ok) return { ok: false, links: {} };

        const body = await res.json().catch(() => null);
        if (!body) return { ok: false, links: {} };
        const item = Array.isArray(body.data) ? body.data[0] : body.data;
        const links = item?.links || {};
        const mapped = {};
        for (const [mlKey, appKey] of Object.entries(ML_MAP)) {
            if (typeof links[mlKey] === 'string' && links[mlKey].trim()) {
                mapped[appKey] = links[mlKey];
            }
        }
        if (Object.keys(mapped).length === 0 && attempt === 1) {
            await sleep(2500);
            continue;
        }
        return { ok: true, links: mapped };
    }
    return { ok: false, links: {} }; // exhausted retries (429) -> treat as failure
}

// --- Sources 2-4: best-effort scrape adapters (fragile; guarded by --verify) -
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const decodeHtml = (s) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

// Bandcamp has no lookup API. Scrape the whole discography ONCE: the /music grid
// links to every release, and each album/track page embeds a `data-tralbum` JSON
// with the track list and per-track URLs. Build a normalized-title -> URL map and
// reuse it for every song. { ok:false } only if the discography itself won't load
// (so we don't stamp misses on a network blip); an empty map with ok:true is a
// real "artist page has no tracks" and lets misses be recorded.
const BANDCAMP_ROOT = 'https://janeremover.bandcamp.com';
let bandcampCache = null;
async function bandcampCatalog() {
    if (bandcampCache) return bandcampCache;
    const map = new Map();
    try {
        const res = await fetchT(`${BANDCAMP_ROOT}/music`, { headers: { 'User-Agent': UA } });
        if (!res.ok) {
            console.warn(`  bandcamp: catalog fetch failed (HTTP ${res.status}) -- skipping`);
            return (bandcampCache = { ok: false, map });
        }
        const html = await res.text();
        const hrefs = new Set();
        for (const m of html.matchAll(/href="(\/(?:album|track)\/[^"?#]+)"/g)) hrefs.add(m[1]);
        for (const href of hrefs) {
            try {
                const r = await fetchT(BANDCAMP_ROOT + href, { headers: { 'User-Agent': UA } });
                if (!r.ok) continue;
                const dm = (await r.text()).match(/data-tralbum="([^"]+)"/);
                if (!dm) continue;
                const data = JSON.parse(decodeHtml(dm[1]));
                for (const t of data.trackinfo || []) {
                    const link =
                        t.title_link ||
                        (data.trackinfo.length === 1 && data.url
                            ? new URL(data.url).pathname
                            : null);
                    if (t.title && link) map.set(norm(t.title), BANDCAMP_ROOT + link);
                }
                await sleep(300);
            } catch {
                /* skip a release that won't parse */
            }
        }
        console.log(`  bandcamp: cataloged ${map.size} track(s)`);
        return (bandcampCache = { ok: true, map });
    } catch (e) {
        console.warn(`  bandcamp: catalog scrape errored (${e.message}) -- skipping`);
        return (bandcampCache = { ok: false, map });
    }
}
async function bandcampLookup(title) {
    const { ok, map } = await bandcampCatalog();
    if (!ok) return { ok: false, links: {} };
    const url = map.get(norm(title));
    return { ok: true, links: url ? { bandcamp: url } : {} };
}

// SoundCloud's api-v2 needs a client_id, which the site ships in its JS bundle.
// Scrape it once and reuse it for the catalog sweep and any per-track searches.
let scClientId = null;
async function soundcloudClientId() {
    if (scClientId) return scClientId;
    try {
        const html = await (
            await fetchT('https://soundcloud.com/', { headers: { 'User-Agent': UA } })
        ).text();
        const scripts = [
            ...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g),
        ].map((m) => m[1]);
        for (const src of scripts.reverse()) {
            const js = await (await fetchT(src, { headers: { 'User-Agent': UA } })).text();
            const m = js.match(/client_id[:=]"([a-zA-Z0-9]{20,})"/);
            if (m) return (scClientId = m[1]);
        }
    } catch {
        /* fall through */
    }
    return scClientId;
}

// Catalog-first: sweep Jane Remover's official profile ONCE (resolve -> user id
// -> paginated tracks) into a title -> URL map. Most tracks are official uploads
// there, so this beats 89 fuzzy searches on both request count and accuracy.
const SC_PROFILE = 'https://soundcloud.com/janeremover';
let scCatalogCache = null;
async function soundcloudCatalog() {
    if (scCatalogCache) return scCatalogCache;
    const map = new Map();
    const cid = await soundcloudClientId();
    if (!cid) {
        console.warn('  soundcloud: no client_id -- skipping catalog');
        return (scCatalogCache = { ok: false, map });
    }
    try {
        const rr = await fetchT(
            `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(SC_PROFILE)}&client_id=${cid}`,
            { headers: { 'User-Agent': UA } }
        );
        if (!rr.ok) {
            console.warn(`  soundcloud: profile resolve failed (HTTP ${rr.status}) -- skipping`);
            return (scCatalogCache = { ok: false, map });
        }
        const user = await rr.json().catch(() => null);
        if (!user?.id) return (scCatalogCache = { ok: false, map });
        let next = `https://api-v2.soundcloud.com/users/${user.id}/tracks?client_id=${cid}&limit=200&linked_partitioning=1`;
        for (let pages = 0; next && pages < 6; pages++) {
            const r = await fetchT(next, { headers: { 'User-Agent': UA } });
            if (!r.ok) break;
            const j = await r.json().catch(() => null);
            if (!j) break;
            for (const t of j.collection || []) {
                if (t.title && t.permalink_url) map.set(norm(t.title), t.permalink_url);
            }
            next = j.next_href ? `${j.next_href}&client_id=${cid}` : null;
            await sleep(300);
        }
        console.log(`  soundcloud: cataloged ${map.size} official track(s)`);
        return (scCatalogCache = { ok: true, map });
    } catch (e) {
        console.warn(`  soundcloud: catalog sweep errored (${e.message}) -- skipping`);
        return (scCatalogCache = { ok: false, map });
    }
}

// Re-uploads are titled every which way -- "jane remover - hermit",
// "dltzk(jane remover) - scarecrow". Strip one leading "<something> - " so a
// title can be compared on its own. Only the first separator is consumed.
const stripArtistPrefix = (t) => {
    const m = String(t || '').match(/^[^-—–]{1,40}\s+[-—–]\s+(.+)$/);
    return m ? m[1] : String(t || '');
};
// Both spellings of a title, for matching in either direction.
const titleKeys = (t) => [...new Set([norm(t), norm(stripArtistPrefix(t))])].filter(Boolean);

// The title up to the first bracket/slash -- "ROBLOXCORE XD LOL!!! (feat. ...)"
// and "ROBLOXCORE >:) - XD LOL!!! (PROD 4AM) !!" both reduce to "robloxcorexdlol".
const primarySegment = (t) => String(t || '').split(/\s*[([/]/)[0];

// Keys used to match against the CURATED archive accounts only. Wider than
// titleKeys because re-uploads decorate titles freely -- different feature
// credits, "(PROD X)", emoticons that fake an "artist - title" split. That width
// is only safe because the account is already vetted and the key must still be
// >= 6 chars, and every accepted result is confirmed by runtime afterwards.
const MIN_ARCHIVE_KEY = 6;
// A re-upload can differ by a second or two of silence; more than that and it is
// a different take.
const ARCHIVE_SECONDS_TOLERANCE = 4;
// A truncated title has to share at least this much with ours before prefix
// matching will consider it.
const MIN_PREFIX_KEY = 14;
// Same words in a different order -- our "Clairo Bags Cover" against an upload
// titled "jane remover - bags [clairo cover]". Sorting the tokens makes those
// compare equal. Only safe because an archive hit is additionally gated on the
// source being vetted and on the runtime matching.
const sortedTokenKey = (t) => {
    const words = String(t || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    return words.length > 1 ? words.sort().join('') : '';
};

function archiveKeys(t) {
    const raw = String(t || '');
    const variants = [
        raw,
        stripArtistPrefix(raw),
        primarySegment(raw),
        primarySegment(stripArtistPrefix(raw)),
    ];
    const keys = variants.map(norm);
    for (const v of variants) keys.push(sortedTokenKey(v));
    return [...new Set(keys)].filter((k) => k.length >= MIN_ARCHIVE_KEY);
}

// Does `candidate` plausibly carry `title`? Substring containment is allowed --
// re-uploads add "(feat. ...)", "[remix]" and so on -- but ONLY once the title is
// long enough to be distinctive. A short title inside a longer one is almost
// always a different song: searching "Help" under the `leroy` alias otherwise
// matches "Help Yourself to Dub" by Leroy Smart and "People Help The People".
const MIN_SUBSTRING_TITLE = 6;
function titleCarries(candidate, title) {
    const want = norm(title);
    if (!want) return false;
    const keys = titleKeys(candidate);
    if (keys.some((k) => k === want)) return true;
    if (want.length < MIN_SUBSTRING_TITLE) return false;
    return keys.some((k) => k.includes(want));
}

// Every name this artist has released under, current name first. Empty for modes
// that declare none, which keeps permissive behaviour byte-identical.
const artistNames = (artist) => [artist, ...(MODE.artistAliases || [])].filter(Boolean);
// Does this text credit the artist under ANY of their names?
//
// Matched on WORD boundaries, not raw substrings. Several aliases are ordinary
// names ("leroy", "jamie"), and a substring test credits the artist for any
// uploader who merely contains them -- "Kevin Le Roy" and "LeRoy - Untitled Long
// Time" both matched the `leroy` alias that way. Tokenising keeps "le roy"
// distinct from "leroy" while still ignoring punctuation and casing.
const tokens = (s) =>
    ` ${String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()} `;
const creditsArtist = (text, artist) => {
    const t = tokens(text);
    if (t.trim() === '') return false;
    return artistNames(artist).some((a) => t.includes(tokens(a)));
};

// Catalog sweep over the mode's curated archive accounts (see modes.js). Most of
// the strict catalog was never released, so the artist's own profile does not
// have it and the only copies are archive re-uploads. Sweeping a hand-picked
// allowlist -- rather than trusting whatever a search returns -- is what makes
// these safe to publish: the account is vetted, and the title still has to match
// exactly. Built once per run, like the official-profile and Bandcamp catalogs.
let scArchiveCache = null;
async function soundcloudArchiveCatalog() {
    if (scArchiveCache) return scArchiveCache;
    const map = new Map();
    const accounts = MODE.archiveAccounts || [];
    const playlists = MODE.archivePlaylists || [];
    if (!accounts.length && !playlists.length) return (scArchiveCache = { ok: true, map, all: [] });

    // Shared indexer so accounts and playlists agree on keying and precedence.
    // Every candidate under a key, not just the first. Keeping only the first
    // meant one bad early hit blocked a good later one: personalpalace's "the
    // party i never had (mix 1)" claimed the key, so the closer "(mix 2)" from a
    // playlist could never be considered.
    const all = [];
    const add = (t, source) => {
        if (!t?.title || !t.permalink_url) return;
        const rec = {
            url: t.permalink_url,
            account: source,
            title: t.title,
            // Seconds. The api-v2 track object carries this for free, and it is
            // the only reliable way to tell an alternate take from the right one.
            seconds: t.duration ? Math.round(t.duration / 1000) : null,
        };
        all.push(rec);
        for (const key of archiveKeys(t.title)) {
            if (!map.has(key)) map.set(key, []);
            const list = map.get(key);
            if (!list.some((c) => c.url === rec.url)) list.push(rec);
        }
    };

    const cid = await soundcloudClientId();
    if (!cid) {
        console.warn('  soundcloud: no client_id -- skipping archive catalogs');
        return (scArchiveCache = { ok: false, map, all: [] });
    }

    let reached = 0;
    for (const account of accounts) {
        try {
            const rr = await fetchT(
                `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(`https://soundcloud.com/${account}`)}&client_id=${cid}`,
                { headers: { 'User-Agent': UA } }
            );
            if (!rr.ok) {
                console.warn(`  soundcloud: archive ${account} resolve failed (HTTP ${rr.status})`);
                continue;
            }
            const user = await rr.json().catch(() => null);
            if (!user?.id) continue;
            reached++;

            let next = `https://api-v2.soundcloud.com/users/${user.id}/tracks?client_id=${cid}&limit=200&linked_partitioning=1`;
            for (let pages = 0; next && pages < 6; pages++) {
                const r = await fetchT(next, { headers: { 'User-Agent': UA } });
                if (!r.ok) break;
                const j = await r.json().catch(() => null);
                if (!j) break;
                // First source in the list wins, so ordering is preference order.
                for (const t of j.collection || []) add(t, account);
                next = j.next_href ? `${j.next_href}&client_id=${cid}` : null;
                await sleep(250);
            }
            await sleep(300);
        } catch (e) {
            console.warn(`  soundcloud: archive ${account} errored (${e.message})`);
        }
    }

    // Curated playlists. A playlist only hydrates its first few tracks, so the
    // rest arrive as bare ids and have to be fetched in batches.
    let playlistTracks = 0;
    for (const url of playlists) {
        try {
            const pr = await fetchT(
                `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${cid}`,
                { headers: { 'User-Agent': UA } }
            );
            if (!pr.ok) {
                console.warn(`  soundcloud: playlist resolve failed (HTTP ${pr.status}) ${url}`);
                continue;
            }
            const pl = await pr.json().catch(() => null);
            if (!pl?.tracks) continue;
            reached++;

            for (const t of pl.tracks)
                if (t.title) {
                    add(t, 'playlist');
                    playlistTracks++;
                }
            const missing = pl.tracks.filter((t) => !t.title).map((t) => t.id);
            for (let i = 0; i < missing.length; i += 50) {
                const r = await fetchT(
                    `https://api-v2.soundcloud.com/tracks?ids=${missing.slice(i, i + 50).join(',')}&client_id=${cid}`,
                    { headers: { 'User-Agent': UA } }
                );
                if (!r.ok) break;
                for (const t of (await r.json().catch(() => [])) || []) {
                    add(t, 'playlist');
                    playlistTracks++;
                }
                await sleep(250);
            }
        } catch (e) {
            console.warn(`  soundcloud: playlist errored (${e.message}) ${url}`);
        }
    }

    console.log(
        `  soundcloud: cataloged ${map.size} archive track title(s) from ${accounts.length} account(s) + ${playlists.length} playlist(s) (${playlistTracks} playlist tracks)`
    );
    // ok only if at least one account answered; otherwise a network problem must
    // not be recorded as an authoritative "not on any archive".
    return (scArchiveCache = { ok: reached > 0, map, all });
}

// Per-track search for the tail the profile can't cover -- deleted loosies and
// covers that only survive as re-uploads on other accounts. Strong title match;
// accept a non-official uploader since the originals are gone.
//
// Under the strict policy this NEVER auto-accepts: a search hit from an arbitrary
// uploader is exactly the kind of confident-looking wrong link that ruins a
// guessing game. Matches are returned as review candidates instead.
async function soundcloudSearch(title, artist) {
    try {
        const cid = await soundcloudClientId();
        if (!cid) return { ok: false, links: {} };

        // One query per name the artist has released under. Re-uploads of older
        // material are usually credited to the old name, so searching only the
        // current one simply cannot find them.
        const collected = new Map();
        let anyOk = false;
        for (const name of artistNames(artist)) {
            const q = encodeURIComponent(`${name} ${title}`);
            const res = await fetchT(
                `https://api-v2.soundcloud.com/search/tracks?q=${q}&client_id=${cid}&limit=15`,
                { headers: { 'User-Agent': UA } }
            );
            if (!res.ok) continue;
            const j = await res.json().catch(() => null);
            if (!j || !Array.isArray(j.collection)) continue;
            anyOk = true;
            for (const t of j.collection) {
                if (t.permalink_url && !collected.has(t.permalink_url))
                    collected.set(t.permalink_url, t);
            }
            await sleep(250);
        }
        if (!anyOk) return { ok: false, links: {} };

        const matches = [...collected.values()].filter(
            (t) =>
                titleCarries(t.title, title) &&
                (creditsArtist(t.user?.username, artist) ||
                    norm(t.user?.username).includes('janeremover') ||
                    creditsArtist(t.title, artist))
        );

        if (STRICT) {
            return {
                ok: true,
                links: {},
                review: matches.slice(0, MAX_REVIEW_PER_PLATFORM).map((t) => ({
                    platform: 'soundcloud',
                    url: t.permalink_url,
                    title: t.title,
                    uploader: t.user?.username || '',
                    source: 'soundcloud-search',
                })),
            };
        }

        return { ok: true, links: matches[0] ? { soundcloud: matches[0].permalink_url } : {} };
    } catch {
        return { ok: false, links: {} };
    }
}

// Try the official catalog first, then fall back to search. The catalog is the
// artist's own profile, so an exact title match there is authoritative under both
// policies. { ok:false } only if BOTH the catalog failed to load and the search
// request failed, so a genuine "not on SoundCloud" still records a dated miss.
async function soundcloudLookup(title, artist, seconds = null) {
    const cat = await soundcloudCatalog();
    if (cat.ok) {
        const url = cat.map.get(norm(title));
        if (url) return { ok: true, links: { soundcloud: url } };
    }

    // Then the curated archive accounts (strict modes only). Exact title match
    // on a vetted account is confident enough to publish; anything looser still
    // falls through to the review queue below.
    const arch = MODE.archiveAccounts?.length
        ? await soundcloudArchiveCatalog()
        : { ok: true, map: new Map() };
    if (arch.ok) {
        // Gather every candidate across every key, then take the best by
        // runtime. Guards, all learned the hard way: the upload must credit the
        // artist unless the whole title matched exactly (else "luxieluci -
        // untitled (the 6)" answers for our "untitled"), and the runtime must
        // agree (else "the party i never had (mix 1)" at 152s answers for our
        // 142s version 2).
        const seen = new Set();
        const pool = [];
        for (const key of archiveKeys(title)) {
            for (const c of arch.map.get(key) || []) {
                if (seen.has(c.url)) continue;
                seen.add(c.url);
                pool.push(c);
            }
        }

        // Upload forms truncate long titles -- "Jane Remover - this is how y'all
        // look with..." for a 91-character track. Exact keys can never match
        // that, so fall back to prefix containment when nothing else hit. Still
        // gated on credit + runtime below, and on a long enough prefix that it
        // cannot be a coincidence.
        if (!pool.length) {
            const ours = titleKeys(title);
            for (const c of arch.all || []) {
                if (seen.has(c.url)) continue;
                const theirs = titleKeys(c.title);
                const hit = ours.some((a) =>
                    theirs.some(
                        (b) =>
                            Math.min(a.length, b.length) >= MIN_PREFIX_KEY &&
                            (a.startsWith(b) || b.startsWith(a))
                    )
                );
                if (!hit) continue;
                seen.add(c.url);
                pool.push(c);
            }
        }

        const viable = [];
        for (const c of pool) {
            const exact = titleKeys(c.title).some((k) => titleKeys(title).includes(k));
            if (!exact && !creditsArtist(c.title, artist)) {
                console.log(`      archive skip [${c.account}] "${c.title}" (not credited)`);
                continue;
            }
            const delta = seconds && c.seconds ? Math.abs(c.seconds - seconds) : null;
            if (delta !== null && delta > ARCHIVE_SECONDS_TOLERANCE) {
                console.log(
                    `      archive skip [${c.account}] "${c.title}" (${c.seconds}s vs ${seconds}s)`
                );
                continue;
            }
            viable.push({ ...c, delta });
        }

        if (viable.length) {
            // Closest runtime wins; an unknown runtime sorts last.
            viable.sort((a, b) => (a.delta ?? 1e9) - (b.delta ?? 1e9));
            const best = viable[0];
            console.log(
                `      archive hit [${best.account}] "${best.title}"` +
                    (best.delta !== null ? ` (${best.seconds}s vs ${seconds}s)` : '')
            );
            return { ok: true, links: { soundcloud: best.url } };
        }
    }

    const search = await soundcloudSearch(title, artist);
    if (search.links?.soundcloud) return search;
    // A catalog loaded (an authoritative "not there") OR search succeeded with no
    // hit -> a real miss. Only report failure if nothing could be reached.
    return { ok: cat.ok || arch.ok || search.ok, links: {}, review: search.review };
}

// --- YouTube + YouTube Music (resolved SEPARATELY) --------------------------
// `youtube` = the real music video (regular YouTube). `youtubeMusic` = the Art
// Track: the auto-generated "<artist> - Topic" Song. MusicLink co-derives them
// (one id, both URLs), which is wrong whenever a distinct Art Track exists -- so
// each is resolved from its own source, and fixYouTube() reconciles the pair.
const vidId = (u) => {
    const m = u && u.match(/[?&]v=([\w-]+)/);
    return m ? m[1] : null;
};
const ytUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const ytmUrl = (id) => `https://music.youtube.com/watch?v=${id}`;
const isTopic = (ch) => !!ch && / - Topic$/.test(ch);

// oEmbed: a video's channel + title (and, as a side effect, that it is live).
// Free, no key. Returns null on any failure (treat as unknown).
async function oembedInfo(id) {
    try {
        const res = await fetchT(
            `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`
        );
        if (!res.ok) return null;
        const j = await res.json();
        return { channel: j.author_name || '', title: j.title || '' };
    } catch {
        return null;
    }
}

// Real music VIDEO via the official YouTube Data API (works from datacenter IPs,
// so it is cron-safe). Prefers the artist's own channel and a title match, and
// skips "- Topic" Art Tracks (those are the youtubeMusic side). Falls back to the
// youtube.com scrape when no key is set. Returns { ok, id }.
async function youtubeVideo(title, artist) {
    // The keyless fallback is a page scrape with no channel verification, which
    // is far too loose to publish from under the strict policy.
    if (!YT_KEY) return STRICT ? { ok: false, id: null } : youtubeScrapeVideo(title, artist);
    const review = [];
    // A non-OK response is usually the daily quota (403), not "no such video".
    // Without this the caller records a dated miss and stops asking for 30 days
    // -- so one exhausted afternoon silently freezes YouTube resolution.
    let apiFailed = false;
    // One search attempt for a given query string. `lastResort` allows the old
    // "first non-Topic result" fallback; the retry below sets it false so a
    // simplified query can only ever return a strict full-title match.
    const attempt = async (queryTitle, lastResort, queryArtist = artist) => {
        const q = encodeURIComponent(`${queryArtist} ${queryTitle}`);
        const res = await fetchT(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${q}&key=${YT_KEY}`
        );
        if (!res.ok) {
            if (res.status === 403 || res.status === 429) {
                console.warn(`  youtube: Data API refused (HTTP ${res.status}) -- quota?`);
            }
            apiFailed = true;
            return null;
        }
        const j = await res.json();
        const items = (j.items || [])
            .map((it) => ({
                id: it.id?.videoId,
                ch: it.snippet?.channelTitle || '',
                title: it.snippet?.title || '',
            }))
            .filter((x) => x.id && !isTopic(x.ch));
        // Acceptance is ALWAYS against the full title, never the simplified query,
        // so a shorter query can never let a different song through.
        const titled = items.filter((x) => titleCarries(x.title, title));

        // Strict: the video's channel must also be the artist. A title match
        // alone is how a fan re-upload, a lyric video of a different song, or a
        // "type beat" ends up published as the answer. Everything that matched
        // the title but not the channel goes to review instead.
        if (STRICT) {
            // "The channel is the artist" has to mean any of their names, or
            // every upload credited to the old one is discarded unseen.
            const own = titled.filter((x) => creditsArtist(x.ch, artist));
            for (const x of titled.filter((x) => !own.includes(x))) {
                review.push({
                    platform: 'youtube',
                    url: ytUrl(x.id),
                    title: x.title,
                    uploader: x.ch,
                    source: 'youtube-search',
                });
            }
            return own.find((x) => norm(x.ch) === norm(artist))?.id || own[0]?.id || null;
        }

        const best =
            titled.find((x) => norm(x.ch) === norm(artist)) ||
            titled.find((x) => norm(x.ch).includes(norm(artist))) ||
            titled[0] ||
            (lastResort ? items[0] : null);
        return best?.id || null;
    };
    try {
        // lastResort ("just take the first result") is never allowed under strict.
        let id = await attempt(title, !STRICT);
        if (!id) {
            // Multi-part titles ("A / B") and parenthetical suffixes can make the
            // search itself return nothing; retry on the primary segment. The full
            // title still has to appear in the matched video's title, so the real
            // "A / B (audio)" upload matches while a bare "A" of another song does not.
            const primary = title.split(/\s*[/(]/)[0].trim();
            if (primary && norm(primary) !== norm(title)) id = await attempt(primary, false);
        }
        // Still nothing: re-query under the artist's other names. The full title
        // must still appear in the matched video, so a wider query can only
        // surface the same song credited differently, never a different song.
        // Costs one Data API search per alias, so it only runs on a real miss.
        if (!id) {
            // Capped: each alias is a whole Data API search (100 units against a
            // ~100-searches/day quota), and this fires on every track that is
            // still missing. The list is ordered by era, so the first few are the
            // ones this catalog is actually likely to be credited to.
            for (const alias of (MODE.artistAliases || []).slice(0, YT_ALIAS_ATTEMPTS)) {
                if (apiFailed) break;
                id = await attempt(title, false, alias);
                if (id) break;
            }
        }
        // A failed request is NOT a confirmed "not on YouTube" -- leave it
        // unstamped so the next run retries.
        return { ok: !apiFailed, id, review: id ? [] : review };
    } catch {
        return { ok: false, id: null };
    }
}

// Scrape fallback for youtubeVideo (no Data API key). First title+artist match.
async function youtubeScrapeVideo(title, artist) {
    try {
        const res = await fetchT(
            'https://www.youtube.com/results?search_query=' +
                encodeURIComponent(`${artist} ${title}`),
            { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' } }
        );
        if (!res.ok) return { ok: false, id: null };
        const m = (await res.text()).match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
        if (!m) return { ok: false, id: null };
        const vids = [];
        const walk = (o) => {
            if (!o || typeof o !== 'object') return;
            if (o.videoRenderer?.videoId) {
                const v = o.videoRenderer;
                vids.push({
                    id: v.videoId,
                    title: v.title?.runs?.[0]?.text || '',
                    ch: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
                });
            }
            for (const k in o) walk(o[k]);
        };
        walk(JSON.parse(m[1]));
        const hit = vids.find(
            (v) =>
                norm(v.title).includes(norm(title)) &&
                (norm(v.title).includes(norm(artist)) || norm(v.ch).includes(norm(artist)))
        );
        return { ok: true, id: hit?.id || null };
    } catch {
        return { ok: false, id: null };
    }
}

// Art Track via YouTube Music's internal search (unofficial; local only). The
// innertube key is a public constant; a SOCS cookie skips the consent page. The
// search returns other artists' Art Tracks too, so we oEmbed the candidates and
// take the "<artist> - Topic" Song, preferring a title match. Returns { ok, id }.
const YTM_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const YTM_VER = '1.20241127.01.00';
async function ytmArtTrack(title, artist) {
    try {
        const res = await fetchT(
            `https://music.youtube.com/youtubei/v1/search?key=${YTM_KEY}&prettyPrint=false`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': UA,
                    Origin: 'https://music.youtube.com',
                    Referer: 'https://music.youtube.com/',
                    Cookie: 'SOCS=CAI',
                },
                body: JSON.stringify({
                    context: {
                        client: {
                            clientName: 'WEB_REMIX',
                            clientVersion: YTM_VER,
                            hl: 'en',
                            gl: 'US',
                        },
                    },
                    query: `${artist} ${title}`,
                }),
            }
        );
        if (!res.ok) return { ok: false, id: null };
        const j = await res.json();
        const ids = [];
        const seen = new Set();
        (function walk(o) {
            if (!o || typeof o !== 'object') return;
            if (typeof o.videoId === 'string' && !seen.has(o.videoId)) {
                seen.add(o.videoId);
                ids.push(o.videoId);
            }
            for (const k in o) walk(o[k]);
        })(j);
        for (const id of ids.slice(0, 10)) {
            const info = await oembedInfo(id);
            if (info && isTopic(info.channel) && norm(info.channel).includes(norm(artist))) {
                // Substring match, but only when the shorter title is >=5 chars,
                // so a tiny title like "me" doesn't match "ho-me-switcher". Short
                // titles require an exact normalized match.
                const t = norm(title);
                const it = norm(info.title);
                const titleMatch =
                    it === t ||
                    (it.includes(t) && t.length >= 5) ||
                    (t.includes(it) && it.length >= 5);
                if (titleMatch) return { ok: true, id };
            }
            await sleep(100);
        }
        // No title match -> no Art Track for this track. Do NOT fall back to the
        // first "<artist> - Topic" result: those are OTHER songs, and returning
        // one assigns the same wrong Art Track to many tracks. Caller co-derives.
        return { ok: true, id: null };
    } catch {
        return { ok: false, id: null };
    }
}

// Reconcile one song's youtube / youtubeMusic so `youtube` is the real video and
// `youtubeMusic` is the Art Track. Classifies the current shared id via oEmbed,
// then resolves the missing side from its own source (Data API / YT Music). When
// the proper distinct link can't be found it CO-DERIVES (same id, other prefix)
// -- always valid, even from a cron -- and sets entry.coderived[platform] so a
// later run retries. Returns change tags for logging.
async function fixYouTube(entry) {
    const changes = [];
    // Whether the underlying lookups actually got answers. A quota-blocked or
    // otherwise failed request must not be reported to the caller as "checked
    // and found nothing", or the caller stamps a dated miss and stops asking.
    let ok = true;
    const flag = (p) => {
        entry.coderived = entry.coderived || {};
        entry.coderived[p] = true;
    };
    const unflag = (p) => {
        if (entry.coderived) delete entry.coderived[p];
    };
    const set = (p, url, tag) => {
        const current = entry.links[p];
        // Same video, different URL shape -> keep what is already there. This
        // pass normalises links to a bare watch?v=<id>, which would strip a
        // deliberate `&t=` timestamp -- and for a track that only exists inside
        // a DJ set (eat my dust sits at 17:44 of a 20:00 mix under a completely
        // different name) the timestamp is the entire value of the link.
        if (
            typeof current === 'string' &&
            current.trim() &&
            vidId(current) &&
            vidId(current) === vidId(url)
        ) {
            return;
        }
        if (current !== url) {
            entry.links[p] = url;
            changes.push(tag);
        }
    };

    const cur = vidId(entry.links.youtube) || vidId(entry.links.youtubeMusic);
    let curTopic = null; // true=Art Track, false=real video, null=unknown/dead
    if (cur) {
        const info = await oembedInfo(cur);
        curTopic = info ? isTopic(info.channel) : null;
    }

    // youtube = a real (non-Topic) video
    if (curTopic === false) {
        set('youtube', ytUrl(cur), 'youtube=video');
        unflag('youtube');
    } else {
        const v = await youtubeVideo(entry.title, entry.artist);
        if (v.ok === false) ok = false;
        if (v.id) {
            set('youtube', ytUrl(v.id), `youtube=${v.id}`);
            unflag('youtube');
            clearReview(entry, ['youtube']);
        } else if (v.review?.length) {
            recordReview(entry, v.review);
        } else if (cur && !STRICT) {
            set('youtube', ytUrl(cur), 'youtube~coderived');
            flag('youtube');
        }
    }

    // youtubeMusic = the Art Track ("<artist> - Topic" Song)
    if (curTopic === true) {
        set('youtubeMusic', ytmUrl(cur), 'ytmusic=arttrack');
        unflag('youtubeMusic');
    } else {
        const a = await ytmArtTrack(entry.title, entry.artist);
        if (a.ok === false) ok = false;
        if (a.id) {
            set('youtubeMusic', ytmUrl(a.id), `ytmusic=${a.id}`);
            unflag('youtubeMusic');
        } else if (!STRICT) {
            const yid = vidId(entry.links.youtube) || cur;
            if (yid) {
                set('youtubeMusic', ytmUrl(yid), 'ytmusic~coderived');
                flag('youtubeMusic');
            }
        }
        // Strict: no co-derivation. Presenting a fan re-upload as the official
        // "- Topic" Art Track is precisely the wrong-link this policy exists to
        // prevent, so the platform is simply left unset.
    }

    if (entry.coderived && Object.keys(entry.coderived).length === 0) delete entry.coderived;
    return { changes, ok };
}

// --- link liveness (for --verify) ------------------------------------------
async function isDead(url) {
    try {
        const res = await fetchT(url, { method: 'HEAD', redirect: 'follow' });
        // 405 (HEAD unsupported) and 403 (bot-block) are not proof the link is dead.
        if (res.ok || res.status === 405 || res.status === 403) return false;
        return res.status === 404 || res.status === 410;
    } catch {
        return false; // transient network error -> do not drop a link on a hiccup
    }
}

// Propagate the registry's (healthy) links onto the client-facing catalog so a
// heal/hide shows up without a full `pnpm scan` (which needs the audio masters).
// This is what lets the cron be just: pull-data -> links --verify -> push-data.
// Only the `links` field is rewritten; every other catalog field is left alone,
// and a missing songs.json is a no-op (run `pnpm scan` to build it first).
async function syncCatalogLinks(registry) {
    let songs;
    try {
        songs = JSON.parse(await fs.readFile(SONGS_FILE, 'utf-8'));
    } catch {
        console.warn('  songs.json not present -- run `pnpm scan` to build the catalog');
        return;
    }
    let patched = 0;
    for (const s of songs) {
        const links = registry[s.id]?.links;
        if (links && JSON.stringify(links) !== JSON.stringify(s.links)) {
            s.links = links;
            patched++;
        }
    }
    await fs.writeFile(SONGS_FILE, JSON.stringify(songs, null, 2));
    await fs.writeFile(SONGS_MIN_FILE, encode(songs));
    if (patched) console.log(`  catalog: updated links on ${patched} song(s) in songs.json`);
}

async function main() {
    const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));
    const issues = [];
    let resolved = 0;
    let checked = 0;
    let healed = 0;
    let hidden = 0;
    let touched = 0;
    let review = 0;

    console.log(`Mode: ${MODE.id} (link policy: ${MODE.linkPolicy})`);

    // Optional scoping to a subset of songs (e.g. one day's challenge tracks).
    let only = ONLY_IDS.length ? new Set(ONLY_IDS) : null;
    if (CHALLENGE_DATE) {
        const meta = JSON.parse(
            await fs.readFile(path.join(DAILIES_DIR, CHALLENGE_DATE, 'meta.json'), 'utf-8')
        );
        const ids = (meta.rounds || []).map((r) => r.songId);
        only = new Set([...(only || []), ...ids]);
        console.log(`Scoped to challenge ${CHALLENGE_DATE}: ${ids.length} song(s)`);
    }

    // --fix-youtube: reconcile youtube/youtubeMusic across the catalog (or scope).
    // A correction pass (overrides MusicLink's co-derived pair), separate from the
    // fill-missing resolution below. Local only (uses YT Music scraping).
    if (FIX_YT) {
        let n = 0;
        for (const [id, entry] of Object.entries(registry)) {
            if (only && !only.has(id)) continue;
            entry.links = entry.links || {};
            const { changes } = await fixYouTube(entry);
            if (changes.length) {
                n++;
                console.log(`  ~ ${entry.title}: ${changes.join(', ')}`);
            }
            await sleep(200);
        }
        const flagged = Object.values(registry).filter((e) => e.coderived).length;
        await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
        await syncCatalogLinks(registry);
        console.log(
            `\nfix-youtube: changed ${n} track(s) | ${flagged} co-derived (flagged for self-heal)`
        );
        return;
    }

    for (const [id, entry] of Object.entries(registry)) {
        if (touched >= LIMIT) break;
        if (only && !only.has(id)) continue;
        // This script owns only the link fields (links, deadLinks, tried, isrc);
        // it never touches the master fields scan-songs.js owns, so the two can
        // alternate on the shared registry without clobbering each other.
        entry.links = entry.links || {};
        const isrc = await readIsrc(entry);

        // One MusicLink lookup per song, memoized (healing and resolution share
        // it) so a song never costs more than a single call -- keeps the 300/mo
        // cap safe in an unattended cron.
        let mlMemo;
        const mlLookup = async () => {
            if (mlMemo === undefined) {
                mlMemo = isrc && ML_KEY ? await musiclinkByIsrc(isrc) : { ok: false, links: {} };
            }
            return mlMemo;
        };

        // --verify is the lean cron: HEAD-check each live link; try to heal dead
        // ones via MusicLink ONLY (scraping stays local); and HIDE any that can't
        // be healed by moving them to entry.deadLinks -- out of entry.links (so
        // the catalog and client never render them) and marked heal-attempted so
        // the cron won't retry them. A later local `pnpm links` can still recover
        // one with the scrapers. No scraping, no discovery in this mode.
        if (VERIFY) {
            // Collect every dead link first, so the MusicLink lookup is done ONCE
            // per song (the API is per-track): a track with several dead links
            // still costs a single request, not one per link.
            const dead = [];
            for (const [platform, url] of Object.entries(entry.links)) {
                if (typeof url !== 'string' || !url.trim()) continue;
                checked++;
                if (await isDead(url)) dead.push([platform, url]);
                await sleep(150);
            }

            if (dead.length) {
                const mlLinks = (await mlLookup()).links;
                // Heal youtube first so a dead youtubeMusic can co-derive from it.
                const order = { youtube: 0 };
                dead.sort((a, b) => (order[a[0]] ?? 1) - (order[b[0]] ?? 1));
                for (const [platform, url] of dead) {
                    let candidate = mlLinks[platform] || null;
                    let coderive = false;
                    // Strict: heal from MusicLink (ISRC) only. A search-based or
                    // co-derived replacement is a guess, and silently swapping in
                    // a guess is worse than showing nothing -- so anything that
                    // cannot be healed authoritatively is hidden below.
                    if (STRICT) {
                        // no search-based or co-derived healing
                    } else if (platform === 'youtube' && YT_KEY) {
                        // real video via the Data API -- official, so cron-safe
                        const v = await youtubeVideo(entry.title, entry.artist);
                        if (v.id) candidate = ytUrl(v.id);
                    } else if (platform === 'youtubeMusic') {
                        // co-derive from the (now-healthy) youtube link, always
                        // valid; flag it so a local --fix-youtube finds the Art Track
                        const yid = vidId(entry.links.youtube);
                        if (yid) {
                            candidate = ytmUrl(yid);
                            coderive = true;
                        }
                    }
                    if (candidate && candidate !== url && !(await isDead(candidate))) {
                        entry.links[platform] = candidate;
                        if (coderive) {
                            entry.coderived = entry.coderived || {};
                            entry.coderived.youtubeMusic = true;
                        } else if (entry.coderived) {
                            delete entry.coderived[platform];
                        }
                        healed++;
                        console.log(
                            `  ~ ${entry.title}: healed ${platform}${coderive ? ' (co-derived)' : ''}`
                        );
                    } else {
                        delete entry.links[platform];
                        entry.deadLinks = entry.deadLinks || {};
                        entry.deadLinks[platform] = { url, since: today() };
                        hidden++;
                        issues.push({
                            id,
                            title: entry.title,
                            platform,
                            url,
                            reason: 'dead-link-hidden',
                        });
                        console.log(`  - ${entry.title}: hid ${platform} (could not heal)`);
                    }
                }
                if (entry.coderived && Object.keys(entry.coderived).length === 0) {
                    delete entry.coderived;
                }
            }
            continue; // cron does liveness + heal + hide only
        }

        // Local run: fill MISSING platforms. MusicLink runs first and only when
        // it hasn't already resolved this track (protect the 300/mo cap);
        // Bandcamp/SoundCloud/YouTube fill whatever platform is still missing.
        const fresh = (source) => !triedRecently(entry, source);
        const needMusicLink = isrc && !musicLinked(entry.links) && fresh('musiclink');
        const needBandcamp = !entry.links.bandcamp && fresh('bandcamp');
        const needSoundcloud = !entry.links.soundcloud && fresh('soundcloud');
        // youtube/youtubeMusic are reconciled by fixYouTube (real video vs Art
        // Track). Here we only bootstrap a brand-new track that has neither; the
        // `--fix-youtube` pass is what corrects existing ones.
        const needYouTube = !entry.links.youtube && !entry.links.youtubeMusic && fresh('youtube');

        if (needMusicLink || needBandcamp || needSoundcloud || needYouTube) {
            touched++;
            const before = Object.keys(entry.links).length;

            if (needMusicLink) {
                await trySource(entry, 'musiclink', mlLookup);
                await sleep(1500);
            }
            if (needBandcamp) {
                await trySource(entry, 'bandcamp', () => bandcampLookup(entry.title));
            }
            if (needSoundcloud) {
                await trySource(entry, 'soundcloud', () =>
                    soundcloudLookup(entry.title, entry.artist, Math.round(entry.duration || 0))
                );
                await sleep(500);
            }
            if (needYouTube) {
                // Bootstrap a new track: resolve the real video + Art Track.
                const { changes, ok } = await fixYouTube(entry);
                if (changes.length) {
                    if (entry.tried) delete entry.tried.youtube;
                } else if (ok) {
                    entry.tried = entry.tried || {};
                    entry.tried.youtube = today();
                }
                // else: the lookup itself failed (quota/network) -- leave it
                // unstamped so the next run asks again instead of writing off
                // the track for STALE_DAYS.
                await sleep(500);
            }

            if (Object.keys(entry.links).length > before) {
                resolved++;
                console.log(`  + ${entry.title}: ${Object.keys(entry.links).join(', ')}`);
            } else if (!hasLinks(entry.links) && !(STRICT && !isrc)) {
                // Under strict, a track with no ISRC and no hits is the expected
                // outcome, not an issue -- it is marked linksOptional below.
                issues.push({
                    id,
                    title: entry.title,
                    reason: isrc ? 'all-sources-missed' : 'no-isrc-all-sources-missed',
                    isrc: isrc || undefined,
                });
            }

            for (const [platform, list] of Object.entries(entry.needsReview || {})) {
                if (!list.length) continue;
                review++;
                issues.push({
                    id,
                    title: entry.title,
                    platform,
                    url: list[0].url,
                    reason: 'needs-review',
                });
            }
        }

        // A platform a local re-scrape just recovered is no longer dead -- drop
        // its deadLinks record so it stops being marked heal-attempted.
        if (entry.deadLinks) {
            for (const p of Object.keys(entry.deadLinks)) {
                if (entry.links[p]) delete entry.deadLinks[p];
            }
            if (Object.keys(entry.deadLinks).length === 0) delete entry.deadLinks;
        }

        // A platform that now has a link no longer needs triage.
        if (entry.needsReview) clearReview(entry, Object.keys(entry.links));

        // "Zero links is expected here." Set once every APPLICABLE source has been
        // asked and confirmed it has nothing (a dated stamp means a real answer;
        // a failed request leaves no stamp, so a flaky run can never silence a
        // track). link-issues.js then stops reporting it, which is what keeps the
        // rolling link-health issue from permanently listing 40-odd unreleased
        // tracks that were never online to begin with.
        //
        // Deliberately per-entry rather than per-mode: a track whose sources have
        // NOT all answered still gets flagged, and a track that had links and lost
        // them produces deadLinks, which are reported regardless of this marker.
        // Stamps expire after STALE_DAYS, so every source is re-asked periodically
        // and the flag clears the moment something turns up.
        if (STRICT) {
            const sources = ['bandcamp', 'soundcloud', 'youtube'];
            if (isrc) sources.push('musiclink');
            const swept = sources.every((s) => entry.tried?.[s]);
            if (swept && !hasLinks(entry.links)) entry.linksOptional = true;
            else delete entry.linksOptional;
        }
    }

    await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
    await fs.writeFile(ISSUES_FILE, JSON.stringify(issues, null, 2));
    await syncCatalogLinks(registry);
    console.log(
        `\nresolved ${resolved} | checked ${checked} | healed ${healed} | hidden ${hidden} | ` +
            `${review} awaiting review | ${issues.length} issue(s) -> ${ISSUES_FILE}`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
