// The game's day rolls over at 21:00 on a Pacific clock, not at midnight and not
// in UTC. Anything the pipeline stamps or schedules with a date has to agree with
// that, or CI (UTC) and a local run disagree about which day it is -- a scan at
// 06:09 UTC is already the next UTC day, and a "new for 14 days" badge stamped on
// the wrong day flips a day early or late against the client's own reckoning.
//
// Deliberately a duplicate of src/params/date.ts rather than an import: that file
// is TypeScript behind the $params alias and pulls in @sveltejs/kit types, the
// same reason scripts/lib/modes.js duplicates src/lib/modes.ts.
//
// RESET_HOUR_PT is the one value that must be kept equal across the two copies.
// The rest is derivation. If you change the hour here, change it there.
export const RESET_HOUR_PT = 21;

const PACIFIC = 'America/Los_Angeles';

// hourCycle: 'h23' is load-bearing -- `hour12: false` can render midnight as "24"
// on some ICU builds, which would roll the day a second time just after midnight.
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

function pacificParts(now) {
    const parts = {};
    for (const part of PACIFIC_PARTS.formatToParts(now)) {
        if (part.type !== 'literal') parts[part.type] = part.value;
    }

    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour),
    };
}

// Shift a YYYY-MM-DD string by whole days. UTC-pinned so the arithmetic runs on
// clean date strings; no wall clock is involved, so there is no DST step to hit.
export function addDays(date, days) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Which challenge is live right now. For the last three hours of each Pacific
// calendar day this returns TOMORROW'S date -- that is the point, and it is why
// this is not called todayPacific.
export function gameDate(now = new Date()) {
    const { date, hour } = pacificParts(now);
    return hour >= RESET_HOUR_PT ? addDays(date, 1) : date;
}
