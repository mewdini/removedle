import type { ThemeName } from './themes';

export interface Song {
    id: string;
    artist: string;
    title: string;
    album: string;
    links: StreamingLinks;
    // When the recording came out, read from the master's tags by scripts/scan-songs.js
    // Carries whatever precision the tag had (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`)
    // Never more confident than the source
    //
    // Optional, and genuinely often absent: a chunk of challenger's masters are leaks and demos with no usable
    // date tag at all, and any manifest published before this field existed has none either
    // Sort with releaseKey(), which pads the partial forms and sends "unknown" to the end of the list
    releaseDate?: string;
    // Track number within `album`, read from the master's tags
    // Only meaningful for ordering tracks inside the SAME album; comparing it across albums is meaningless,
    // since a "track 1" on one release and a "track 1" on another are unrelated
    // Absent on untagged masters and on manifests published before this field existed
    trackNumber?: number;
    // Catalog provenance, stamped by scripts/scan-songs.js. All optional: a
    // manifest published before these existed simply has none
    //
    // `addedAt` is the only one the catalog browser reads, for the NEW badge.
    // `addedAt` on a mode's startDate means "part of the launch catalog", which
    // is the baseline rather than an event; see trackProvenance() in the scan
    //
    // `updatedAt`/`previous*` record a retitle or rebadge but are no longer
    // surfaced anywhere in the UI -- an UPDATED badge read as developer-only
    // noise to a player. Kept in the registry as the pipeline's own changelist
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
    // Absent when the master had no embedded art to extract; AlbumArt.svelte
    // already falls back to a placeholder for that case
    file?: string;
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

export type Theme = {
    bg: string;
    text: string;
    accent: string;
    card: string;
    muted: string;
};

export type SharedSnippetPlayer = {
    mount(): void;
    destroy(): void;
    play(src: string): Promise<void>;
    stop(): void;
    setVolume(volume: number): void;
    getCurrentSrc(): string | null;
    isPlaying(src: string): boolean;
};

export type TipSegment = {
    text: string;
    href?: string;
    // Links to Challenger in the current player's own game day, rather than a
    // fixed href: tip data has no access to the date or resolve(), and this
    // keeps it internal navigation (same tab) instead of the external-link
    // treatment every other href gets
    internal?: boolean;
    bold?: boolean;
};

export type Tip = {
    segments: TipSegment[];
};
