// Orchestrates scripts/generate-daily.js across dates and modes, adding the
// retry and immediate-push handling generate-daily.js itself does not do.
//
// Three modes, chosen by CLI flags:
//   --target=YYYY-MM-DD           one date, both modes, always (re)generated
//   --start=YYYY-MM-DD --end=...  an inclusive range, both modes, always generated
//   (no flags)                    the rolling buffer, today's game date + 1
//                                  through +7, both modes, skipping any date
//                                  that already has a challenge in R2
//
// The no-flags form is what the daily cron runs. Each run tops up whatever is
// missing from the next 7 days rather than generating exactly one day, so one
// bad run only costs a day of buffer, not the whole week, and a sustained
// outage gets up to 7 daily attempts to clear before a player would see a
// missing challenge
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { BUCKETS, readObject, syncPush } from './lib/r2.js';
import { MODES, modeDirs, pushPrefix } from './lib/modes.js';
import { addDays, gameDate } from './lib/dates.js';

const BUFFER_DAYS = 7;
// Two retries beyond the first attempt, with a short backoff, enough to ride
// out a transient R2 or network hiccup without dragging a mostly-healthy run
// out for minutes. A sustained outage still fails these and falls through to
// tomorrow's cron, which retries the same still-missing date again
const RETRY_DELAYS_MS = [5000, 15000];

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (name) => {
        const arg = args.find((a) => a.startsWith(`--${name}=`));
        return arg ? arg.split('=')[1] : undefined;
    };
    return { target: get('target'), start: get('start'), end: get('end') };
}

function datesInRange(start, end) {
    const dates = [];
    for (let current = start; current <= end; current = addDays(current, 1)) {
        dates.push(current);
    }
    return dates;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs a child process while both streaming its output live, so a GitHub
// Actions log reads the same as before, and capturing it
// The capture is what makes the error text in generation-report.json useful.
// execFileSync with stdio:'inherit' throws only a generic "Command failed"
// message with no actual content, which is useless for a human trying to
// tell what actually broke
function runCaptured(command, args) {
    return new Promise((resolve) => {
        const child = spawn(command, args);
        let output = '';

        child.stdout.on('data', (chunk) => {
            process.stdout.write(chunk);
            output += chunk;
        });
        child.stderr.on('data', (chunk) => {
            process.stderr.write(chunk);
            output += chunk;
        });

        child.on('close', (code) => resolve({ code, output }));
    });
}

// The last stretch of output, where the actual thrown error or ffmpeg failure
// reads, rather than the whole transcript
function errorSignature(output) {
    return output.trim().slice(-500);
}

async function alreadyExists(mode, date) {
    const raw = await readObject(BUCKETS.challenges, `${mode.prefix}${date}/meta.json`);
    return raw !== null;
}

// Pushes just this one date's folder, meta.json and its audio together, right
// after it generates successfully. Required, not an optimization: generate-daily's
// "last N days" dedup reads the challenges bucket over the S3 API, so a later
// date in this same run cannot see an earlier one's picks until it is pushed
async function pushOne(mode, date) {
    const dirs = modeDirs(mode);
    const dateDir = path.join(dirs.dailies, date);
    await syncPush(dateDir, BUCKETS.challenges, pushPrefix(mode, date));
}

// generate-daily.js resolves its mode from argv/env at import time (see
// scripts/lib/modes.js parseMode), so it cannot be called twice in-process for
// two different modes, each (date, mode) pair is its own child process.
//
// Generate and push are retried as ONE unit, not separately. A push failure
// after a successful generate is retried by just re-running both, since
// generation is deterministic and reproduces the same output, rather than
// leaving the loop to crash and skip every remaining day
//
// A failed result's error is the last attempt's captured signature, kept for
// scripts/challenge-health.js's cross-run persistence check: whether the SAME
// error is still showing up on a LATER run is a much stronger signal than
// whether it repeated 3 times inside 20 seconds of retries here, which a
// sustained-but-still-transient outage could produce just as easily
async function generateAndPushOne(mode, date) {
    let lastSignature = 'unknown error';

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
            console.log(`  Retry ${attempt}/${RETRY_DELAYS_MS.length} for ${mode.id} ${date}...`);
            await sleep(RETRY_DELAYS_MS[attempt - 1]);
        }

        const args = ['scripts/generate-daily.js', date];
        if (mode.prefix) args.push(`--mode=${mode.id}`);
        const { code, output } = await runCaptured('node', args);

        if (code === 0) {
            try {
                await pushOne(mode, date);
                return { ok: true };
            } catch (err) {
                lastSignature = String(err?.message ?? err);
                console.error(`  Push failed for ${mode.id} ${date}: ${lastSignature}`);
                continue;
            }
        }

        lastSignature = errorSignature(output);
        console.error(`  Attempt ${attempt + 1} failed for ${mode.id} ${date} (exit ${code})`);
    }

    return { ok: false, error: lastSignature };
}

async function main() {
    const { target, start, end } = parseArgs();

    let dates;
    let skipExisting;

    if (target) {
        dates = [target];
        skipExisting = false;
    } else if (start && end) {
        dates = datesInRange(start, end);
        skipExisting = false;
    } else {
        const today = gameDate();
        dates = Array.from({ length: BUFFER_DAYS }, (_, i) => addDays(today, i + 1));
        skipExisting = true;
    }

    const results = [];

    for (const mode of Object.values(MODES)) {
        for (const date of dates) {
            if (date < mode.startDate) continue;

            if (skipExisting && (await alreadyExists(mode, date))) {
                console.log(`${mode.id} ${date}: already exists, skipping`);
                results.push({ mode: mode.id, date, status: 'skipped' });
                continue;
            }

            console.log(`${mode.id} ${date}: generating...`);
            const outcome = await generateAndPushOne(mode, date);

            if (outcome.ok) {
                console.log(`${mode.id} ${date}: generated and pushed`);
                results.push({ mode: mode.id, date, status: 'generated' });
            } else {
                console.error(`${mode.id} ${date}: FAILED after retries: ${outcome.error}`);
                results.push({ mode: mode.id, date, status: 'failed', error: outcome.error });
            }
        }
    }

    await fs.writeFile('generation-report.json', JSON.stringify(results, null, 2));

    const failed = results.filter((r) => r.status === 'failed');
    if (failed.length) {
        console.error(`\n${failed.length} generation(s) failed:`);
        for (const f of failed) console.error(`  - ${f.mode} ${f.date}: ${f.error}`);
    }

    // Red the job only when every attempted generation failed outright, a real
    // outage worth a loud failed run rather than a quiet log line. A couple of
    // unlucky days among an otherwise healthy run are exactly what the buffer
    // and tomorrow's retry exist to absorb. scripts/challenge-health.js is what
    // actually tracks and alerts on per-day gaps regardless of this exit code
    const attempted = results.filter((r) => r.status !== 'skipped');
    if (attempted.length > 0 && failed.length === attempted.length) {
        process.exit(1);
    }
}

main();
