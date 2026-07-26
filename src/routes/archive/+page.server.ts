import type { PageServerLoad } from './$types';
import { START_DATE_STRING } from '$lib/statics';
import { calculateDays, getTodayDate } from '../../params/date';

export const load: PageServerLoad = async () => {
    const start = new Date(START_DATE_STRING);
    const dayOne = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    );

    // "Today" is the Pacific calendar day (the game rolls over at PT midnight),
    // pinned to UTC-midnight so the enumeration below yields clean date strings.
    const [ty, tm, td] = getTodayDate().split('-').map(Number);
    const todayUtc = new Date(Date.UTC(ty, tm - 1, td));

    const archiveEntries: { date: string; day: number }[] = [];
    const current = new Date(todayUtc);

    while (current >= dayOne) {
        const dateString = current.toISOString().split('T')[0];

        archiveEntries.push({
            date: dateString,
            day: calculateDays(START_DATE_STRING, dateString),
        });

        current.setUTCDate(current.getUTCDate() - 1);
    }

    return {
        archiveEntries,
    };
};
