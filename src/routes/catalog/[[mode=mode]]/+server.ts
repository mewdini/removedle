import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadAlbumMap, loadSongCatalog } from '$lib/server/challenges';
import { resolveMode } from '$lib/modes';

// Same-origin catalog feed, for the OTHER mode.
//
// The catalog browser is a modal, so switching its mode tab must not navigate --
// a player peeking at the Challenger tracklist should not be moved into the
// Challenger game. That rules out the header's usual "mode lives in the URL"
// approach and means the other mode's catalog has to arrive over fetch.
//
// It cannot be fetched straight from assets.removedle.org: that bucket serves no
// Access-Control-Allow-Origin, so a browser request from removedle.org to it is
// blocked. (Album art works because <img> is not subject to CORS.) Rather than
// opening the bucket up, the Worker proxies it -- one subrequest, only when a
// player actually opens the other tab.
//
// The mode comes from a matcher that accepts only the literal 'challenger', so
// this can never be pointed at an arbitrary key prefix. Nothing here is gated:
// songs.json is already public at assets.removedle.org and holds no audio and no
// answers, only the same catalog every page load already ships.
export const GET: RequestHandler = async ({ fetch, params }) => {
    const mode = resolveMode(params.mode);

    try {
        const [songList, albums] = await Promise.all([
            loadSongCatalog(fetch, mode),
            loadAlbumMap(fetch, mode),
        ]);

        return json(
            { mode: mode.id, songList, albums },
            // Matches the manifests' own 1-hour cache, so a scan publishes
            // through to the browser on the same schedule either way.
            { headers: { 'Cache-Control': 'public, max-age=3600' } }
        );
    } catch (e) {
        console.error(`Failed to load ${mode.id} catalog:`, e);
        throw error(502, 'Failed to load catalog');
    }
};
