import { D1Database, R2Bucket, IncomingRequestCfProperties } from '@cloudflare/workers-types';
declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            // Set by the handle hook from the ALT_COOKIE cookie: this player
            // arrived through the alias domain and has earned the wordmark
            // easter egg. Named by the constant rather than spelled out, since
            // the cookie carries a version suffix that changes when stale ones
            // need abandoning. See ALT_HOST in $lib/statics.
            viaAlias: boolean;
        }
        // interface PageData {}
        // interface PageState {}
        interface Platform {
            env: {
                DB: D1Database;
                CHALLENGES: R2Bucket;
            };
            cf?: IncomingRequestCfProperties; // Add this to the Platform type
        }
    }
}

export {};
