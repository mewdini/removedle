import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Song } from '$lib/interfaces';
import { loadSongCatalog, loadAlbumMap, loadBlurbLinks } from '$lib/server/challenges';
import { resolveMode } from '$lib/modes';
import { ERROR_LINES } from '$lib/statics';

export const load: LayoutServerLoad = async ({ fetch, route, params, locals }) => {
    // Reading params.mode registers it as a dependency, so this load re-runs when
    // the mode changes but NOT when only the date does -- which is what keeps a
    // date navigation from re-fetching and re-serialising the whole catalog.
    // On the 404 page there is no matched route and no params, so this falls back
    // to normal, which is correct: ERROR_LINES only reference normal's titles.
    const mode = resolveMode(params.mode);

    try {
        const [songList, albums] = await Promise.all([
            loadSongCatalog(fetch, mode),
            loadAlbumMap(fetch, mode),
        ]);

        const chosen = route.id
            ? null
            : ERROR_LINES[Math.floor(Math.random() * ERROR_LINES.length)];
        const errorSong = chosen ? songList.find((s: Song) => s.title === chosen.song) : undefined;
        const blurbLinks = await loadBlurbLinks(fetch, mode, songList);

        return {
            // Only the id crosses the load boundary; components resolve it back
            // into the full config with resolveMode().
            mode: mode.id,
            // Whether this player came in through the alias domain, which only
            // changes the wordmark. Resolved server-side so the egg is in the
            // SSR'd HTML rather than swapping in after hydration.
            viaAlias: locals.viaAlias,
            songList,
            albums,
            blurbLinks,
            errorLine: chosen && {
                line: chosen.line,
                song: chosen.song,
                links: errorSong?.links ?? {},
            },
        };
    } catch (e) {
        console.error(`Failed to load shared ${mode.id} game data:`, e);
        throw error(500, 'Failed to load essential game data');
    }
};
