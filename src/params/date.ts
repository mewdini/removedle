import type { ParamMatcher } from '@sveltejs/kit';
import { RESET_HOUR_PT, addDays, gameDate, pacificParts } from '$lib/shared/game-core';

export const match: ParamMatcher = (param) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(param)) return false;

    const [year, month, day] = param.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

// The Pacific reset hour, the Pacific wall-clock read, and the day arithmetic
// live in $lib/shared/game-core, the one copy scripts/lib/dates.js reads too.
// RESET_HOUR_PT is the ONE number that defines the boundary; everything else
// derives from it
export { RESET_HOUR_PT, addDays };

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
// to D+1 as the +1 falls away, yielding D+1 again
export function getGameDate(now: Date = new Date()): string {
    return gameDate(now);
}

// Whether the Pacific CALENDAR date is the given MM-DD, in any year
//
// The calendar day on purpose, not getGameDate(), which flips at 21:00 PT and
// would switch a birthday off three hours before it ends
// Not the visitor's own clock either: the server renders the same markup, and
// a local-time check would disagree with it for anyone whose date differs from
// the server's, which shows up as a flash after hydration
export function isMonthDay(monthDay: string, now: Date = new Date()): boolean {
    return pacificParts(now).date.slice(5) === monthDay;
}

// Seconds until the next rollover, for the countdown. Derived from the Pacific
// wall clock so it agrees with getGameDate by construction rather than by a
// second, separately-maintained piece of timezone arithmetic
export function secondsUntilReset(now: Date = new Date()): number {
    const { hour, minute, second } = pacificParts(now);
    const elapsed = hour * 3600 + minute * 60 + second;
    return (RESET_HOUR_PT * 3600 - elapsed + 86400) % 86400;
}
