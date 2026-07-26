import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(param)) return false;

    const [year, month, day] = param.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export function calculateDays(startDate: string, endDate: string) {
    const startPart = startDate.split('T')[0];
    const endPart = endDate.split('T')[0];

    const start = new Date(`${startPart}T00:00:00Z`);
    const end = new Date(`${endPart}T00:00:00Z`);

    const timeDifference = end.valueOf() - start.valueOf();
    const daysDifference = timeDifference / (1000 * 3600 * 24);
    return Math.round(daysDifference) + 1;
}

export function getTodayDate() {
    // The game rolls over at Pacific midnight, not UTC. `Intl` gives the calendar
    // date in America/Los_Angeles (auto-handling PST/PDT) as YYYY-MM-DD. It works
    // the same on the server (Workers ship full ICU) and in every visitor's
    // browser regardless of their local timezone, so all players load the same
    // Pacific day.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}
