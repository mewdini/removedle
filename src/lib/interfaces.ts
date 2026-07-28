import type { ThemeName } from './themes';

export interface Song {
    id: string;
    artist: string;
    title: string;
    album: string;
    links: StreamingLinks;
    /**
     * When the recording came out, read from the master's tags by
     * scripts/scan-songs.js. Carries whatever precision the tag had -- `YYYY`,
     * `YYYY-MM` or `YYYY-MM-DD` -- so it is never more confident than the source.
     *
     * Optional, and genuinely often absent: 9 of challenger's 48 masters are
     * leaks and demos with no usable date tag at all, and any manifest published
     * before this field existed has none either. Sort with releaseKey(), which
     * pads the partial forms and sends "unknown" to the end of the list.
     */
    releaseDate?: string;
    /**
     * Catalog provenance, stamped by scripts/scan-songs.js and used only by the
     * catalog browser. All optional: a manifest published before these existed
     * simply has none, and every consumer treats that as "no badge".
     *
     * `addedAt` on a mode's startDate means "part of the launch catalog", which
     * is the baseline rather than an event -- see trackProvenance() in the scan.
     * `previous*` describe the change `updatedAt` refers to.
     */
    addedAt?: string;
    updatedAt?: string;
    previousTitle?: string;
    previousAlbum?: string;
}

export interface Guess {
    status: GuessStatus;
    id: string;
    title: string;
}

export type RoundStatus = 'playing' | 'won' | 'lost';
export type GuessStatus = 'skip' | 'wrong' | 'correct';

export interface GameState {
    currentRound: number;
    roundGuesses: Guess[][];
    roundStatuses: RoundStatus[];
    hasSaved?: boolean;
}

export interface DailyMeta {
    date: string;
    rounds: RoundInfo[];
}

export interface RoundInfo {
    round: number;
    songId: string;
}

export interface AlbumArt {
    name: string;
    file: string;
    isSingle: boolean;
}

export type AppSettings = {
    volume: number;
    theme: ThemeName;
    firstTimeHelp: boolean;
};

export type ArchiveEntry = {
    date: string;
    day: number;
};

export type StreamingLinks = {
    appleMusic?: string;
    bandcamp?: string;
    soundcloud?: string;
    spotify?: string;
    tidal?: string;
    youtube?: string;
    youtubeMusic?: string;
};
