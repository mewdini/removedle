import type { Handle } from '@sveltejs/kit';
import { ALT_COOKIE, ALT_COOKIE_MAX_AGE, ALT_HOST, ALT_MARKER, SITE } from '$lib/statics';

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
    // The egg belongs to the visit that came in through the alias, not to the
    // browser forever, and ALT_COOKIE_MAX_AGE is what actually enforces that.
    // This was a session cookie (no Max-Age, no Expires) until it turned out
    // browsers do not really end sessions -- phones are never closed and desktop
    // Chrome restores session cookies on restart -- so one trip through
    // janedle.org rebranded every later visit made straight to removedle.org,
    // including a fresh click from a link somewhere else. See $lib/statics for
    // why the bound is six hours and why it deliberately does not slide.
    //
    // Set-Cookie is written by hand rather than via event.cookies.set(), which
    // only applies to a response produced by resolve() -- not to one constructed
    // here. If the browser refuses the cookie the marker is still stripped, so
    // this can only degrade to "no easter egg", never to a redirect loop.
    if (url.searchParams.has(ALT_MARKER)) {
        const target = new URL(url);
        target.searchParams.delete(ALT_MARKER);
        const cookie = [
            `${ALT_COOKIE}=1`,
            `Max-Age=${ALT_COOKIE_MAX_AGE}`,
            'Path=/',
            'SameSite=Lax',
            'HttpOnly',
        ];
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

    // The rendered HTML depends on ALT_COOKIE: the wordmark is "janedle removedle"
    // for a player who came in through the alias and "removedle" for everyone
    // else. Until now the response said nothing about that -- no Vary, no
    // Cache-Control, no ETag -- which means every cache between the Worker and
    // the reader was entitled to treat one player's page as everyone's page. That
    // is a correctness bug even though nothing caches it today: a Cloudflare cache
    // rule added later, a corporate proxy, or the browser's own disk cache could
    // hand a janedle-branded page to a cookie-less request, or keep serving the
    // unbranded page to someone who just earned the egg. The cookie-lifetime fix
    // in $lib/statics closed the reported case; this closes the second route to
    // the same symptom.
    //
    // `Vary: Cookie` is the honest statement of what the body depends on, and it
    // is necessary -- but it is NOT sufficient on its own. Vary is widely
    // mishandled by intermediaries, and a private browser cache that keys only on
    // the URL can still reuse an entry across a cookie change. So the actual
    // enforcement is `private, no-store`: `private` bars shared caches outright,
    // and `no-store` bars writing it down anywhere.
    //
    // `no-store` over `no-cache, must-revalidate` deliberately. `no-cache` permits
    // storing and requires revalidation -- but this Worker emits no ETag and no
    // Last-Modified, so a revalidation can never come back 304 and always costs a
    // full re-render. That buys none of the bandwidth `no-cache` normally earns
    // while still leaving a branded copy sitting on disk, where an offline read or
    // a stale-if-error path can surface it. The known cost of `no-store` is that
    // Chrome and Firefox decline to bfcache a page that carries it, so a
    // back-navigation re-fetches; that is acceptable here, since the app is
    // client-routed after hydration and SvelteKit already sends `private,
    // no-store` on its own data payloads, so a navigation was never free anyway.
    //
    // SCOPING. This must only touch the responses this hook's own `viaAlias`
    // feeds into. The discriminator is `x-sveltekit-page` (set by SvelteKit on an
    // SSR'd page render) plus `event.isDataRequest` (the `__data.json` payload for
    // a client-side navigation, which serialises `viaAlias` from
    // +layout.server.ts). A Content-Type test was considered and rejected: the
    // data payloads are served as `application/json` -- exactly the type the
    // catalog feed uses -- so Content-Type cannot separate "payload that embeds
    // viaAlias" from "feed that must keep its `max-age=3600`". These two flags can.
    //
    // The excluded set matters as much as the included one. Static assets under
    // /_app/immutable are content-hashed and served by the Workers asset router
    // BEFORE the Worker runs, so they should never arrive here at all -- but the
    // test is written as an allowlist rather than a "skip /_app" denylist so that
    // if one ever did pass through it keeps its long-lived immutable caching
    // instead of being told not to store the one thing that most benefits from
    // being stored. The two deliberately-cached endpoints are likewise untouched:
    // the catalog feed (public, max-age=3600) and challenge snippets (immutable)
    // are +server.ts responses, so neither flag is set on them.
    if (event.isDataRequest || response.headers.get('x-sveltekit-page') === 'true') {
        // Appended rather than set, so a Vary another layer already declared
        // (Accept-Encoding, say) is widened rather than replaced -- dropping one
        // would be the same class of bug this is fixing.
        const vary = response.headers.get('Vary');
        if (!vary) response.headers.set('Vary', 'Cookie');
        else if (!/(^|,)\s*cookie\s*(,|$)/i.test(vary)) response.headers.append('Vary', 'Cookie');

        response.headers.set('Cache-Control', 'private, no-store');
    }

    return response;
};
