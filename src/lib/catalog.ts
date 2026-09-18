import type { Song } from '$lib/interfaces';
import type { ModeConfig } from '$lib/modes';
import { calculateDays } from '$params/date';

// How long a track keeps its NEW badge. Long enough that someone who plays a
// couple of times a week still sees it, short enough that it stays a
// changelist rather than a second copy of the catalog
export const RECENT_WINDOW_DAYS = 14;

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
    // Pacific "today", and treating it as recent is the harmless reading
    return age <= RECENT_WINDOW_DAYS;
}

/**
 * Whether a track should carry the NEW badge. A track added on the mode's
 * start date is part of the launch catalog and never counts: otherwise every
 * song would be badged for the game's first two weeks, which tells a player
 * nothing.
 */
export function isNewTrack(song: Song, mode: ModeConfig, today: string): boolean {
    return !!song.addedAt && song.addedAt > mode.startDate && isRecent(song.addedAt, today);
}

export function describeAge(date: string, today: string): string {
    const days = daysBetween(date, today);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}

/**
 * Comparable form of `releaseDate`, or '' when the track has none.
 *
 * The field keeps the tag's own precision, and a plain string compare would rank
 * a bare "2023" ahead of every dated day in 2023 purely for being the shorter
 * string, so "2023" would land in the wrong half of its own year. Padding the
 * missing components with `-00` pins an imprecise date to the start of its year,
 * which is the conventional reading and, more to the point, is deterministic.
 */
export function releaseKey(song: Song): string {
    if (!song.releaseDate) return '';
    return `${song.releaseDate}-00-00`.slice(0, 10);
}

/**
 * The year for the catalog row. Only ever the year: the month and day are what
 * make the field sortable, not something worth spending a row's width on.
 */
export function releaseYear(song: Song): string | null {
    return song.releaseDate ? song.releaseDate.slice(0, 4) : null;
}

// releaseKey() of each album's earliest track, keyed by album name
// Comparing one song's release date against another's picks the wrong album order: a bonus-track reissue
// can carry a later date than the rest of the album, making it read as newer than it actually is
// The earliest date any of its tracks carries is the closest proxy available for when the release itself came out
// An album with no dated tracks is simply absent from the map, matching releaseKey()'s own empty-string reading
export function albumReleaseKeys(songs: Song[]): Map<string, string> {
    const keys = new Map<string, string>();
    for (const song of songs) {
        const key = releaseKey(song);
        if (!key) continue;
        const existing = keys.get(song.album);
        if (!existing || key < existing) keys.set(song.album, key);
    }
    return keys;
}

/**
 * Case-insensitive substring match over title, artist and album. Deliberately
 * NOT the fuzzy Searcher the game uses: fuzzy matching is right when you are
 * guessing a half-remembered title, but when you are browsing a list you have
 * in front of you it returns rows that look like noise.
 *
 * The artist field is matched but NOT advertised in the placeholder. This is a
 * game about one artist, so "search by artist" promises something the catalog
 * cannot deliver: every normal-mode row is "Jane Remover", and the second name
 * on a challenger remix ("Charli XCX - I Finally Understand (remix)") lives in
 * the TITLE, not here. Keeping the clause costs nothing and quietly helps anyone
 * who types a name anyway.
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
