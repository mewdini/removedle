// Verifies the rolling buffer actually holds a valid, complete challenge for
// each of the next BUFFER_DAYS game days, for both modes. Independent of
// scripts/generate-week.js, it reads R2 fresh rather than trusting that run's
// own report, so it also catches a day that looks fine in the generation log
// but is broken in the bucket for some other reason: a bad manual edit, a
// partial upload, a catalog change that orphaned a songId
//
// Usage:
//   node scripts/challenge-health.js          human-readable report
//   node scripts/challenge-health.js --json   machine-readable (CI / issue filing)
//
// Always needs R2 credentials since the challenges bucket is private, so
// there is no --remote/no-creds mode the way link-issues.js has
//
// Exits 1 only when TOMORROW's challenge, the one day with no buffer left at
// all, is unhealthy for either mode. A gap further out in the window is
// reported but does not fail the run: daily-challenges.yml gets up to 6 more
// scheduled attempts to close it before a player would ever see it missing
import { BUCKETS, readObject, listObjects } from './lib/r2.js';
import { MODES } from './lib/modes.js';
import { addDays, gameDate } from './lib/dates.js';

const BUFFER_DAYS = 7;
// Duplicated from src/lib/statics.ts, same reason scripts/lib/dates.js
// duplicates the reset hour: that file is TypeScript behind SvelteKit's
// $params alias and pulls in @sveltejs/kit types
const MAX_ROUNDS = 5;
const GUESSES_PER_ROUND = 3;
const ASSETS_URL = process.env.ASSETS_URL || 'https://assets.removedle.org';

const JSON_OUT = process.argv.includes('--json');

// The published catalog, not the registry: an answer has to be something the
// game can actually resolve and let a player type, the same guard
// generate-daily itself applies when picking songs
async function loadCatalogIds(mode) {
    const url = `${ASSETS_URL}/${mode.prefix}songs.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    const songs = await res.json();
    return new Set(songs.map((s) => s.id));
}

async function checkDate(mode, date, catalogIds) {
    const prefix = `${mode.prefix}${date}/`;
    const raw = await readObject(BUCKETS.challenges, `${prefix}meta.json`);

    if (raw === null) return { status: 'missing' };

    let meta;
    try {
        meta = JSON.parse(raw);
    } catch {
        return { status: 'malformed', reason: 'meta.json is not valid JSON' };
    }

    if (!Array.isArray(meta.rounds) || meta.rounds.length !== MAX_ROUNDS) {
        return {
            status: 'malformed',
            reason: `expected ${MAX_ROUNDS} rounds, found ${meta.rounds?.length ?? 0}`,
        };
    }

    for (const round of meta.rounds) {
        if (!round.songId || !catalogIds.has(round.songId)) {
            return {
                status: 'malformed',
                reason: `round ${round.round} references song "${round.songId}", not in the published catalog`,
            };
        }
    }

    const objects = await listObjects(BUCKETS.challenges, prefix);
    const opusCount = objects.filter((o) => o.Key.endsWith('.opus')).length;
    const expectedOpus = MAX_ROUNDS * GUESSES_PER_ROUND;
    if (opusCount !== expectedOpus) {
        return {
            status: 'incomplete-audio',
            reason: `expected ${expectedOpus} snippet files, found ${opusCount}`,
        };
    }

    return { status: 'ok' };
}

async function main() {
    const today = gameDate();
    const dates = Array.from({ length: BUFFER_DAYS }, (_, i) => addDays(today, i + 1));
    const tomorrow = dates[0];

    const modes = {};
    let urgentFailure = false;

    for (const mode of Object.values(MODES)) {
        const catalogIds = await loadCatalogIds(mode);
        const days = [];

        for (const date of dates) {
            if (date < mode.startDate) continue;
            const result = await checkDate(mode, date, catalogIds);
            days.push({ date, ...result });
            if (result.status !== 'ok' && date === tomorrow) urgentFailure = true;
        }

        modes[mode.id] = { days };
    }

    if (JSON_OUT) {
        console.log(JSON.stringify({ today, tomorrow, modes }, null, 2));
    } else {
        for (const [id, { days }] of Object.entries(modes)) {
            console.log(`\n=== ${MODES[id].label} (${id}) ===`);
            for (const d of days) {
                const marker =
                    d.date === tomorrow && d.status !== 'ok' ? ' (URGENT: no buffer left)' : '';
                console.log(
                    d.status === 'ok'
                        ? `  ${d.date}: ok`
                        : `  ${d.date}: ${d.status}, ${d.reason ?? 'no detail'}${marker}`
                );
            }
        }
    }

    if (urgentFailure) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
