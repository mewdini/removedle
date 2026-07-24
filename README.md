<div align="center">
    <img src="src/lib/assets/favicon-128x128.png" alt="removedle logo" style="vertical-align: middle; margin-right: 15px;" />
    <h1>removedle</h1>
</div>

<div align="center"><i>A daily Jane Remover song guessing game featuring five songs and three guesses per track.</i></div>

<div align="center"><a href="https://removedle.org">removedle.org</a></div>

A fork of [underscordle](https://github.com/angelolz/underscordle) by [angelolz](https://github.com/angelolz).

## Tech Stack

- **Frontend**: [Svelte 5](https://svelte.dev/) & [SvelteKit](https://svelte.dev/docs/kit/introduction) (Cloudflare adapter)
- **Styling**: [TailwindCSS v4](https://tailwindcss.com/) (Vite plugin integration)
- **Hosting**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) with static assets
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (aggregate daily stats only)
- **Media**: [Cloudflare R2](https://developers.cloudflare.com/r2/) (song masters, metadata, album art, daily snippets)
- **ORM & Migrations**: [Drizzle ORM](https://orm.drizzle.team/)
- **Deployment & Emulation**: [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- **Audio Processing**: [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), spawned directly by the ingestion scripts

## Project Structure

- `src/routes/`: pages and endpoints, including the gated challenge media route
- `src/lib/components/`: UI components
- `src/lib/server/db/`: Drizzle schema
- `scripts/`: audio conversion, cover extraction, metadata manifests, daily snippet generation, R2 sync
- `drizzle/`: generated SQL migrations

## How it works

- Player progress and streaks live in `localStorage`. D1 stores only aggregate `totalGames` / `totalPoints` per date.
- Song metadata and album art are served publicly from R2 via `assets.removedle.org`.
- Daily snippets live in a **private** R2 bucket and are served through `src/routes/challenges/[date=date]/[file]`, which refuses any date later than today. Challenges are generated the day before, so a public bucket would leak upcoming answers.
- Dates are UTC everywhere, so a challenge unlocks worldwide at the same instant: 00:00 UTC.

## Local Development Setup

Requirements:

1. **Node.js** (v20+, see `.nvmrc`)
2. **pnpm** (see the `packageManager` field in `package.json`)

FFmpeg is **not** a system prerequisite. `scripts/lib/ffmpeg.js` spawns the bundled `ffmpeg-static` binary.

### Clone and install

```bash
git clone https://github.com/mewdini/removedle
cd removedle
pnpm install
```

### Set up the local database

```bash
pnpm db:migrate:local
```

This writes a SQLite file under `.wrangler/state/v3/d1` and applies the migrations. After editing `src/lib/server/db/schema.ts`, generate a migration with `pnpm db:generate`.

> If you change `database_id` in `wrangler.jsonc`, the local database changes with it. Re-run `pnpm db:migrate:local` or every query will fail against an empty file.

### Prepare assets

1. Create a `masters/` directory in the root and add audio (`.mp3`, `.wav`, `.flac`).
    - **Tag your files properly, artwork included.** Song info and album covers are read from the embedded metadata.
2. Run in order:

    ```bash
    pnpm convert      # -> out/masters/*.m4a (skip if your sources are mp3)
    pnpm bootstrap    # initializes the song registry -- RUN ONCE, EVER
    pnpm scan         # metadata + covers -> out/data/ and out/covers/
    pnpm generate     # daily snippets -> out/dailies/  (pnpm generate YYYY-MM-DD for a specific day)
    ```

    Re-run `pnpm scan` whenever you add songs. Never re-run `pnpm bootstrap` on an existing registry: song IDs are permanent and referenced by every past challenge.

3. Link the generated media into SvelteKit's static directory:
    - **Windows (PowerShell)**: `.\scripts\link-assets.ps1`
    - **macOS/Linux**: `chmod +x ./scripts/link-assets.sh && ./scripts/link-assets.sh`

### Run the dev server

Set `START_DATE_STRING` in `src/lib/statics.ts` to your earliest generated challenge date, then:

```bash
pnpm dev
```

`pnpm preview` builds and serves through `wrangler dev` (port 8787) instead.

## Deploying

Deployment targets Cloudflare Workers and expects three R2 buckets plus a D1 database. Credentials go in `.env` (see `.env.example`) and, for CI, in the `R2_*` repository secrets.

```bash
pnpm db:migrate:prod   # apply migrations to the remote D1
pnpm deploy:prod       # build and deploy
```

> **Unlink the dev asset links before deploying.** `link-assets` puts `out/dailies` under `static/`, everything in `static/` is bundled, and on Workers static assets are served *before* the Worker, so bundled challenge files would bypass the date gate and expose unreleased audio. `scripts/check-deployable.js` blocks the deploy scripts if the links are present.

Two GitHub Actions handle content:

- **Daily Challenges**: cron at 05:00 UTC, generates the next day and pushes to R2
- **Sync Metadata**: manual, re-scans masters and republishes metadata and art

`node scripts/sync-r2.js [pull-masters|pull-data|pull-art|push-masters|push-data|push-challenges]` moves data between `out/` and R2. `push-masters` skips objects already uploaded.

## Quality and Linting Standards

- Run `pnpm lint` (Prettier and ESLint, both fix in place)
- Type-check with `pnpm exec svelte-check`
- Keep type definitions in `src/app.d.ts` or `$lib/interfaces.ts`

## License

GPL-3.0
