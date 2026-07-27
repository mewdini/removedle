import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, parse } from 'path';
import { runFfmpeg } from './lib/ffmpeg.js';
import { modeDirs, parseMode } from './lib/modes.js';

const MODE = parseMode();
const DIRS = modeDirs(MODE);

const MASTERS_DIR = DIRS.srcMasters;
const OUTPUT_DIR = DIRS.masters;

// Re-encode files that already have an output. Off by default so a repeat run is
// cheap and, more importantly, does not rewrite the whole back catalogue with
// bytes that differ from what is already in R2 (which would re-upload all of it).
const FORCE = process.argv.includes('--force');

if (!existsSync(OUTPUT_DIR)) {
    console.log(`Creating output directory: ${OUTPUT_DIR}`);
    mkdirSync(OUTPUT_DIR, { recursive: true });
}

const files = readdirSync(MASTERS_DIR);
const audioExtensions = ['.flac', '.wav', '.mp3', '.m4a'];

console.log(`Mode: ${MODE.id}`);
console.log(`Found ${files.length} entries in ${MASTERS_DIR}`);

let converted = 0;
let skipped = 0;
let failed = 0;

async function convertFile(file) {
    const { ext, name } = parse(file);
    if (!audioExtensions.includes(ext.toLowerCase())) return;

    const inputPath = join(MASTERS_DIR, file);
    const outputPath = join(OUTPUT_DIR, `${name}.m4a`);

    if (!FORCE && existsSync(outputPath)) {
        skipped++;
        return;
    }

    // Sources that are already m4a get remuxed rather than re-encoded: AAC ->
    // AAC would lose quality for nothing.
    const audioArgs =
        ext.toLowerCase() === '.m4a' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'];

    console.log(`Converting: ${file}`);

    try {
        await runFfmpeg([
            // ffmpeg's stdin is /dev/null here, so without -y an existing output
            // makes it read EOF at the overwrite prompt and silently keep the
            // old file.
            '-y',
            '-i',
            inputPath,
            '-map',
            '0:a',
            '-map',
            '0:v?',
            '-c:v',
            'copy',
            ...audioArgs,
            '-movflags',
            'faststart',
            outputPath,
        ]);
        converted++;
        console.log(`Finished: ${name}.m4a`);
    } catch (err) {
        console.error(`Failed to convert ${file}:`, err.message);
        throw err;
    }
}

async function run() {
    for (const file of files) {
        try {
            await convertFile(file);
        } catch (_) {
            failed++;
        }
    }

    const total = readdirSync(OUTPUT_DIR).filter((f) => f.toLowerCase().endsWith('.m4a')).length;
    console.log(
        `\nConverted ${converted}, skipped ${skipped} already present, ${failed} failed.` +
            `\n${OUTPUT_DIR} now holds ${total} .m4a files.`
    );

    if (failed > 0) process.exit(1);
}

run();
