import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isFutureChallengeDate } from '$lib/server/challenges';
import { GUESSES_PER_ROUND, MAX_ROUNDS } from '$lib/statics';

// Only these exact keys are reachable, so a bad `file` param can never be used
// to read arbitrary objects out of the bucket.
const SNIPPET_PATTERN = new RegExp(
    `^round-[1-${MAX_ROUNDS}]-guess-[1-${GUESSES_PER_ROUND}]\\.opus$`
);

function contentTypeFor(file: string) {
    return file === 'meta.json' ? 'application/json' : 'audio/ogg';
}

// meta.json can still change if a day is regenerated; released snippets never do.
function cacheControlFor(file: string) {
    return file === 'meta.json'
        ? 'public, max-age=3600'
        : 'public, max-age=31536000, immutable';
}

export const GET: RequestHandler = async ({ params, platform }) => {
    const { date, file } = params;

    if (file !== 'meta.json' && !SNIPPET_PATTERN.test(file)) {
        throw error(404, 'Not found');
    }

    // The gate. Challenges are generated and uploaded ahead of time, so the
    // bucket holds future days, and they must not be readable until 00:00 UTC on
    // the day itself. `isFutureChallengeDate` compares UTC dates, so every
    // player in the world crosses this boundary at the same instant.
    if (isFutureChallengeDate(date)) {
        throw error(404, 'Not found');
    }

    const bucket = platform?.env?.CHALLENGES;
    if (!bucket) throw error(500, 'Challenge storage unavailable');

    const object = await bucket.get(`${date}/${file}`);
    if (!object) throw error(404, 'Not found');

    return new Response(object.body, {
        headers: {
            'Content-Type': contentTypeFor(file),
            'Cache-Control': cacheControlFor(file),
            etag: object.httpEtag,
        },
    });
};
