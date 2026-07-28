import { dev } from '$app/environment';

const MAX_ROUNDS = 5;
const GUESSES_PER_ROUND = 3;
// Day 1 is per mode and lives on the mode config (`startDate` in $lib/modes).
// It is deliberately NOT duplicated here: a second copy would look
// authoritative while being ignored by every date route and archive listing.
const ASSETS_URL = dev ? '/assets' : 'https://assets.removedle.org';
// Always same-origin: challenge media is served by src/routes/challenges/[date]/[file],
// which gates future dates. It must never point at a public bucket, as that would
// expose tomorrow's answers, which are uploaded the evening before.
const CHALLENGES_URL = '/challenges';
// Shown when hitting a 404 page; pulled from the lyric metadata on the masters in
// masters/. `song` must match a catalog title exactly so the error page can resolve
// its streaming links for the hover reveal.
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
// wrangler.jsonc) whose only job is to redirect to SITE -- see the handle hook
// in src/hooks.server.ts.
//
// It MUST NOT serve the game, because localStorage is per-origin and this game
// keeps the board, the streak and the stats there. A player who arrived on a
// second origin would silently start a separate save and lose their streak, so
// one origin owns all game state and the alias only ever points at it.
//
// Arriving through the alias still earns a wordmark easter egg, kept as two
// words the way the artist's own name splits. The marker cannot be a cookie set
// by the alias itself -- a response from janedle.org cannot Set-Cookie for
// removedle.org -- so it rides in the query string for exactly one hop and is
// then traded for ALT_COOKIE.
const ALT_HOST = 'janedle.org';
const ALT_NAME = 'janedle removedle';
// One-hop query marker. Stripped as soon as it becomes the cookie, so it never
// lingers in a shareable URL.
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
// expired -- clearing it would mean writing a Set-Cookie on requests that need
// no response header at all, to reclaim ~14 bytes that the browser drops on its
// next real restart anyway. Renaming again is the fix if this ever recurs.
const ALT_COOKIE = 'via-janedle-v2';
// Six hours, in seconds -- how long the easter egg survives.
//
// This was originally a SESSION cookie (no Max-Age, no Expires), on the theory
// that "the browser closes" is the natural end of a visit. It is not, and that
// is why this constant exists: mobile Safari and Chrome are effectively never
// closed, and desktop Chrome's "Continue where you left off" restores session
// cookies across a restart. So one trip through janedle.org branded the browser
// indefinitely, and a later click from an unrelated site -- the reported case
// was a t.co link pointing straight at removedle.org, carrying no marker at all
// -- still rendered the egg. A session cookie states the intent without
// enforcing it; only an explicit Max-Age enforces it.
//
// Six hours bounds the egg to one sitting. A round is 5 songs and a few
// minutes, but a player may wander off and come back the same evening, and this
// covers that comfortably. It is also a quarter of a day, so it can never reach
// the next day's puzzle (the game rolls over every 24h at 21:00 PT) and a visit
// arriving from somewhere else tomorrow is always unbranded -- which is the
// property that was actually broken.
//
// The window does NOT slide. The cookie is only ever written on the single hop
// that carries ALT_MARKER, so the clock starts when the player came through the
// alias and continued play never extends it. That is deliberate: re-stamping it
// on every request would keep a daily player branded forever, which is the bug
// again by another route.
const ALT_COOKIE_MAX_AGE = 6 * 60 * 60;

// Takes the already-resolved flag rather than a hostname: the egg outlives the
// redirect, so by render time the hostname is always the canonical one.
function siteName(viaAlias: boolean): string {
    return viaAlias ? ALT_NAME : NAME;
}

export {
    MAX_ROUNDS,
    GUESSES_PER_ROUND,
    ASSETS_URL,
    CHALLENGES_URL,
    ERROR_LINES,
    NAME,
    ALT_HOST,
    ALT_NAME,
    ALT_MARKER,
    ALT_COOKIE,
    ALT_COOKIE_MAX_AGE,
    siteName,
    DESCRIPTION,
    SITE,
};
