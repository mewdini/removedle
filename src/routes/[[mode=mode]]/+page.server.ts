import type { PageServerLoad } from './$types';
import { getGlobalData, loadChallengeByDate, updateGlobalData } from '$lib/server/challenges';
import type { DailyMeta } from '$lib/interfaces';
import { calculateDays, getGameDate } from '$params/date';
import { resolveMode } from '$lib/modes';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ params, fetch, platform, depends }) => {
    // Scoped so a post-save refresh can re-run just this load (the D1 stats read)
    // without re-triggering the layout's full-catalog fetch. See Game.svelte.
    depends('app:stats');
    // Scoped separately from the stats read: this is the one invalidated when the
    // 21:00 PT rollover happens under an open tab, and it re-runs this load (and
    // so re-evaluates getGameDate) without disturbing the layout's catalog fetch.
    depends('app:day');

    const mode = resolveMode(params.mode);
    const gameDate = getGameDate();

    const dailyMeta: DailyMeta | null = await loadChallengeByDate(fetch, mode, gameDate);
    if (!dailyMeta) {
        return {
            date: null,
            day: null,
            dailyMeta: null,
            live: true,
        };
    }

    const db = drizzle(platform?.env?.DB, { schema });
    const globalData = await getGlobalData(db, mode.id, gameDate);

    return {
        date: gameDate,
        day: calculateDays(mode.startDate, gameDate),
        dailyMeta,
        globalData,
        // This route always renders whatever day is live right now, unlike the
        // dated route whose date is pinned by the URL. Game.svelte uses this to
        // decide whether it may refresh itself across a rollover.
        live: true,
    };
};

export const actions = {
    // Game.svelte posts to the relative '?/saveScore', so this inherits the mode
    // from whichever URL the player is on.
    saveScore: async ({ params, request, platform }) => {
        const mode = resolveMode(params.mode);
        const gameDate = getGameDate();
        const data = await request.formData();
        const points = Number(data.get('points'));

        if (isNaN(points)) {
            return { success: false, error: 'Invalid points' };
        }

        const db = drizzle(platform?.env?.DB, { schema });
        return await updateGlobalData(db, mode, gameDate, points);
    },
};
