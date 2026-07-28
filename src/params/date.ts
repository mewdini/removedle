import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(param)) return false;

    const [year, month, day] = param.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

// The hour, on a Pacific clock, at which the game rolls over to the next day.
// This is the ONE number that defines the boundary; everything else here derives
// from it. Duplicated in scripts/lib/dates.js for the pipeline -- keep them equal.
export const RESET_HOUR_PT = 21;

const PACIFIC = 'America/Los_Angeles';

// hourCycle: 'h23' is load-bearing. With `hour12: false` some ICU builds render
// midnight as "24", which would push the hour over RESET_HOUR_PT and roll the day
// a second time in the first hour after Pacific midnight.
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

// The Pacific wall clock at `now`, as a calendar date plus a time of day. Both
// halves come from a SINGLE format call, so they always describe the same instant
// on the same side of a DST transition.
function pacificParts(now: Date) {
    const parts: Record<string, string> = {};
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

// Shift a YYYY-MM-DD string by whole days. Pinned to UTC midnight purely to do
// the arithmetic on clean date strings: no wall clock is involved, so there is no
// DST transition for it to step over.
export function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function calculateDays(startDate: string, endDate: string) {
    const startPart = startDate.split('T')[0];
    const endPart = endDate.split('T')[0];

    const start = new Date(`${startPart}T00:00:00Z`);
    const end = new Date(`${endPart}T00:00:00Z`);

    const timeDifference = end.valueOf() - start.valueOf();
    const daysDifference = timeDifference / (1000 * 3600 * 24);
    return Math.round(daysDifference) + 1;
}

// Which challenge is live right now, as YYYY-MM-DD.
//
// The game rolls over at 21:00 on a Pacific clock, so for the last three hours of
// each Pacific calendar day this deliberately returns TOMORROW'S date. That is
// why it is not called "today": between 21:00 and midnight PT the game day and
// the Pacific calendar day genuinely differ, and treating the two as the same
// thing is the bug this name exists to prevent.
//
// Read as a wall clock rather than a fixed offset, so it stays 9pm local across
// PST/PDT. `Intl` behaves identically on the server (Workers ship full ICU) and
// in every visitor's browser regardless of their own timezone, so all players
// cross the boundary at the same instant.
//
// The sequence never skips or repeats a day: at 20:59 PT on D it yields D, at
// 21:00 PT on D it yields D+1, and at 00:00 PT on D+1 the Pacific date advances
// to D+1 as the +1 falls away, yielding D+1 again.
export function getGameDate(now: Date = new Date()): string {
    const { date, hour } = pacificParts(now);
    return hour >= RESET_HOUR_PT ? addDays(date, 1) : date;
}

// Seconds until the next rollover, for the countdown. Derived from the Pacific
// wall clock so it agrees with getGameDate by construction rather than by a
// second, separately-maintained piece of timezone arithmetic.
export function secondsUntilReset(now: Date = new Date()): number {
    const { hour, minute, second } = pacificParts(now);
    const elapsed = hour * 3600 + minute * 60 + second;
    return (RESET_HOUR_PT * 3600 - elapsed + 86400) % 86400;
}
