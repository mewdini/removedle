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

export {
    MAX_ROUNDS,
    GUESSES_PER_ROUND,
    ASSETS_URL,
    CHALLENGES_URL,
    ERROR_LINES,
    NAME,
    DESCRIPTION,
    SITE,
};
