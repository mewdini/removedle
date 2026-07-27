import type { Handle } from '@sveltejs/kit';
import { ALT_COOKIE, ALT_HOST, ALT_MARKER, SITE } from '$lib/statics';

export const handle: Handle = async ({ event, resolve }) => {
    const { url } = event;

    // The alias domain redirects and never serves the game -- see ALT_HOST in
    // $lib/statics for why (per-origin localStorage would fork every player's
    // save). 301 so browsers cache it, and because downgrading a POST to a GET
    // is desirable here: it means the saveScore action can never run on the
    // alias origin and write a row from a page that should not exist.
    if (url.hostname === ALT_HOST || url.hostname === `www.${ALT_HOST}`) {
        // Appended as a string rather than via URLSearchParams, which would
        // re-serialise the whole query and mangle keys that are not simple
        // pairs -- SvelteKit's own form actions look like `?/saveScore`, and
        // round-tripping that through searchParams turns it into
        // `?%2FsaveScore=`. Concatenating leaves the original query untouched.
        const search = url.search ? `${url.search}&${ALT_MARKER}=1` : `?${ALT_MARKER}=1`;
        return new Response(null, {
            status: 301,
            headers: { location: SITE + url.pathname + search },
        });
    }

    // Landed from the alias: trade the marker for a cookie, then bounce to the
    // clean URL. The cookie is what lets the wordmark be server-rendered on
    // every later page, so the egg never appears as a post-hydration flash, and
    // it keeps the address bar shareable.
    //
    // Deliberately a SESSION cookie -- no Max-Age and no Expires, so the browser
    // drops it when it closes. The egg belongs to the visit that came in through
    // the alias, not to the browser forever: a persistent cookie would mean one
    // trip through janedle.org permanently rebrands every later visit made
    // straight to removedle.org, which is not what the easter egg is for.
    //
    // Set-Cookie is written by hand rather than via event.cookies.set(), which
    // only applies to a response produced by resolve() -- not to one constructed
    // here. If the browser refuses the cookie the marker is still stripped, so
    // this can only degrade to "no easter egg", never to a redirect loop.
    if (url.searchParams.has(ALT_MARKER)) {
        const target = new URL(url);
        target.searchParams.delete(ALT_MARKER);
        const cookie = [`${ALT_COOKIE}=1`, 'Path=/', 'SameSite=Lax', 'HttpOnly'];
        // Omitted in dev, where preview runs over plain http and a Secure cookie
        // would simply be dropped.
        if (url.protocol === 'https:') cookie.push('Secure');

        return new Response(null, {
            status: 302,
            headers: {
                location: target.pathname + target.search,
                'set-cookie': cookie.join('; '),
            },
        });
    }

    // Read once here so every load and component sees the same answer.
    event.locals.viaAlias = event.cookies.get(ALT_COOKIE) === '1';

    // Defense-in-depth response headers on every Worker-rendered response. There is
    // no auth or injection sink today, so these are belt-and-suspenders: DENY blocks
    // the game being framed (clickjacking), nosniff stops MIME-confusion, and the
    // referrer policy avoids leaking full URLs cross-origin. HSTS is left to
    // Cloudflare's edge (enable it on the zone rather than here).
    const response = await resolve(event);
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
};
