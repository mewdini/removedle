import type { Handle } from '@sveltejs/kit';

// Defense-in-depth response headers on every Worker-rendered response. There is
// no auth or injection sink today, so these are belt-and-suspenders: DENY blocks
// the game being framed (clickjacking), nosniff stops MIME-confusion, and the
// referrer policy avoids leaking full URLs cross-origin. HSTS is left to
// Cloudflare's edge (enable it on the zone rather than here).
export const handle: Handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
};
