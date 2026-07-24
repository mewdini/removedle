import { BUCKETS, syncPull, syncPush, syncPushMissing } from './lib/r2.js';
import path from 'path';

const command = process.argv[2];

const DIRS = {
    masters: path.resolve('out/masters'),
    data: path.resolve('out/data'),
    art: path.resolve('out/covers'),
    dailies: path.resolve('out/dailies'),
};

async function main() {
    try {
        switch (command) {
            case 'pull-masters':
                await syncPull(BUCKETS.masters, '', DIRS.masters);
                break;

            case 'pull-data':
                await syncPull(BUCKETS.data, '', DIRS.data, 'art/');
                break;

            case 'pull-art':
                await syncPull(BUCKETS.data, 'art/', DIRS.art);
                break;

            // Skips anything already in the bucket, since out/masters holds the
            // whole back catalogue, not just newly added songs.
            case 'push-masters':
                await syncPushMissing(DIRS.masters, BUCKETS.masters, '');
                break;

            case 'push-data':
                await syncPush(DIRS.data, BUCKETS.data, '');
                await syncPush(DIRS.art, BUCKETS.data, 'art');
                break;

            case 'push-challenges':
                await syncPush(DIRS.dailies, BUCKETS.challenges, '');
                break;

            default:
                console.log(
                    'Usage: node scripts/sync-r2.js [pull-masters|pull-data|pull-art|push-masters|push-data|push-challenges]'
                );
                process.exit(1);
        }
        console.log('Sync complete!');
    } catch (error) {
        console.error('Sync failed:', error);
        process.exit(1);
    }
}

main();
