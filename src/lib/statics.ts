import { dev } from '$app/environment';

const MAX_ROUNDS = 5;
const GUESSES_PER_ROUND = 3;
// Day 1. The site went live on this date; earlier dates were test data and are
// rejected by the date routes rather than merely hidden from the archive.
const START_DATE_STRING = '2026-07-24';
const ASSETS_URL = dev ? '/assets' : 'https://assets.removedle.org';
// Always same-origin: challenge media is served by src/routes/challenges/[date]/[file],
// which gates future dates. It must never point at a public bucket, as that would
// expose tomorrow's answers, which are uploaded the evening before.
const CHALLENGES_URL = '/challenges';
const ERROR_LINES = [
    //seen when hitting a 404 page
    "Stop me if you've heard this one before...",
    'Bozo, bozo, bozo...',
    'Stupid, stupid, stupid...',
    "Quite the mistake you've made...",
    "I'm going to assume something, is that fine?",
    'I never expected this...',
    'Slow down, slow down...',
    'What you tryna do?',
    "I got a problem and it's not my fault...",
    'You must be kidding me!',
    'Happens all the time...',
    "It's not the end of the world!",
    "Oh dear, that's rather alarming...",
];
const NAME = 'removedle';
const DESCRIPTION =
    'A daily Jane Remover song guessing game featuring five songs and three guesses per track. How many can you get right?';
const SITE = 'https://removedle.org';

export {
    MAX_ROUNDS,
    GUESSES_PER_ROUND,
    START_DATE_STRING,
    ASSETS_URL,
    CHALLENGES_URL,
    ERROR_LINES,
    NAME,
    DESCRIPTION,
    SITE,
};
