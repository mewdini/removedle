import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isFutureChallengeDate } from '$lib/server/challenges';
import { resolveMode } from '$lib/modes';
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
    return file === 'meta.json' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable';
}

export const GET: RequestHandler = async ({ params, platform }) => {
    const { date, file } = params;
    // Every mode's challenges share one private bucket, separated by key prefix.
    // The prefix comes from a matcher that accepts only the literal 'challenger',
    // so it can never be attacker-controlled and the whitelist below still fully
    // determines which objects are reachable.
    const mode = resolveMode(params.mode);

    if (file !== 'meta.json' && !SNIPPET_PATTERN.test(file)) {
        throw error(404, 'Not found');
    }

    // The gate. Challenges are generated and uploaded ahead of time, so the
    // bucket holds future days, and they must not be readable until 21:00 Pacific
    // on the evening the day goes live. Every player in the world crosses this
    // boundary at the same instant, in every mode.
    if (isFutureChallengeDate(date)) {
        throw error(404, 'Not found');
    }

    const bucket = platform?.env?.CHALLENGES;
    if (!bucket) throw error(500, 'Challenge storage unavailable');

    const object = await bucket.get(`${mode.prefix}${date}/${file}`);
    if (!object) throw error(404, 'Not found');

    return new Response(object.body, {
        headers: {
            'Content-Type': contentTypeFor(file),
            'Cache-Control': cacheControlFor(file),
            etag: object.httpEtag,
        },
    });
};
