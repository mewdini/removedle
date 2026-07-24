// Manual edge cache purge for removedle.org. Run it (`pnpm purge`) when you
// change content that is already live and cached:
//   - reissuing a released day's challenge audio (snippets are served
//     `immutable`, so a stale copy would otherwise persist until its TTL), or
//   - updating a non-hashed static asset (e.g. static/favicon.png).
//
// It is deliberately NOT part of the deploy. A normal code deploy never needs a
// purge: the /_app/immutable/* assets are content-hashed, so a new build gets
// new filenames and cannot serve stale. Coupling a purge to every deploy just
// adds a failure surface for no benefit.
//
// Requires (from the environment or .env):
//   CLOUDFLARE_PURGE_TOKEN  a token scoped to Zone > Cache Purge
//   CLOUDFLARE_ZONE_ID      the removedle.org zone id
//
// Fails loudly (non-zero exit) so a purge you asked for cannot fail unnoticed.

import 'dotenv/config';

const token = process.env.CLOUDFLARE_PURGE_TOKEN;
const zone = process.env.CLOUDFLARE_ZONE_ID;

if (!token || !zone) {
    console.error(
        'purge-cache: set CLOUDFLARE_PURGE_TOKEN and CLOUDFLARE_ZONE_ID (see .env.example).'
    );
    process.exit(1);
}

const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purge_everything: true }),
});

const body = await res.json().catch(() => ({}));

if (res.ok && body.success) {
    console.log('purge-cache: edge cache purged.');
    process.exit(0);
}

console.error('purge-cache: purge failed:', res.status, JSON.stringify(body.errors || body));
if (res.status === 401 || res.status === 403) {
    console.error(
        'purge-cache: CLOUDFLARE_PURGE_TOKEN needs the Zone > Cache Purge permission for this zone; check CLOUDFLARE_ZONE_ID too.'
    );
}
process.exit(1);
