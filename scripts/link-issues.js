// Report streaming links that need manual attention, read from the registry's
// PERSISTENT state -- not out/data/link-issues.json, which only reflects the
// most recent run. Three things are surfaced, per mode:
//   - deadLinks: links that were live, died, and could not be auto-healed by the
//     --verify cron (the real "needs a human" list).
//   - songs with zero healthy links at all (never resolved / fully missed),
//     EXCLUDING those marked linksOptional -- under the strict link policy a
//     leak or unreleased demo that was swept and found nowhere is the expected
//     outcome, not a problem to nag about every night.
//   - candidates awaiting review: matches too loose to auto-publish, parked for
//     a human to accept or reject with `pnpm links:review`.
//
// Usage:
//   pnpm links:issues                    read local song-registry.json (all modes)
//   pnpm links:issues --modes=challenger scope to specific modes
//   pnpm links:issues --remote           fetch published registries over HTTP
//                                        (no pull-data and no credentials needed)
//   pnpm links:issues --json             machine-readable output (CI / issue filing)
//
// Always exits 0 so `pnpm` never prints a lifecycle error on a normal check; use
// --json and inspect the counts in CI to decide whether to act.

import fs from 'fs/promises';
import path from 'path';
import { MODES, modeDirs } from './lib/modes.js';

const ASSETS_URL = process.env.ASSETS_URL || 'https://assets.removedle.org';

const REMOTE = process.argv.includes('--remote');
const JSON_OUT = process.argv.includes('--json');
const modesArg = process.argv.find((a) => a.startsWith('--modes='));
const MODE_IDS = modesArg
    ? modesArg
          .split('=')[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
    : Object.keys(MODES);

const hasLinks = (l) => l && Object.values(l).some((v) => typeof v === 'string' && v.trim());

function registrySource(mode) {
    return REMOTE
        ? `${ASSETS_URL}/${mode.prefix}song-registry.json`
        : path.join(modeDirs(mode).data, 'song-registry.json');
}

async function loadRegistry(mode) {
    const source = registrySource(mode);
    if (REMOTE) {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`GET ${source} -> HTTP ${res.status}`);
        return { source, registry: await res.json() };
    }
    return { source, registry: JSON.parse(await fs.readFile(source, 'utf-8')) };
}

function inspect(registry) {
    const dead = [];
    const empty = [];
    const optionalEmpty = [];
    const review = [];

    for (const [id, e] of Object.entries(registry)) {
        for (const [platform, d] of Object.entries(e.deadLinks || {})) {
            dead.push({ id, title: e.title, platform, url: d.url, since: d.since });
        }
        for (const [platform, list] of Object.entries(e.needsReview || {})) {
            for (const c of list || []) {
                review.push({
                    id,
                    title: e.title,
                    platform,
                    url: c.url,
                    candidate: c.title,
                    uploader: c.uploader,
                    seen: c.seen,
                });
            }
        }
        if (!hasLinks(e.links)) {
            (e.linksOptional ? optionalEmpty : empty).push({ id, title: e.title });
        }
    }

    dead.sort(
        (a, b) => (a.since || '').localeCompare(b.since || '') || a.title.localeCompare(b.title)
    );
    review.sort((a, b) => a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform));

    return { dead, empty, optionalEmpty, review };
}

async function main() {
    const results = {};

    for (const id of MODE_IDS) {
        const mode = MODES[id];
        if (!mode) {
            console.error(`Unknown mode: ${id}`);
            process.exit(2);
        }
        const { source, registry } = await loadRegistry(mode);
        results[id] = { source, ...inspect(registry) };
    }

    if (JSON_OUT) {
        console.log(JSON.stringify({ modes: results }, null, 2));
        return;
    }

    for (const [id, r] of Object.entries(results)) {
        console.log(`\n=== ${MODES[id].label} (${id}) ===`);
        console.log(`Source: ${r.source}\n`);

        console.log(
            `Hidden dead links (${r.dead.length}) -- were live, died, could not auto-heal:`
        );
        if (r.dead.length) {
            for (const d of r.dead)
                console.log(`  ${d.title} | ${d.platform} | ${d.url} | dead since ${d.since}`);
        } else {
            console.log('  (none)');
        }

        console.log(`\nSongs with no links at all (${r.empty.length}):`);
        if (r.empty.length) {
            for (const e of r.empty) console.log(`  ${e.title} (${e.id})`);
        } else {
            console.log('  (none)');
        }
        if (r.optionalEmpty.length) {
            console.log(
                `  (plus ${r.optionalEmpty.length} swept and found nowhere -- expected, not reported)`
            );
        }

        console.log(`\nCandidates awaiting review (${r.review.length}):`);
        if (r.review.length) {
            for (const c of r.review) {
                console.log(
                    `  ${c.title} (${c.id}) | ${c.platform} | "${c.candidate}" by ${c.uploader || '?'}\n` +
                        `      ${c.url}`
                );
            }
            console.log(
                `\n  Accept: pnpm links:review --mode=${id} --accept=<id>:<platform>:<index>` +
                    `\n  Reject: pnpm links:review --mode=${id} --reject=<id>:<platform>`
            );
        } else {
            console.log('  (none)');
        }

        if (r.dead.length || r.empty.length) {
            console.log('\nTo recover: run `pnpm links` locally (full scrapers) or hand-add the');
            console.log(
                "correct URL to the song's `links` in the registry, then `pnpm scan` + push-data."
            );
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
