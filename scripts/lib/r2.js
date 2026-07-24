import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import mime from 'mime';
import 'dotenv/config';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.warn('R2 credentials missing. R2 operations will fail.');
}

export const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

// Bucket names live here so every script agrees on them.
export const BUCKETS = {
    masters: 'removedle-music-list',
    data: 'removedle-data',
    challenges: 'removedle-challenges',
};

// Read a small object straight into memory. Returns null when the key does not
// exist; any other failure throws, so a credential or network problem is loud
// rather than being mistaken for "no challenge that day".
export async function readObject(bucket, key) {
    try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await response.Body.transformToString();
    } catch (e) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
    }
}

export async function downloadFile(bucket, key, localPath) {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    const stream = response.Body;
    if (stream instanceof Readable) {
        await fs.writeFile(localPath, stream);
    } else {
        const data = await response.Body.transformToByteArray();
        await fs.writeFile(localPath, data);
    }
}

export async function uploadFile(bucket, key, localPath) {
    const content = await fs.readFile(localPath);
    const contentType = mime.getType(localPath) || 'application/octet-stream';

    let cacheControl = 'public, max-age=3600'; // 1 hour for json

    if (key.includes('/round-')) {
        // 1 year for snippets, won't change
        cacheControl = 'public, max-age=31536000, immutable';
    } else if (key.startsWith('art/')) {
        // 1 week for album covers
        cacheControl = 'public, max-age=604800';
    }

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
        CacheControl: cacheControl,
    });

    await s3.send(command);
}

// Paginated: a single ListObjectsV2 call caps at 1000 keys. The challenges
// bucket gains 16 objects a day, so an unpaginated listing would quietly start
// reporting objects as missing once it passed that.
export async function listObjects(bucket, prefix = '') {
    const contents = [];
    let continuationToken;

    do {
        const response = await s3.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            })
        );

        contents.push(...(response.Contents || []));
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return contents;
}

export async function syncPull(bucket, prefix, localDir, excludePrefix = null) {
    console.log(`Pulling s3://${bucket}/${prefix} to ${localDir}...`);
    const objects = await listObjects(bucket, prefix);

    await Promise.all(
        objects.map(async (obj) => {
            if (obj.Key.endsWith('/')) return; //ignore folders
            if (excludePrefix && obj.Key.startsWith(excludePrefix)) return; //ignore excluded files

            const relativeKey = prefix ? obj.Key.replace(prefix, '').replace(/^\//, '') : obj.Key;
            const localPath = path.join(localDir, relativeKey);

            try {
                const stats = await fs.stat(localPath);
                if (stats.size === obj.Size) {
                    return;
                }
            } catch (_) {
                // File missing
            }

            console.log(`  Downloading ${obj.Key} -> ${localPath}`);
            await downloadFile(bucket, obj.Key, localPath);
        })
    );
}

// Like syncPush, but skips objects already in the bucket. Intended for masters:
// the local `out/masters` folder accumulates everything, including files that
// were uploaded long ago, and re-pushing 140 MB of unchanged audio every time is
// pure waste (and Class A operations).
//
// "Already there" is decided exactly, not by size alone: R2 returns the MD5 of
// the object as its ETag for single-part uploads, which is how uploadFile writes
// them. Size is checked first because it is free; the hash only runs on files
// whose size matches. A multipart ETag (contains "-") cannot be compared this
// way, so those fall back to a size check and are reported.
export async function syncPushMissing(localDir, bucket, prefix = '') {
    console.log(`Pushing new files from ${localDir} to s3://${bucket}/${prefix}...`);

    const remote = new Map(
        (await listObjects(bucket, prefix)).map((obj) => [obj.Key, obj])
    );
    const files = await walkFiles(localDir);

    let uploaded = 0;
    let skipped = 0;

    for (const filePath of files) {
        const relativePath = path.relative(localDir, filePath);
        const key = prefix
            ? path.join(prefix, relativePath).replace(/\\/g, '/')
            : relativePath.replace(/\\/g, '/');

        const existing = remote.get(key);

        if (existing) {
            const localSize = (await fs.stat(filePath)).size;
            const etag = (existing.ETag || '').replace(/"/g, '');
            const isMultipart = etag.includes('-');

            if (existing.Size === localSize) {
                if (isMultipart) {
                    console.log(`  Skipping ${relativePath} (size match; multipart ETag)`);
                    skipped++;
                    continue;
                }

                const localMd5 = createHash('md5')
                    .update(await fs.readFile(filePath))
                    .digest('hex');

                if (localMd5 === etag) {
                    skipped++;
                    continue;
                }

                console.log(`  Re-uploading ${relativePath} (same size, different content)`);
            } else {
                console.log(`  Re-uploading ${relativePath} (size changed)`);
            }
        }

        console.log(`  Uploading ${relativePath} -> s3://${bucket}/${key}`);
        await uploadFile(bucket, key, filePath);
        uploaded++;
    }

    console.log(`Uploaded ${uploaded}, skipped ${skipped} already present.`);
}

async function walkFiles(dir) {
    const files = [];

    async function walk(current) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const res = path.resolve(current, entry.name);
            if (entry.isDirectory()) {
                await walk(res);
            } else {
                files.push(res);
            }
        }
    }

    await walk(dir);
    return files;
}

export async function syncPush(localDir, bucket, prefix = '') {
    console.log(`Pushing ${localDir} to s3://${bucket}/${prefix}...`);

    const files = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(res);
            } else {
                files.push(res);
            }
        }
    }

    await walk(localDir);

    await Promise.all(
        files.map(async (filePath) => {
            const relativePath = path.relative(localDir, filePath);
            const key = prefix
                ? path.join(prefix, relativePath).replace(/\\/g, '/')
                : relativePath.replace(/\\/g, '/');

            console.log(`  Uploading ${relativePath} -> s3://${bucket}/${key}`);
            await uploadFile(bucket, key, filePath);
        })
    );
}
