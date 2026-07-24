import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export function runFfmpeg(args, options = {}) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            reject(new Error('ffmpeg-static could not resolve the ffmpeg binary.'));
            return;
        }

        const child = spawn(ffmpegPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            ...options.spawnOptions,
        });

        let stderr = '';

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            stderr += text;
            options.onStderr?.(text);
        });

        child.stdout.on('data', (chunk) => {
            options.onStdout?.(chunk.toString());
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ code, stderr });
                return;
            }

            reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
        });
    });
}
