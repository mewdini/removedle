import { dev } from '$app/environment';

const MAX_ROUNDS = 5;
const GUESSES_PER_ROUND = 3;
// Shared by AudioCard (caps the fuzzy-search results it keeps) and
// SearchResults (sizes its reserved dropdown space to that same worst case)
const MAX_SEARCH_RESULTS = 5;
// Day 1 is per mode and lives on the mode config (`startDate` in $lib/modes).
// It is deliberately NOT duplicated here: a second copy would look
// authoritative while being ignored by every date route and archive listing
const ASSETS_URL = dev ? '/assets' : 'https://assets.removedle.org';
// Always same-origin: challenge media is served by src/routes/challenges/[date]/[file],
// which gates future dates. It must never point at a public bucket, as that would
// expose tomorrow's answers, which are uploaded the evening before
const CHALLENGES_URL = '/challenges';
// Shown when hitting a 404 page; pulled from the lyric metadata on the masters in
// masters/. `song` must match a catalog title exactly so the error page can resolve
// its streaming links for the hover reveal
const ERROR_LINES: { line: string; song: string }[] = [
    { line: "I guess you weren't meant for my hideout...", song: 'misplace' },
    { line: "That's not the plan...", song: 'search party' },
    { line: "Well, that's your loss...", song: 'movies for guys' },
    { line: 'Good luck trying to catch me...', song: 'Backseat Girl' },
    { line: 'You got lost chasing time again...', song: 'kodak moment' },
    { line: 'As if it ever was that easy?', song: 'Backseat Girl' },
    { line: 'Look at the mess...', song: 'movies for guys' },
    { line: 'Stay out of my business...', song: 'homeswitcher' },
    { line: 'Somebody save me now...', song: 'let’s go home' },
    { line: "I'm not sure where to go...", song: 'search party' },
    { line: 'Oh, my heart is broken!', song: 'movies for guys' },
    { line: "You won't stay ahead of me forever...", song: 'Cage Girl / Camgirl' },
    { line: 'Is it too much to say I want it back?', song: 'buzzcut, daisy' },
    { line: 'Good luck tryna fix me...', song: 'JRJRJR' },
    { line: "It's all your fault...", song: 'kodak moment' },
];
const NAME = 'removedle';
const DESCRIPTION =
    'A daily Jane Remover song guessing game featuring five songs and three guesses per track. How many can you get right?';
const SITE = 'https://removedle.org';
// janedle.org is an alias domain, and it deliberately never SERVES the game. It
// is a Workers Custom Domain on this same Worker (see `routes` in
// wrangler.jsonc) whose only job is to redirect to SITE, see the handle hook
// in src/hooks.server.ts.
//
// It MUST NOT serve the game, because localStorage is per-origin and this game
// keeps the board, the streak and the stats there. A player who arrived on a
// second origin would silently start a separate save and lose their streak, so
// one origin owns all game state and the alias only ever points at it.
//
// Arriving through the alias still earns a wordmark easter egg, kept as two
// words the way the artist's own name splits. The marker cannot be a cookie set
// by the alias itself (a response from janedle.org cannot Set-Cookie for
// removedle.org), so it rides in the query string for exactly one hop and is
// then traded for ALT_COOKIE
const ALT_HOST = 'janedle.org';
const ALT_NAME = 'janedle removedle';
// One-hop query marker. Stripped as soon as it becomes the cookie, so it never
// lingers in a shareable URL
const ALT_MARKER = 'janedle';
// Set by the handle hook with an explicit Max-Age (below), so the egg lasts the
// visit that came in through the alias and no longer. The egg is for using the
// janedle URL, not a permanent rebrand of every later visit made directly to
// removedle.org.
//
// The `-v2` suffix is load-bearing and must not be tidied away. Max-Age only
// applies to cookies written AFTER it ships: a browser that already holds the
// old session-scoped `via-janedle` never gains an expiry retroactively, so every
// player who has been through the alias would have stayed branded indefinitely
// and the fix would have looked like it had not worked. Reading a new name
// abandons all of those in one deploy. The old cookie is deliberately not
// expired: clearing it would mean writing a Set-Cookie on requests that need
// no response header at all, to reclaim ~14 bytes that the browser drops on its
// next real restart anyway. Renaming again is the fix if this ever recurs
const ALT_COOKIE = 'via-janedle-v2';
// Bridges exactly one hop: the marker-trade redirect's own landing request can
// never read Sec-Fetch-Site: same-origin, since it is still part of a
// navigation that started outside this site. Without this, the persistence
// check in the handle hook would clear ALT_COOKIE before the egg ever
// rendered once. 30s is generous for one redirect even on a slow connection --
// it is not a second copy of the egg's lifetime, just enough to let the
// browser follow the Location header it was just given
const ALT_HOP_COOKIE = 'via-janedle-hop';
const ALT_HOP_COOKIE_MAX_AGE = 30;
// Six hours, in seconds: an outer backstop on how long ALT_COOKIE can exist,
// not what actually ends the egg -- that's the Sec-Fetch-Site check in the
// handle hook.
//
// This was originally a SESSION cookie (no Max-Age, no Expires), on the theory
// that "the browser closes" is the natural end of a visit. It is not: mobile
// Safari and Chrome are effectively never closed, and desktop Chrome's
// "Continue where you left off" restores session cookies across a restart. So
// one trip through janedle.org branded the browser indefinitely, and a later
// click from an unrelated site (the reported case was a t.co link pointing
// straight at removedle.org, carrying no marker at all) still rendered the
// egg. Six hours replaced the session cookie as the first fix, bounding the
// egg to one sitting.
//
// That fix still couldn't tell "clicked something on removedle.org" apart from
// "arrived here fresh" -- both just look like "the cookie is present" to a bare
// Max-Age check, so a direct visit to removedle.org within the six-hour window
// still rendered the egg. That's exactly what got reported. Sec-Fetch-Site can
// tell the two cases apart, so it now does the real work and this stays only
// as a backstop: if that header were ever unavailable, the cookie still can't
// outlive six hours
const ALT_COOKIE_MAX_AGE = 6 * 60 * 60;

// Takes the already-resolved flag rather than a hostname: the egg outlives the
// redirect, so by render time the hostname is always the canonical one
function siteName(viaAlias: boolean): string {
    return viaAlias ? ALT_NAME : NAME;
}

export {
    MAX_ROUNDS,
    GUESSES_PER_ROUND,
    MAX_SEARCH_RESULTS,
    ASSETS_URL,
    CHALLENGES_URL,
    ERROR_LINES,
    NAME,
    ALT_HOST,
    ALT_NAME,
    ALT_MARKER,
    ALT_COOKIE,
    ALT_COOKIE_MAX_AGE,
    ALT_HOP_COOKIE,
    ALT_HOP_COOKIE_MAX_AGE,
    siteName,
    DESCRIPTION,
    SITE,
};
