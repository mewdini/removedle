import { BUCKETS, syncPull, syncPush, syncPushMissing } from './lib/r2.js';
import { modeDirs, otherModeDirNames, otherPrefixes, parseMode, pushPrefix } from './lib/modes.js';

// First non-flag argument, so `--mode=` can appear on either side of it.
const command = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

const mode = parseMode();
const dirs = modeDirs(mode);

// Every mode shares the same three buckets and is told apart only by its key
// prefix, so each pull has to exclude the prefixes owned by the other modes.
// Otherwise their objects land in this mode's local tree and the next push --
// which overwrites wholesale -- re-uploads them from a stale copy.
const foreign = otherPrefixes(mode);

async function main() {
    try {
        console.log(`Mode: ${mode.id}`);

        switch (command) {
            case 'pull-masters':
                await syncPull(BUCKETS.masters, mode.prefix, dirs.masters, foreign);
                break;

            case 'pull-data':
                await syncPull(BUCKETS.data, mode.prefix, dirs.data, [
                    `${mode.prefix}art/`,
                    ...foreign,
                ]);
                break;

            case 'pull-art':
                await syncPull(BUCKETS.data, `${mode.prefix}art/`, dirs.covers);
                break;

            // Skips anything already in the bucket, since out/masters holds the
            // whole back catalogue, not just newly added songs.
            case 'push-masters':
                await syncPushMissing(dirs.masters, BUCKETS.masters, pushPrefix(mode));
                break;

            case 'push-data':
                await syncPush(dirs.data, BUCKETS.data, pushPrefix(mode));
                await syncPush(dirs.covers, BUCKETS.data, pushPrefix(mode, 'art'));
                break;

            // Data manifests only (registry, songs/covers json, link-issues) --
            // NOT album art. For jobs that touch links but not covers (the link
            // verify cron), so they need no out/covers and never re-push art.
            case 'push-data-json':
                await syncPush(dirs.data, BUCKETS.data, pushPrefix(mode));
                break;

            // out/dailies is shared: normal sits at the root and other modes nest
            // under it, mirroring the R2 key space so dev URLs match production.
            // So a normal push must skip the nested per-mode directories.
            case 'push-challenges':
                await syncPush(dirs.dailies, BUCKETS.challenges, pushPrefix(mode), {
                    excludeDirs: otherModeDirNames(mode),
                });
                break;

            default:
                console.log(
                    'Usage: node scripts/sync-r2.js [pull-masters|pull-data|pull-art|push-masters|push-data|push-data-json|push-challenges] [--mode=normal|challenger]'
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
