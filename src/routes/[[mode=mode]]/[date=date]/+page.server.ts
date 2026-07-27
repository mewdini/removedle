import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
    getGlobalData,
    isBeforeFirstChallengeDate,
    isFutureChallengeDate,
    loadChallengeByDate,
    updateGlobalData,
} from '$lib/server/challenges';
import { calculateDays } from '$params/date';
import { resolveMode } from '$lib/modes';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ params, fetch, platform, depends }) => {
    // Scoped so a post-save refresh can re-run just this load (the D1 stats read)
    // without re-triggering the layout's full-catalog fetch. See Game.svelte.
    depends('app:stats');

    const mode = resolveMode(params.mode);
    const date = params.date;

    if (isFutureChallengeDate(date) || isBeforeFirstChallengeDate(mode, date)) {
        throw error(404, 'Challenge not found');
    }

    const dailyMeta = await loadChallengeByDate(fetch, mode, date);
    const db = drizzle(platform?.env?.DB, { schema });
    const globalData = await getGlobalData(db, mode.id, date);

    return {
        date,
        day: calculateDays(mode.startDate, date),
        dailyMeta,
        globalData,
    };
};

export const actions = {
    saveScore: async ({ params, request, platform }) => {
        const mode = resolveMode(params.mode);
        const data = await request.formData();
        const points = Number(data.get('points'));

        if (isNaN(points)) {
            return { success: false, error: 'Invalid points' };
        }

        const db = drizzle(platform?.env?.DB, { schema });
        return await updateGlobalData(db, mode, params.date, points);
    },
};
