// Triage the link candidates that resolve-links.js parked on entry.needsReview.
//
// Under the strict link policy (see scripts/lib/modes.js) a match that is not
// authoritative is never published -- a confident-looking wrong link spoils the
// answer on the results screen. Those matches land in entry.needsReview instead,
// and this is the tool that turns them into a decision:
//
//   accept -> the url moves into entry.links[platform]
//   reject -> the url moves into entry.rejectedLinks[platform], so no future run
//             can propose it again
//
// Both survive a re-scan: scan-songs.js carries needsReview / rejectedLinks /
// linksOptional across, alongside the other link fields.
//
// Usage:
//   pnpm links:review --mode=challenger --list
//   pnpm links:review --mode=challenger --accept=<songId>:<platform>[:<index>]
//   pnpm links:review --mode=challenger --reject=<songId>:<platform>[:<index>]
//   pnpm links:review --mode=challenger --auto-archives [--apply]
//
// <index> is the 1-based position shown by --list; it defaults to 1. Omitting it
// on --reject throws out every candidate for that platform.
//
// --auto-archives is a bulk shortcut for the one unambiguous case: an upload on
// an obvious Jane Remover *archive* account whose title, once a leading
// "<artist> - " prefix is stripped, matches the registry title EXACTLY. Both
// halves are required. Exact-title alone is not enough (a random re-upload can
// be exact), and an archive account alone is not enough (they host other
// artists' songs too). It prints what it would do and changes nothing unless
// --apply is passed.
//
// After editing, publish with:
//   node scripts/resolve-links.js --mode=<mode> --only=<songId>   (patches songs.json)
//   node scripts/sync-r2.js push-data-json --mode=<mode>

import fs from 'fs/promises';
import path from 'path';
import { modeDirs, parseMode } from './lib/modes.js';

const MODE = parseMode();
const REGISTRY_FILE = path.join(modeDirs(MODE).data, 'song-registry.json');

const LIST = process.argv.includes('--list');
const AUTO_ARCHIVES = process.argv.includes('--auto-archives');
const APPLY = process.argv.includes('--apply');
const acceptArg = process.argv.find((a) => a.startsWith('--accept='));
const rejectArg = process.argv.find((a) => a.startsWith('--reject='));

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Uploads are usually titled "<artist> - <song>". Strip one leading
// "something - " so the comparison is against the song title alone. Only the
// FIRST separator is consumed, so "dltzk - i am not cisgender - remix" keeps
// its remaining structure rather than collapsing to the tail.
function stripArtistPrefix(title) {
    const m = String(title || '').match(/^[^-—–]{1,40}\s+[-—–]\s+(.+)$/);
    return m ? m[1] : String(title || '');
}

// An account that exists to archive THIS artist. Requires "jane remover", or
// both "jane" and "archive" -- so "Jane Remover archive" and "jane archive"
// qualify while "isaac (archived)" and "Ballslave02" do not.
function isArchiveAccount(uploader) {
    const u = norm(uploader);
    if (!u) return false;
    if (u.includes('janeremover')) return true;
    return u.includes('jane') && u.includes('archiv');
}

// Does this candidate's title, once a leading "<artist> - " is stripped, match
// the registry title exactly? Substring matches are deliberately not enough:
// that is how "0-0" matched a track called "... (SKIP TO 1:00)".
function titleMatchesExactly(entryTitle, candidate) {
    const target = norm(entryTitle);
    if (!target) return false;
    return norm(candidate.title) === target || norm(stripArtistPrefix(candidate.title)) === target;
}

// Corroboration by behaviour rather than by name: build uploader -> set of
// DISTINCT songs for which they turned up with an exact title match. An account
// carrying several different Jane Remover tracks is an archive/fan account
// whatever it happens to be called, while a one-off match from a stranger --
// the case that produces a completely unrelated video -- scores 1 and is left
// for a human. This costs no network calls; it is derived from the candidate
// pool the resolver already collected across the whole catalog.
function buildUploaderCredit(registry) {
    const credit = new Map();
    for (const [id, entry] of Object.entries(registry)) {
        for (const list of Object.values(entry.needsReview || {})) {
            for (const c of list || []) {
                if (!titleMatchesExactly(entry.title, c)) continue;
                const key = norm(c.uploader);
                if (!key) continue;
                if (!credit.has(key)) credit.set(key, new Set());
                credit.get(key).add(id);
            }
        }
    }
    return credit;
}

const MIN_CORROBORATING_TRACKS = 2;

function uploaderCredit(credit, uploader) {
    return credit.get(norm(uploader))?.size ?? 0;
}

function autoAcceptable(entryTitle, candidate, credit) {
    if (!titleMatchesExactly(entryTitle, candidate)) return false;
    return (
        isArchiveAccount(candidate.uploader) ||
        uploaderCredit(credit, candidate.uploader) >= MIN_CORROBORATING_TRACKS
    );
}

function parseTarget(arg) {
    const [id, platform, index] = arg.split('=')[1].split(':');
    if (!id || !platform) {
        console.error('Expected <songId>:<platform>[:<index>]');
        process.exit(1);
    }
    return { id, platform, index: index ? Number(index) : null };
}

function candidatesFor(entry, platform) {
    const list = entry.needsReview?.[platform];
    if (!list?.length) {
        console.error(`No candidates awaiting review for platform "${platform}".`);
        process.exit(1);
    }
    return list;
}

function pruneReview(entry, platform) {
    if (!entry.needsReview) return;
    if (!entry.needsReview[platform]?.length) delete entry.needsReview[platform];
    if (Object.keys(entry.needsReview).length === 0) delete entry.needsReview;
}

// Move `url` into entry.links[platform] and discard the platform's other
// candidates, mirroring what an explicit --accept does.
function acceptCandidate(entry, platform, chosen, rest) {
    entry.links = entry.links || {};
    entry.links[platform] = chosen.url;

    if (rest.length) {
        entry.rejectedLinks = entry.rejectedLinks || {};
        entry.rejectedLinks[platform] = [
            ...new Set([...(entry.rejectedLinks[platform] || []), ...rest.map((c) => c.url)]),
        ];
    }
    // It has a link now, so it is no longer an expected-empty track.
    delete entry.linksOptional;
    delete entry.needsReview[platform];
    pruneReview(entry, platform);
}

async function main() {
    const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));

    if (AUTO_ARCHIVES) {
        const credit = buildUploaderCredit(registry);

        const taken = [];
        for (const [id, entry] of Object.entries(registry)) {
            for (const [platform, list] of Object.entries(entry.needsReview || {})) {
                const hit = (list || []).find((c) => autoAcceptable(entry.title, c, credit));
                if (!hit) continue;
                taken.push({ id, platform, entry, hit, rest: list.filter((c) => c !== hit) });
            }
        }

        const trusted = [...credit.entries()]
            .filter(([, songs]) => songs.size >= MIN_CORROBORATING_TRACKS)
            .sort((a, b) => b[1].size - a[1].size);
        console.log('Uploaders carrying several distinct catalog tracks (exact title matches):');
        for (const [uploader, songs] of trusted) console.log(`  ${uploader}: ${songs.size} tracks`);
        console.log('');

        for (const t of taken) {
            const n = uploaderCredit(credit, t.hit.uploader);
            const why = isArchiveAccount(t.hit.uploader)
                ? `archive account${n > 1 ? `, ${n} tracks` : ''}`
                : `${n} distinct tracks`;
            console.log(`${t.entry.title}  [${t.platform}]`);
            console.log(`  -> "${t.hit.title}" by ${t.hit.uploader}  (${why})`);
            console.log(`     ${t.hit.url}`);
            if (t.rest.length) console.log(`     (discarding ${t.rest.length} other candidate(s))`);
        }

        if (!APPLY) {
            console.log(
                `\nDRY RUN: ${taken.length} candidate(s) would be accepted. Re-run with --apply.`
            );
            return;
        }

        for (const t of taken) acceptCandidate(t.entry, t.platform, t.hit, t.rest);
        await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
        console.log(`\nAccepted ${taken.length} candidate(s). Wrote ${REGISTRY_FILE}`);
        console.log(
            `Publish with:\n` +
                `  node scripts/resolve-links.js --mode=${MODE.id} --limit=0\n` +
                `  node scripts/sync-r2.js push-data-json --mode=${MODE.id}`
        );
        return;
    }

    if (LIST || (!acceptArg && !rejectArg)) {
        let total = 0;
        for (const [id, entry] of Object.entries(registry)) {
            for (const [platform, list] of Object.entries(entry.needsReview || {})) {
                if (!list.length) continue;
                console.log(`\n${entry.title}  (${id})  [${platform}]`);
                list.forEach((c, i) => {
                    console.log(`  ${i + 1}. "${c.title}" by ${c.uploader || '?'}  (${c.source})`);
                    console.log(`     ${c.url}`);
                    total++;
                });
            }
        }
        console.log(
            total ? `\n${total} candidate(s) awaiting review.` : 'Nothing awaiting review.'
        );
        return;
    }

    const target = parseTarget(acceptArg || rejectArg);
    const entry = registry[target.id];
    if (!entry) {
        console.error(`No song with id ${target.id} in ${REGISTRY_FILE}`);
        process.exit(1);
    }

    const list = candidatesFor(entry, target.platform);

    if (acceptArg) {
        const chosen = list[(target.index || 1) - 1];
        if (!chosen) {
            console.error(`No candidate #${target.index} for ${target.platform}.`);
            process.exit(1);
        }
        entry.links = entry.links || {};
        entry.links[target.platform] = chosen.url;
        // Everything else that was offered for this platform is implicitly wrong.
        entry.rejectedLinks = entry.rejectedLinks || {};
        entry.rejectedLinks[target.platform] = [
            ...new Set([
                ...(entry.rejectedLinks[target.platform] || []),
                ...list.filter((c) => c.url !== chosen.url).map((c) => c.url),
            ]),
        ];
        if (!entry.rejectedLinks[target.platform].length)
            delete entry.rejectedLinks[target.platform];
        if (Object.keys(entry.rejectedLinks).length === 0) delete entry.rejectedLinks;
        // It has a link now, so it is no longer an expected-empty track.
        delete entry.linksOptional;
        delete entry.needsReview[target.platform];
        pruneReview(entry, target.platform);
        console.log(`Accepted ${target.platform} for "${entry.title}": ${chosen.url}`);
    } else {
        const doomed = target.index ? [list[target.index - 1]] : list;
        if (doomed.some((c) => !c)) {
            console.error(`No candidate #${target.index} for ${target.platform}.`);
            process.exit(1);
        }
        entry.rejectedLinks = entry.rejectedLinks || {};
        entry.rejectedLinks[target.platform] = [
            ...new Set([
                ...(entry.rejectedLinks[target.platform] || []),
                ...doomed.map((c) => c.url),
            ]),
        ];
        entry.needsReview[target.platform] = list.filter((c) => !doomed.includes(c));
        pruneReview(entry, target.platform);
        console.log(
            `Rejected ${doomed.length} ${target.platform} candidate(s) for "${entry.title}".`
        );
    }

    await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
    console.log(`\nWrote ${REGISTRY_FILE}`);
    console.log(
        `Publish with:\n` +
            `  node scripts/resolve-links.js --mode=${MODE.id} --only=${target.id}\n` +
            `  node scripts/sync-r2.js push-data-json --mode=${MODE.id}`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(2);
});
