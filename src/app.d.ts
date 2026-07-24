import { D1Database, R2Bucket, IncomingRequestCfProperties } from '@cloudflare/workers-types';
declare global {
    namespace App {
        // interface Error {}
        // interface Locals {}
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
