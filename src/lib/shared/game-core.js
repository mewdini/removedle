// The values the app (src/) and the pipeline (scripts/) must agree on
//
// This file is plain JS with no imports on purpose: the app bundles it through
// Vite and the scripts run it under bare node, and neither side can load the
// other's own config (modes.ts pulls in $app/environment through statics,
// scripts/lib/modes.js pulls in node:path). Keep it free of both, and free of
// anything that only one side needs
//
// Deliberately NOT here:
//   seedPrefix     pipeline only, and changing normal's re-rolls every day
//   src/params/mode.ts
//                  its literal 'challenger' is hardcoded so the matcher stays
//                  statically analysable and can never be attacker-controlled

/** @typedef {'normal' | 'challenger'} ModeId */

/**
 * @typedef {object} ModeCore
 * @property {ModeId} id
 * @property {string} label
 * @property {'' | 'challenger'} segment URL segment, '' keeps / and /archive for the default mode
 * @property {'' | 'challenger/'} prefix R2 key and assets path prefix, with trailing slash
 * @property {string} startDate Day 1, for the archive and the displayed day number
 */

/** @type {Record<ModeId, ModeCore>} */
export const MODE_CORE = {
    normal: {
        id: 'normal',
        label: 'Normal',
        segment: '',
        prefix: '',
        startDate: '2026-07-24',
    },
    challenger: {
        id: 'challenger',
        label: 'Challenger',
        segment: 'challenger',
        prefix: 'challenger/',
        startDate: '2026-07-24',
    },
};

export const MAX_ROUNDS = 5;
export const GUESSES_PER_ROUND = 3;

// Written by scripts/generate-daily.js and fetched by the app, so the two
// cannot be allowed to spell it differently
/**
 * @param {number} round
 * @param {number} guess
 */
export const snippetFileName = (round, guess) => `round-${round}-guess-${guess}.opus`;

// The hour, on a Pacific clock, at which the game rolls over to the next day
// This is the ONE number that defines the boundary, everything else derives from it
export const RESET_HOUR_PT = 21;

const PACIFIC = 'America/Los_Angeles';

// hourCycle: 'h23' is load-bearing
// With `hour12: false` some ICU builds render midnight as "24", which would push
// the hour over RESET_HOUR_PT and roll the day a second time just after Pacific midnight
const PACIFIC_PARTS = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

// The Pacific wall clock at `now`, as a calendar date plus a time of day
// Both halves come from a SINGLE format call, so they always describe the same
// instant on the same side of a DST transition
/** @param {Date} now */
export function pacificParts(now) {
    /** @type {Record<string, string>} */
    const parts = {};
    for (const part of PACIFIC_PARTS.formatToParts(now)) {
        if (part.type !== 'literal') parts[part.type] = part.value;
    }

    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}

// Shift a YYYY-MM-DD string by whole days
// Pinned to UTC midnight purely to do the arithmetic on clean date strings, no
// wall clock is involved, so there is no DST transition for it to step over
/**
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Which challenge is live right now, as YYYY-MM-DD
//
// For the last three hours of each Pacific calendar day this deliberately
// returns TOMORROW'S date, which is why it is not called "today": between 21:00
// and midnight PT the game day and the Pacific calendar day genuinely differ
//
// Read as a wall clock rather than a fixed offset, so it stays 9pm local across
// PST/PDT. The sequence never skips or repeats a day: 20:59 PT on D yields D,
// 21:00 PT on D yields D+1, and 00:00 PT on D+1 yields D+1 again as the +1 falls away
/** @param {Date} [now] */
export function gameDate(now = new Date()) {
    const { date, hour } = pacificParts(now);
    return hour >= RESET_HOUR_PT ? addDays(date, 1) : date;
}
