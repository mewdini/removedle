import { runFfmpeg } from './ffmpeg.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Detect two masters that are the same recording.
//
// This exists because it already happened: `call my phone` and
// `highzoey_-_callmyphone.SugarDaddy` were the same audio at different trims
// (84,992ms vs 84,704ms) and both had become the answer to a different day
// before anyone noticed. Nothing else catches it -- the tags differ, the content
// hashes differ, and generate-daily's songKey reduces them to `callmyphone` and
// `highzoeycallmyphonesugardaddy`, so they could even share a single day as two
// rounds of identical audio.
//
// Compare ENERGY ENVELOPES, not raw samples. Raw-sample correlation scored that
// identical pair at 0.11, because any phase shift or re-encode destroys it.
// Envelopes scored 0.95, against 0.20 and 0.03 for unrelated tracks.

const SAMPLE_RATE = 8000;
// ~25ms per frame.
const FRAME = 200;
// Pairs further apart than this in length are not compared at all, which is what
// keeps the check cheap: almost no pair survives, so almost nothing is decoded.
export const DUPLICATE_SECONDS = 2.5;
// Identical pair measured 0.95; unrelated pairs 0.03-0.20. Deliberately well
// clear of both.
export const DUPLICATE_THRESHOLD = 0.85;
// Envelope offsets searched, in frames (+/- 4s).
const MAX_OFFSET = 160;

async function decodePcm(file) {
    const tmp = path.join(
        os.tmpdir(),
        `removedle-dup-${crypto.randomBytes(6).toString('hex')}.raw`
    );
    try {
        await runFfmpeg([
            '-y',
            '-i',
            file,
            '-ac',
            '1',
            '-ar',
            String(SAMPLE_RATE),
            '-f',
            's16le',
            tmp,
        ]);
        const buf = await fs.readFile(tmp);
        const n = Math.floor(buf.length / 2);
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
        return out;
    } finally {
        await fs.unlink(tmp).catch(() => {});
    }
}

/** RMS energy per frame -- robust to re-encoding, unlike the raw waveform. */
export function envelope(pcm) {
    const n = Math.floor(pcm.length / FRAME);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < FRAME; j++) {
            const v = pcm[i * FRAME + j];
            sum += v * v;
        }
        out[i] = Math.sqrt(sum / FRAME);
    }
    return out;
}

function pearson(a, b, aStart, bStart, n) {
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < n; i++) {
        ma += a[aStart + i];
        mb += b[bStart + i];
    }
    ma /= n;
    mb /= n;

    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
        const x = a[aStart + i] - ma;
        const y = b[bStart + i] - mb;
        num += x * y;
        da += x * x;
        db += y * y;
    }
    return num / (Math.sqrt(da * db) + 1e-9);
}

/** Best correlation of two envelopes over a sliding offset. 1 = identical. */
export function similarity(envA, envB) {
    let best = -1;
    for (let off = -MAX_OFFSET; off <= MAX_OFFSET; off++) {
        const aStart = Math.max(0, off);
        const bStart = Math.max(0, -off);
        const n = Math.min(envA.length - aStart, envB.length - bStart);
        // Need a decent overlap for the number to mean anything.
        if (n < 200) continue;
        const r = pearson(envA, envB, aStart, bStart, n);
        if (r > best) best = r;
    }
    return best;
}

/**
 * Find likely-duplicate recordings among `tracks` ({ id, title, duration, file }).
 * Only pairs of similar length are decoded, so this is close to free in the
 * normal case where nothing matches.
 */
export async function findDuplicates(tracks) {
    const candidates = [];
    for (let i = 0; i < tracks.length; i++) {
        for (let j = i + 1; j < tracks.length; j++) {
            if (Math.abs(tracks[i].duration - tracks[j].duration) <= DUPLICATE_SECONDS) {
                candidates.push([tracks[i], tracks[j]]);
            }
        }
    }
    if (!candidates.length) return { pairs: [], compared: 0 };

    const cache = new Map();
    const envFor = async (t) => {
        if (!cache.has(t.file)) cache.set(t.file, envelope(await decodePcm(t.file)));
        return cache.get(t.file);
    };

    const pairs = [];
    for (const [a, b] of candidates) {
        let score;
        try {
            score = similarity(await envFor(a), await envFor(b));
        } catch {
            continue; // undecodable file -- not this check's problem
        }
        if (score >= DUPLICATE_THRESHOLD) pairs.push({ a, b, score });
    }
    return { pairs, compared: candidates.length };
}
