import type { Song } from '$lib/interfaces';
import type { ModeConfig } from '$lib/modes';
import { calculateDays } from '$params/date';

// How long a track keeps its badge. Long enough that someone who plays a couple
// of times a week still sees what changed, short enough that the "Recent"
// section stays a changelist rather than a second copy of the catalog.
export const RECENT_WINDOW_DAYS = 14;

export type CatalogFlag = 'new' | 'updated';

/**
 * Whole days between two YYYY-MM-DD dates. calculateDays is 1-based because it
 * numbers challenge days ("day #1" is the start date), so the -1 turns it back
 * into an elapsed count where today is 0.
 */
export function daysBetween(from: string, to: string): number {
    return calculateDays(from, to) - 1;
}

function isRecent(date: string | undefined, today: string): boolean {
    if (!date) return false;
    const age = daysBetween(date, today);
    // Guard the upper bound only on the past side. A stamp in the future can
    // only come from a clock skew between the scanning machine and the player's
    // Pacific "today", and treating it as recent is the harmless reading.
    return age <= RECENT_WINDOW_DAYS;
}

/**
 * Badge for a track, or null. A track added on the mode's start date is part of
 * the launch catalog and never counts as new -- otherwise every song would be
 * badged for the game's first two weeks, which tells a player nothing.
 *
 * `new` outranks `updated`: a track added and then retitled inside the same
 * window is news because it arrived, not because its tag was fixed.
 */
export function catalogFlag(song: Song, mode: ModeConfig, today: string): CatalogFlag | null {
    if (song.addedAt && song.addedAt > mode.startDate && isRecent(song.addedAt, today)) {
        return 'new';
    }
    if (isRecent(song.updatedAt, today)) return 'updated';
    return null;
}

/** The date a flag refers to, for sorting and for the "N days ago" label. */
export function flagDate(song: Song, flag: CatalogFlag): string | undefined {
    return flag === 'new' ? song.addedAt : song.updatedAt;
}

export function describeAge(date: string, today: string): string {
    const days = daysBetween(date, today);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}

/**
 * The most recent thing that happened to a track, for the "Newest" ordering.
 * Sorts on both stamps rather than just `addedAt`, or a retitle -- half the
 * point of the changelist -- would never move a track up the list.
 */
export function lastTouched(song: Song): string {
    const dates = [song.addedAt, song.updatedAt].filter(Boolean) as string[];
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : '';
}

/** What actually changed, for the line under an `updated` track. */
export function describeChange(song: Song): string | null {
    const parts: string[] = [];
    if (song.previousTitle) parts.push(`was “${song.previousTitle}”`);
    if (song.previousAlbum) parts.push(`moved from ${song.previousAlbum}`);
    return parts.length ? parts.join(' · ') : null;
}

/**
 * Case-insensitive substring match over title, artist and album. Deliberately
 * NOT the fuzzy Searcher the game uses: fuzzy matching is right when you are
 * guessing a half-remembered title, but when you are browsing a list you have
 * in front of you it returns rows that look like noise.
 */
export function matchesQuery(song: Song, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
        song.title.toLowerCase().includes(q) ||
        song.artist.toLowerCase().includes(q) ||
        song.album.toLowerCase().includes(q)
    );
}
