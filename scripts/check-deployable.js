// Deploy guard.
//
// `link-assets.ps1` / `link-assets.sh` junction `static/challenges` -> out/dailies
// for local dev. Everything under `static/` is copied into the build output, and
// on Workers static assets are served BEFORE the Worker runs. So if those links
// are present at build time, the copied files shadow the gated route in
// src/routes/challenges/[date=date]/[file] and every future day becomes publicly
// downloadable, which is the exact thing the gate exists to prevent.
//
// Deploying from CI is clean because the links do not exist there. This guard
// exists for deploys from a dev machine.

import { existsSync } from 'fs';
import path from 'path';

// Local deploys are disabled by default. Production auto-deploys through
// Cloudflare Workers Builds on push to main, which runs on a clean runner with
// no dev junctions. A stray `pnpm deploy:prod` from a dev machine can ship
// uncommitted state, race the CI deploy, or bundle the junctions. Set
// ALLOW_LOCAL_DEPLOY=1 for an intentional manual deploy (e.g. Workers Builds is
// down). Workers Builds itself runs `pnpm build` + `wrangler deploy` directly,
// not this script, so this guard never blocks CI.
if (!process.env.ALLOW_LOCAL_DEPLOY) {
    console.error('\nRefusing to deploy locally.\n');
    console.error('This project auto-deploys via Cloudflare Workers Builds on push to main.');
    console.error('Push your commit and let the build deploy it.\n');
    console.error('For an intentional manual deploy, re-run with:');
    console.error('  ALLOW_LOCAL_DEPLOY=1 pnpm deploy:prod\n');
    process.exit(1);
}

const OFFENDERS = ['static/challenges', 'static/assets'];

const found = OFFENDERS.filter((p) => existsSync(path.resolve(p)));

if (found.length > 0) {
    console.error('\nRefusing to build for deploy: dev asset links are present.\n');
    for (const p of found) console.error(`  ${p}`);
    console.error(
        [
            '',
            'These are local dev junctions. If they are bundled, they are served',
            'ahead of the Worker and would expose unreleased challenge audio.',
            '',
            'Remove them and re-run (Windows):',
            '  cmd /c rmdir static\\challenges static\\assets',
            'or (POSIX):',
            '  rm static/challenges static/assets',
            '',
            'Re-create them for local dev afterwards with scripts/link-assets.*',
            '',
        ].join('\n')
    );
    process.exit(1);
}

console.log('Deploy guard: no dev asset links present.');
