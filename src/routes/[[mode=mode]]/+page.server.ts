import type { PageServerLoad } from './$types';
import { getGlobalData, loadChallengeByDate, updateGlobalData } from '$lib/server/challenges';
import type { DailyMeta } from '$lib/interfaces';
import { calculateDays, getTodayDate } from '$params/date';
import { resolveMode } from '$lib/modes';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ params, fetch, platform, depends }) => {
    // Scoped so a post-save refresh can re-run just this load (the D1 stats read)
    // without re-triggering the layout's full-catalog fetch. See Game.svelte.
    depends('app:stats');

    const mode = resolveMode(params.mode);
    const today = getTodayDate();

    const dailyMeta: DailyMeta | null = await loadChallengeByDate(fetch, mode, today);
    if (!dailyMeta) {
        return {
            date: null,
            day: null,
            dailyMeta: null,
        };
    }

    const db = drizzle(platform?.env?.DB, { schema });
    const globalData = await getGlobalData(db, mode.id, today);

    return {
        date: today,
        day: calculateDays(mode.startDate, today),
        dailyMeta,
        globalData,
    };
};

export const actions = {
    // Game.svelte posts to the relative '?/saveScore', so this inherits the mode
    // from whichever URL the player is on.
    saveScore: async ({ params, request, platform }) => {
        const mode = resolveMode(params.mode);
        const today = getTodayDate();
        const data = await request.formData();
        const points = Number(data.get('points'));

        if (isNaN(points)) {
            return { success: false, error: 'Invalid points' };
        }

        const db = drizzle(platform?.env?.DB, { schema });
        return await updateGlobalData(db, mode, today, points);
    },
};
