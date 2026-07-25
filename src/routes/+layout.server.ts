import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Song } from '$lib/interfaces';
import { loadSongCatalog, loadAlbumMap } from '$lib/server/challenges';
import { ERROR_LINES } from '$lib/statics';

export const load: LayoutServerLoad = async ({ fetch, route }) => {
    try {
        const [songList, albums] = await Promise.all([loadSongCatalog(fetch), loadAlbumMap(fetch)]);

        const chosen = route.id
            ? null
            : ERROR_LINES[Math.floor(Math.random() * ERROR_LINES.length)];
        const errorSong = chosen ? songList.find((s: Song) => s.title === chosen.song) : undefined;

        return {
            songList,
            albums,
            errorLine: chosen && {
                line: chosen.line,
                song: chosen.song,
                links: errorSong?.links ?? {},
            },
        };
    } catch (e) {
        console.error('Failed to load shared game data:', e);
        throw error(500, 'Failed to load essential game data');
    }
};
