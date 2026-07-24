// Best-effort edge cache purge, run right after a successful deploy.
//
// Cloudflare Workers Builds (and `wrangler deploy`) ship the new Worker but do
// NOT purge the edge cache, so HTML and other cached responses can serve stale
// after a deploy. This purges the whole zone. It is wired into both the Workers
// Builds deploy command and the local `deploy:prod` script.
//
// Requires:
//   CLOUDFLARE_PURGE_TOKEN  a token scoped to Zone > Cache Purge
//   CLOUDFLARE_ZONE_ID      the removedle.org zone id
//
// Missing creds are treated as "purge not configured" and skipped without
// failing, so a local build without them still succeeds. If creds ARE present
// but the purge call fails, that exits non-zero so the build log surfaces it
// (the deploy already happened; this only flags that the cache was not cleared).

const token = process.env.CLOUDFLARE_PURGE_TOKEN;
const zone = process.env.CLOUDFLARE_ZONE_ID;

if (!token || !zone) {
    console.warn(
        'purge-cache: CLOUDFLARE_PURGE_TOKEN / CLOUDFLARE_ZONE_ID not set, skipping edge purge.'
    );
    process.exit(0);
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
process.exit(1);
