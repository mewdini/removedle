import type { DailyMeta, Song, StreamingLinks } from '$lib/interfaces';
import { GUESSES_PER_ROUND, MAX_ROUNDS } from '$lib/statics';
import { albumMapUrl, catalogUrl, metaUrl, MODES, type ModeConfig, type ModeId } from '$lib/modes';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { challengeStats } from './db/schema';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { getGameDate } from '$params/date';

type AlbumEntry = {
    name: string;
    file: string;
};

export function isFutureChallengeDate(value: string): boolean {
    // Future = after the currently live game day (the game rolls over at 21:00
    // Pacific, so for the last three hours of a Pacific day this is already
    // tomorrow's date -- see getGameDate). Zero-padded ISO date strings compare
    // lexically in chronological order, and `value` is validated as YYYY-MM-DD by
    // the date param matcher. Mode-independent: every mode unlocks the same day
    // at the same instant.
    return value > getGameDate();
}

// Dates before a mode's day 1 are not part of that game. Without this they are
// merely absent from the archive listing but still reachable by URL, and loading
// one lazily inserts an empty challengeStats row via getGlobalData.
export function isBeforeFirstChallengeDate(mode: ModeConfig, value: string): boolean {
    const [year, month, day] = value.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));

    const [sy, sm, sd] = mode.startDate.split('-').map(Number);
    const start = new Date(Date.UTC(sy, sm - 1, sd));

    return candidate.getTime() < start.getTime();
}

export async function loadChallengeByDate(
    fetchFn: typeof fetch,
    mode: ModeConfig,
    date: string
): Promise<DailyMeta | null> {
    const res = await fetchFn(metaUrl(mode, date));

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load ${mode.id} challenge metadata for ${date}`);

    return res.json();
}

export async function loadSongCatalog(fetchFn: typeof fetch, mode: ModeConfig): Promise<Song[]> {
    const res = await fetchFn(catalogUrl(mode));
    if (!res.ok) throw new Error(`Failed to load ${mode.id} song catalog`);
    return res.json();
}

// Streaming links for the track a mode's blurb quotes, so the citation under the
// tagline offers the same platform buttons the 404 line does. The quotes come
// from official releases, so challenger -- whose catalog is leaks and demos --
// has to fall back to normal's catalog to find one. Decorative, so a lookup that
// fails returns no links and the citation renders as plain text.
export async function loadBlurbLinks(
    fetchFn: typeof fetch,
    mode: ModeConfig,
    songList: Song[]
): Promise<StreamingLinks> {
    if (!mode.blurbSong) return {};

    const local = songList.find((s) => s.title === mode.blurbSong);
    if (local) return local.links ?? {};

    try {
        const catalog = await loadSongCatalog(fetchFn, MODES.normal);
        return catalog.find((s) => s.title === mode.blurbSong)?.links ?? {};
    } catch (e) {
        console.warn(`Failed to resolve blurb links for ${mode.id}:`, e);
        return {};
    }
}

export async function loadAlbumMap(fetchFn: typeof fetch, mode: ModeConfig): Promise<AlbumEntry[]> {
    const res = await fetchFn(albumMapUrl(mode));
    if (!res.ok) throw new Error(`Failed to load ${mode.id} album map`);
    return res.json();
}

// Community stats are keyed on (mode, date): each mode is a separate game, so a
// day's totals must not be shared between them.
export async function getGlobalData(
    db: DrizzleD1Database<typeof schema>,
    mode: ModeId,
    date: string
) {
    const data = await db
        .select()
        .from(challengeStats)
        .where(and(eq(challengeStats.mode, mode), eq(challengeStats.date, date)));

    //if there's no data for the date yet
    if (data.length === 0) {
        return insertNewGlobalData(db, mode, date);
    }

    return data[0];
}

async function insertNewGlobalData(
    db: DrizzleD1Database<typeof schema>,
    mode: ModeId,
    date: string
) {
    const newRow = await db.insert(challengeStats).values({ mode, date }).returning();
    return newRow[0];
}

export async function updateGlobalData(
    db: DrizzleD1Database<typeof schema>,
    mode: ModeConfig,
    date: string,
    points: number
) {
    if (
        isFutureChallengeDate(date) ||
        isBeforeFirstChallengeDate(mode, date) ||
        points < 0 ||
        points > MAX_ROUNDS * GUESSES_PER_ROUND
    ) {
        return { success: false };
    }

    await db
        .update(challengeStats)
        .set({
            totalGames: sql`${challengeStats.totalGames} + 1`,
            totalPoints: sql`${challengeStats.totalPoints} + ${points}`,
        })
        .where(and(eq(challengeStats.mode, mode.id), eq(challengeStats.date, date)));

    return { success: true };
}
