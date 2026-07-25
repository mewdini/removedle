// Report streaming links that need manual attention, read from the registry's
// PERSISTENT state -- not out/data/link-issues.json, which only reflects the
// most recent run. Two things are surfaced:
//   - deadLinks: links that were live, died, and could not be auto-healed by the
//     --verify cron (the real "needs a human" list).
//   - songs with zero healthy links at all (never resolved / fully missed).
//
// Usage:
//   pnpm links:issues            read local out/data/song-registry.json
//   pnpm links:issues --remote   fetch the published registry from R2 over HTTP
//                                (no pull-data and no credentials needed)
//   pnpm links:issues --json     machine-readable output (for CI / issue filing)
//
// Always exits 0 so `pnpm` never prints a lifecycle error on a normal check; use
// --json and inspect the array length in CI to decide whether to act.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../out/data');
const REGISTRY_FILE = path.join(DATA_DIR, 'song-registry.json');
const REMOTE_URL = `${process.env.ASSETS_URL || 'https://assets.removedle.org'}/song-registry.json`;

const REMOTE = process.argv.includes('--remote');
const JSON_OUT = process.argv.includes('--json');

const hasLinks = (l) => l && Object.values(l).some((v) => typeof v === 'string' && v.trim());

async function loadRegistry() {
    if (REMOTE) {
        const res = await fetch(REMOTE_URL);
        if (!res.ok) throw new Error(`GET ${REMOTE_URL} -> HTTP ${res.status}`);
        return res.json();
    }
    return JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));
}

async function main() {
    const registry = await loadRegistry();

    const dead = [];
    const empty = [];
    for (const [id, e] of Object.entries(registry)) {
        for (const [platform, d] of Object.entries(e.deadLinks || {})) {
            dead.push({ id, title: e.title, platform, url: d.url, since: d.since });
        }
        if (!hasLinks(e.links)) empty.push({ id, title: e.title });
    }
    dead.sort(
        (a, b) => (a.since || '').localeCompare(b.since || '') || a.title.localeCompare(b.title)
    );

    if (JSON_OUT) {
        console.log(
            JSON.stringify({ source: REMOTE ? REMOTE_URL : REGISTRY_FILE, dead, empty }, null, 2)
        );
        return;
    }

    console.log(`Source: ${REMOTE ? REMOTE_URL : REGISTRY_FILE}\n`);

    console.log(`Hidden dead links (${dead.length}) -- were live, died, could not auto-heal:`);
    if (dead.length) {
        for (const d of dead)
            console.log(`  ${d.title} | ${d.platform} | ${d.url} | dead since ${d.since}`);
    } else {
        console.log('  (none)');
    }

    console.log(`\nSongs with no links at all (${empty.length}):`);
    if (empty.length) {
        for (const e of empty) console.log(`  ${e.title} (${e.id})`);
    } else {
        console.log('  (none)');
    }

    if (dead.length || empty.length) {
        console.log('\nTo recover: run `pnpm links` locally (full scrapers) or hand-add the');
        console.log(
            "correct URL to the song's `links` in the registry, then `pnpm scan` + push-data."
        );
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
