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
//   4. YouTube Music: scrape youtube search for any track still missing a
//      youtubeMusic link (MusicLink already fills it for indexed releases).
//   Bandcamp/SoundCloud/YouTube scrape, so they are fragile -- see --verify.
//
// Modes:
//   pnpm links            LOCAL: fill missing platforms via MusicLink + the
//                         Bandcamp/SoundCloud/YouTube scrapers (incremental).
//   pnpm links --verify   LEAN CRON: HEAD-check every existing link; heal a dead
//                         one via MusicLink only (no scraping); and HIDE any that
//                         can't be healed by moving it to entry.deadLinks, out of
//                         the client-facing links and marked heal-attempted so it
//                         is not retried. Also patches songs.json so the hide is
//                         published without a masters-dependent `pnpm scan`.
//                         Records hidden links in out/data/link-issues.json.
//
// This script owns ONLY the registry's link fields (links, deadLinks, tried,
// isrc); scan-songs.js owns the master fields. They never write the same keys,
// so the two can alternate on the shared registry -- provided each starts from a
// fresh pull-data (pull-data before a scan or a --verify run, push-data after).
//
// MUSICLINK_API_KEY comes from .env (server-side only; never client, never committed).
// ISRCs are read from the master files in out/masters, so this needs them present.

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mm from 'music-metadata';
import { encode } from '@msgpack/msgpack';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../out/data');
// ISRC lives in the SOURCE files (masters/), not the converted out/masters/*.m4a
// (ffmpeg drops the tag on FLAC -> m4a). Read the source by base name.
const SRC_MASTERS_DIR = process.env.SRC_MASTERS_DIR || path.resolve(__dirname, '../masters');
const REGISTRY_FILE = path.join(DATA_DIR, 'song-registry.json');
const ISSUES_FILE = path.join(DATA_DIR, 'link-issues.json');
// Client-facing catalog derived from the registry; `--verify` patches its links
// in place (no masters / no full scan) so a lean cron can publish heals + hides.
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const SONGS_MIN_FILE = path.join(DATA_DIR, 'songs.min.json');

const ML_KEY = process.env.MUSICLINK_API_KEY;
const VERIFY = process.argv.includes('--verify');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

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
const today = () => new Date().toISOString().slice(0, 10);
function triedRecently(entry, source) {
    const d = entry.tried?.[source];
    if (!d) return false;
    return (Date.now() - new Date(d).getTime()) / 86400000 < STALE_DAYS;
}
// Run one source; merge any links found. On a genuine miss (ok with no links)
// stamp entry.tried[source] with today's date. A failed request (ok:false) is
// left unstamped so it retries on the next run.
async function trySource(entry, source, fn) {
    const { ok, links } = await fn();
    if (links && Object.keys(links).length) {
        Object.assign(entry.links, links);
        if (entry.tried) delete entry.tried[source];
        return true;
    }
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
        const res = await fetchT(`https://api.ml.jadquir.com/v1/lookup/isrc/${isrc}`, {
            headers: { Authorization: `Bearer ${ML_KEY}` },
        });
        if (res.status === 429) {
            await sleep(3000);
            continue;
        }
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

// Per-track search for the tail the profile can't cover -- deleted loosies and
// covers that only survive as re-uploads on other accounts. Strong title match;
// accept a non-official uploader since the originals are gone.
async function soundcloudSearch(title, artist) {
    try {
        const cid = await soundcloudClientId();
        if (!cid) return { ok: false, links: {} };
        const q = encodeURIComponent(`${artist} ${title}`);
        const res = await fetchT(
            `https://api-v2.soundcloud.com/search/tracks?q=${q}&client_id=${cid}&limit=15`,
            { headers: { 'User-Agent': UA } }
        );
        if (!res.ok) return { ok: false, links: {} };
        const j = await res.json().catch(() => null);
        if (!j || !Array.isArray(j.collection)) return { ok: false, links: {} };
        const hit = j.collection.find(
            (t) =>
                t.permalink_url &&
                norm(t.title).includes(norm(title)) &&
                (norm(t.user?.username).includes(norm(artist)) ||
                    norm(t.user?.username).includes('janeremover') ||
                    norm(t.title).includes(norm(artist)))
        );
        return { ok: true, links: hit ? { soundcloud: hit.permalink_url } : {} };
    } catch {
        return { ok: false, links: {} };
    }
}

// Try the official catalog first, then fall back to search. { ok:false } only if
// BOTH the catalog failed to load and the search request failed, so a genuine
// "not on SoundCloud" still records a dated miss.
async function soundcloudLookup(title, artist) {
    const cat = await soundcloudCatalog();
    if (cat.ok) {
        const url = cat.map.get(norm(title));
        if (url) return { ok: true, links: { soundcloud: url } };
    }
    const search = await soundcloudSearch(title, artist);
    if (search.links.soundcloud) return search;
    // Catalog loaded (an authoritative "not on the profile") OR search succeeded
    // with no hit -> a real miss. Only report failure if nothing could be reached.
    return { ok: cat.ok || search.ok, links: {} };
}

// YouTube Music: scrape youtube search, take the first video whose title contains
// the track title AND names the artist (guards against unrelated uploads).
async function youtubeMusicSearch(title, artist) {
    try {
        const res = await fetchT(
            'https://www.youtube.com/results?search_query=' +
                encodeURIComponent(`${artist} ${title}`),
            { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' } }
        );
        if (!res.ok) return { ok: false, links: {} };
        const html = await res.text();
        const m = html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
        if (!m) return { ok: false, links: {} };
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
        return {
            ok: true,
            links: hit ? { youtubeMusic: `https://music.youtube.com/watch?v=${hit.id}` } : {},
        };
    } catch {
        return { ok: false, links: {} };
    }
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

    for (const [id, entry] of Object.entries(registry)) {
        if (touched >= LIMIT) break;
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
                for (const [platform, url] of dead) {
                    const candidate = mlLinks[platform] || null;
                    if (candidate && candidate !== url && !(await isDead(candidate))) {
                        entry.links[platform] = candidate;
                        healed++;
                        console.log(`  ~ ${entry.title}: healed ${platform}`);
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
        const needYtMusic = !entry.links.youtubeMusic && fresh('youtubeMusic');

        if (needMusicLink || needBandcamp || needSoundcloud || needYtMusic) {
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
                    soundcloudLookup(entry.title, entry.artist)
                );
                await sleep(500);
            }
            if (needYtMusic) {
                await trySource(entry, 'youtubeMusic', () =>
                    youtubeMusicSearch(entry.title, entry.artist)
                );
                await sleep(500);
            }

            if (Object.keys(entry.links).length > before) {
                resolved++;
                console.log(`  + ${entry.title}: ${Object.keys(entry.links).join(', ')}`);
            } else if (!hasLinks(entry.links)) {
                issues.push({
                    id,
                    title: entry.title,
                    reason: isrc ? 'all-sources-missed' : 'no-isrc-all-sources-missed',
                    isrc: isrc || undefined,
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
    }

    await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
    await fs.writeFile(ISSUES_FILE, JSON.stringify(issues, null, 2));
    await syncCatalogLinks(registry);
    console.log(
        `\nresolved ${resolved} | checked ${checked} | healed ${healed} | hidden ${hidden} | ${issues.length} issue(s) -> ${ISSUES_FILE}`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
