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
// Set as a SESSION cookie (see the handle hook), so the egg lasts the visit that
// came in through the alias and no longer. It must not outlive the browser: the
// egg is for using the janedle URL, not a permanent rebrand of every later visit
// made directly to removedle.org.
const ALT_COOKIE = 'via-janedle';

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
    siteName,
    DESCRIPTION,
    SITE,
};
