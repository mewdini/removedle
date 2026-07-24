import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, parse, resolve } from 'path';
import { runFfmpeg } from './lib/ffmpeg.js';

const MASTERS_DIR = resolve('masters');
const OUTPUT_DIR = resolve('out', 'masters');

if (!existsSync(OUTPUT_DIR)) {
    console.log(`Creating output directory: ${OUTPUT_DIR}`);
    mkdirSync(OUTPUT_DIR, { recursive: true });
}

const files = readdirSync(MASTERS_DIR);
const audioExtensions = ['.flac', '.wav', '.mp3'];

console.log(`Found ${files.length} files in ${MASTERS_DIR}`);

async function convertFile(file) {
    const { ext, name } = parse(file);
    if (!audioExtensions.includes(ext.toLowerCase())) return;

    const inputPath = join(MASTERS_DIR, file);
    const outputPath = join(OUTPUT_DIR, `${name}.m4a`);

    console.log(`Converting: ${file}`);

    try {
        await runFfmpeg([
            '-i',
            inputPath,
            '-map',
            '0:a',
            '-map',
            '0:v?',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-movflags',
            'faststart',
            outputPath,
        ]);
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
            /* ignored */
        }
    }
    console.log('All conversions complete!');
}

run();
