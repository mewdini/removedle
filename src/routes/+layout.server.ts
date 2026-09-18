import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Song } from '$lib/interfaces';
import { loadSongCatalog, loadAlbumMap, loadBlurbLinks } from '$lib/server/challenges';
import { resolveMode } from '$lib/modes';
import { ERROR_LINES, THEME_COOKIE } from '$lib/statics';
import { themes, type ThemeName } from '$lib/themes';

export const load: LayoutServerLoad = async ({ fetch, route, params, locals, cookies }) => {
    // Reading params.mode registers it as a dependency, so this load re-runs when
    // the mode changes but not when only the date does, keeping a date navigation
    // from re-fetching and re-serialising the whole catalog. On the 404 page
    // there is no matched route and no params, so this falls back to normal,
    // which is correct: ERROR_LINES only reference normal's titles.
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

        // A cookie value the player never wrote, or one written before a theme
        // was renamed or removed, is not a real theme name
        // Falls through to null rather than trusting arbitrary client input
        const cookieTheme = cookies.get(THEME_COOKIE);
        const theme: ThemeName | null =
            cookieTheme && cookieTheme in themes ? (cookieTheme as ThemeName) : null;

        return {
            // Only the id crosses the load boundary; components resolve it back
            // into the full config with resolveMode().
            mode: mode.id,
            // Whether this player came in through the alias domain, which only
            // changes the wordmark. Resolved server-side so the egg is in the
            // SSR'd HTML rather than swapping in after hydration.
            viaAlias: locals.viaAlias,
            // Same reasoning, for the theme: null means no cookie yet (a
            // first-time visitor, or one who cleared cookies but not
            // localStorage), and the client-side settings effect still owns
            // that case exactly as it always did
            theme,
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
