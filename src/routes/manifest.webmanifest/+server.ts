import { DESCRIPTION, NAME } from '$lib/statics';
import maskable192 from '$lib/assets/favicon-maskable-192x192.png';
import maskable512 from '$lib/assets/favicon-maskable-512x512.png';
import favicon192 from '$lib/assets/favicon-192x192.png';
import favicon512 from '$lib/assets/favicon-512x512.png';

// Why this is a ROUTE and not static/manifest.webmanifest.
//
// The icons are `$lib/assets` imports, so Vite content-hashes them into
// /_app/immutable/assets/<name>.<hash>.png. A file in static/ cannot name a
// hashed URL, so a static manifest would need its own stable-path copies of
// every icon -- a second set of bytes that a future artwork change updates
// only if someone remembers both places. Importing the same modules that
// +layout.svelte's <link rel="icon"> tags import makes drift impossible: there
// is one copy of each icon and one URL for it.
//
// It is served by the Worker rather than prerendered, and that is forced
// rather than chosen: `export const prerender = true` fails the build with
// "Cannot access url.searchParams on a page with prerendering enabled",
// because the handle hook in src/hooks.server.ts reads the query string on
// every request to catch the janedle alias marker. Prerendering runs the whole
// server pipeline, hooks included, so no route in this app can be prerendered
// while that hook exists.
//
// The cost is one Worker invocation per manifest fetch, which is close to
// nothing: browsers request a manifest when they consider the install prompt,
// not on every page load, and the response is cacheable for an hour (below).

// The name is deliberately the canonical NAME and not siteName(). The janedle
// alias renames the site at runtime for visitors who arrive through it (see
// ALT_NAME in $lib/statics), but a manifest is a single prerendered document
// with no request behind it, and an installed app's name is baked in at install
// time. Making it vary would mean serving two manifests and giving the same
// game two identities on the home screen.
const manifest = {
    // A stable id keeps this the *same* installed app across any future change
    // to start_url. Without it the id defaults to start_url, so moving the
    // landing page would orphan every existing install.
    id: '/',
    name: NAME,
    short_name: NAME,
    description: DESCRIPTION,
    // Normal mode. Challenger is reachable from the header toggle, and an
    // install that opened straight into it would be a second app.
    start_url: '/',
    scope: '/',
    // Required (standalone/fullscreen/minimal-ui) for Chrome to treat the site
    // as installable at all.
    display: 'standalone',
    // The splash screen colour, so it matches what the app paints a moment
    // later. `dark` is the default theme in +layout.svelte for anyone whose
    // system does not prefer light, so this is the common case; a manifest is
    // static and cannot follow the player's chosen theme.
    background_color: '#121212',
    // Kept equal to the <meta name="theme-color"> in src/app.html.
    theme_color: '#799ec0',
    icons: [
        // `any` gets the untouched full-bleed artwork. These are what appear
        // unmasked -- the install dialog, the task switcher, desktop PWA
        // surfaces -- where the art's own rounded-square framing is correct.
        {
            src: favicon192,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
        },
        {
            src: favicon512,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
        },
        // `maskable` gets its own files rather than "any maskable" on one entry,
        // because the two purposes need different alpha handling (see below).
        //
        // Android masks home-screen icons to a circle or a launcher-chosen
        // squircle. Given only non-maskable icons it cannot know which pixels
        // are safe to lose, so it shrinks the whole image to sit *inscribed* in
        // the mask and pads the rest -- the "renders too small inside the
        // circle" report this exists to fix.
        //
        // These are the artwork FULL-BLEED, not inset. The first version scaled
        // it to the 80% safe zone on an opaque field, reasoning that the spec
        // only guarantees the central 80% and a crop would clip the hair and
        // hands. That was the wrong trade and the installed icon proved it: an
        // inset on an opaque background is indistinguishable from the padding
        // the mask already adds, so the launcher showed the art floating in a
        // white squircle -- the very thing being fixed, reintroduced one layer
        // in. Ink coverage was 11.4%; full-bleed is 20.6%.
        //
        // What the crop actually costs is white margin and the outermost red
        // splatter. The character survives it, and losing a little of the outer
        // artwork is the price of the icon reading as an icon at launcher size.
        // Cropping is also what the spec expects you to design for: the safe
        // zone is a promise about what SURVIVES, not an instruction to leave
        // the rest empty.
        //
        // Opaque to the edge on purpose -- the source artwork's transparent
        // rounded corners are flattened onto its own #FAFAFA canvas colour. A
        // maskable icon with transparent pixels has nothing for the launcher to
        // mask, and Android renders the gaps as black.
        {
            src: maskable192,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
        },
        {
            src: maskable512,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
        },
    ],
};

export function GET() {
    return new Response(JSON.stringify(manifest, null, 4), {
        headers: {
            'content-type': 'application/manifest+json',
            // Matches the manifests served from R2 (see uploadFile in
            // scripts/sync-r2.js). The icon URLs inside are content-hashed and
            // immutable, so an hour of staleness can only ever delay a metadata
            // change, never point at a file that has stopped existing.
            'cache-control': 'public, max-age=3600',
        },
    });
}
