import { ASSETS_URL, CHALLENGES_URL } from '$lib/statics';
import { MODE_CORE, snippetFileName } from '$lib/shared/game-core';
import type { ModeId } from '$lib/shared/game-core';

// Game modes. Each one is a completely separate game: its own catalog, its own
// daily challenges, its own community stats and its own saved progress.
//
// The mode lives in the URL and is the source of truth: `normal` has no URL
// segment, so its links, R2 keys, localStorage keys and PRNG seed are exactly
// what they always were. The header toggle is just navigation.
//
// id, label, segment, prefix and startDate come from $lib/shared/game-core, the
// one copy scripts/lib/modes.js reads as well. Only what the app alone needs is
// written out here.

export type { ModeId };

export interface Blurb {
    text: string;
    /**
     * Track the blurb quotes, cited under the tagline the same way the 404
     * lines are (see ERROR_LINES in $lib/statics).
     */
    song?: string;
    /** Who said it and where, for a quote that is not a lyric. Cited as a link. */
    source?: { name: string; url: string };
}

export interface ModeConfig {
    id: ModeId;
    label: string;
    /** URL segment. '' keeps /, /<date> and /archive for the default mode. */
    segment: '' | 'challenger';
    /** R2 key and assets path prefix, with trailing slash. */
    prefix: '' | 'challenger/';
    /** localStorage namespace. '' preserves the keys live players already have. */
    storagePrefix: '' | 'challenger-';
    /** Day 1, for the archive and the displayed day number. */
    startDate: string;
    /** Prefix for shared results text, so two modes' scores are told apart. */
    shareLabel: string;
    /**
     * The artist every track in this mode is by. The catalog browser omits the
     * artist line when it matches, because this is a game about ONE artist and
     * repeating their name on every row is noise that crowds out the album and
     * year. It renders only when a track credits somebody else too, which is the
     * only case where the field carries information.
     */
    primaryArtist: string;
    /**
     * Taglines, one picked at random per load (see +layout.server.ts).
     * The first is also the page metadata, text alone, so link previews stay
     * stable and the description stays a sentence rather than a citation.
     */
    blurbs: readonly [Blurb, ...Blurb[]];
}

export const MODES: Record<ModeId, ModeConfig> = {
    normal: {
        ...MODE_CORE.normal,
        storagePrefix: '',
        shareLabel: 'removedle',
        primaryArtist: 'Jane Remover',
        blurbs: [{ text: 'Guess the Jane Remover songs daily!' }],
    },
    challenger: {
        ...MODE_CORE.challenger,
        storagePrefix: 'challenger-',
        shareLabel: 'removedle challenger',
        primaryArtist: 'Jane Remover',
        blurbs: [
            {
                text: "That challenger, who's already come this far, is going to face their final opponent!",
                song: 'Professional Vengeance',
            },
            {
                text: 'I had to run it back on challenge mode',
                source: {
                    name: 'Jane Remover',
                    url: 'https://x.com/janeremover/status/2106278857372553685',
                },
            },
        ],
    },
};

export const MODE_LIST: readonly ModeConfig[] = [MODES.normal, MODES.challenger];

/** Resolve a route param (or anything else) to a mode, defaulting to normal. */
export function resolveMode(param: string | undefined | null): ModeConfig {
    return param === MODES.challenger.segment ? MODES.challenger : MODES.normal;
}

/** The value to pass as the `mode` route param. undefined means "no segment". */
export function modeParam(mode: ModeConfig): 'challenger' | undefined {
    return mode.segment || undefined;
}

export const catalogUrl = (mode: ModeConfig) => `${ASSETS_URL}/${mode.prefix}songs.json`;
export const albumMapUrl = (mode: ModeConfig) => `${ASSETS_URL}/${mode.prefix}covers.json`;
export const artUrl = (mode: ModeConfig, file: string) => `${ASSETS_URL}/${mode.prefix}art/${file}`;

export const metaUrl = (mode: ModeConfig, date: string) =>
    `${CHALLENGES_URL}/${mode.prefix}${date}/meta.json`;
export const snippetUrl = (mode: ModeConfig, date: string, round: number, guess: number) =>
    `${CHALLENGES_URL}/${mode.prefix}${date}/${snippetFileName(round, guess)}`;

// Same-origin proxy for a mode's catalog, used by the catalog browser to show a
// mode other than the one being played (see src/routes/catalog/[[mode=mode]]).
// An absolute path on purpose: resolve() returns URLs relative to the current
// route, which would make this land on a different path depending on which page
// the modal was opened from.
export const catalogFeedUrl = (mode: ModeConfig) =>
    mode.segment ? `/catalog/${mode.segment}` : '/catalog';

export const gameStorageKey = (mode: ModeConfig, date: string) =>
    `removedle-${mode.storagePrefix}${date}`;
export const statsStorageKey = (mode: ModeConfig) => `removedle-${mode.storagePrefix}stats`;
