import { ASSETS_URL, CHALLENGES_URL } from '$lib/statics';

// Game modes. Each one is a completely separate game: its own catalog, its own
// daily challenges, its own community stats and its own saved progress.
//
// The mode lives in the URL and is the source of truth -- `normal` has no URL
// segment, so its links, R2 keys, localStorage keys and PRNG seed are exactly
// what they always were. The header toggle is just navigation.
//
// Keep this in sync with scripts/lib/modes.js, which is the pipeline-side copy
// (they cannot import each other: this one pulls in $app/environment via
// statics, that one pulls in node:path).

export type ModeId = 'normal' | 'challenger';

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
    /** One-line description, used for the tagline and page metadata. */
    blurb: string;
}

export const MODES: Record<ModeId, ModeConfig> = {
    normal: {
        id: 'normal',
        label: 'Normal',
        segment: '',
        prefix: '',
        storagePrefix: '',
        startDate: '2026-07-24',
        shareLabel: 'removedle',
        blurb: 'A daily Jane Remover song guessing game!',
    },
    challenger: {
        id: 'challenger',
        label: 'Challenger',
        segment: 'challenger',
        prefix: 'challenger/',
        storagePrefix: 'challenger-',
        startDate: '2026-07-24',
        shareLabel: 'removedle challenger',
        blurb: 'Leaks, demos, remixes and covers. For the deep cuts.',
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
    `${CHALLENGES_URL}/${mode.prefix}${date}/round-${round}-guess-${guess}.opus`;

export const gameStorageKey = (mode: ModeConfig, date: string) =>
    `removedle-${mode.storagePrefix}${date}`;
export const statsStorageKey = (mode: ModeConfig) => `removedle-${mode.storagePrefix}stats`;
