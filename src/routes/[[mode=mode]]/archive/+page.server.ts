import type { PageServerLoad } from './$types';
import { resolveMode } from '$lib/modes';
import { calculateDays, getGameDate } from '$params/date';

export const load: PageServerLoad = async ({ params }) => {
    const mode = resolveMode(params.mode);

    const start = new Date(mode.startDate);
    const dayOne = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    );

    // The newest entry is the day that is live right now (the game rolls over at
    // 21:00 PT, so after 9pm this is already the next date), pinned to UTC
    // midnight so the enumeration below yields clean date strings.
    const [ty, tm, td] = getGameDate().split('-').map(Number);
    const liveUtc = new Date(Date.UTC(ty, tm - 1, td));

    const archiveEntries: { date: string; day: number }[] = [];
    const current = new Date(liveUtc);

    while (current >= dayOne) {
        const dateString = current.toISOString().split('T')[0];

        archiveEntries.push({
            date: dateString,
            day: calculateDays(mode.startDate, dateString),
        });

        current.setUTCDate(current.getUTCDate() - 1);
    }

    return {
        archiveEntries,
    };
};
