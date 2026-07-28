import type { ThemeName } from './themes';

export interface Song {
    id: string;
    artist: string;
    title: string;
    album: string;
    links: StreamingLinks;
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
