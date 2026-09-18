// Generates today's challenge for both modes if it isn't already sitting in
// out/dailies, so `pnpm dev` never opens onto the "No challenge found" screen
// just because nobody ran `pnpm generate` yet today. Skips the network- and
// ffmpeg-heavy generate step entirely once a day's meta.json already exists,
// so a second `pnpm dev` start on the same day costs nothing beyond a file
// existence check
import { existsSync } from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { MODES, modeDirs } from './lib/modes.js';
import { gameDate } from './lib/dates.js';

const today = gameDate();

for (const mode of Object.values(MODES)) {
    const dirs = modeDirs(mode);
    const metaPath = path.join(dirs.dailies, today, 'meta.json');

    if (existsSync(metaPath)) {
        console.log(`ensure-daily: ${mode.id} already has ${today}`);
        continue;
    }

    console.log(`ensure-daily: generating ${mode.id} ${today}...`);
    const args = ['scripts/generate-daily.js', today];
    if (mode.prefix) args.push(`--mode=${mode.id}`);

    try {
        execFileSync('node', args, { stdio: 'inherit' });
    } catch (err) {
        // Non-fatal: dev should still start even if generation failed (e.g. no
        // R2 credentials in .env yet), just with today missing like before
        console.warn(`ensure-daily: failed to generate ${mode.id} ${today}: ${err.message}`);
    }
}
