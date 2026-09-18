<script lang="ts">
    import './layout.css';
    import favicon32 from '$lib/assets/favicon-32x32.png';
    import royal2Url from '$lib/assets/fonts/Royal2.woff';
    import poppinsLatinUrl from '@fontsource/poppins/files/poppins-latin-400-normal.woff2';
    import favicon128 from '$lib/assets/favicon-128x128.png';
    import appleTouchIcon from '$lib/assets/apple-touch-icon-180x180.png';
    import favicon192 from '$lib/assets/favicon-192x192.png';
    import favicon512 from '$lib/assets/favicon-512x512.png';

    import '@fontsource/poppins';
    import Header from '$lib/components/Header.svelte';
    import {
        DESCRIPTION,
        SITE,
        siteName,
        THEME_COOKIE,
        THEME_COOKIE_MAX_AGE,
    } from '$lib/statics.js';
    import { onMount, untrack } from 'svelte';
    import { setSettingsContext } from '$lib/settings.svelte';
    import { themes } from '$lib/themes';
    import { page } from '$app/state';
    import { MODES, resolveMode } from '$lib/modes';

    import type { AppSettings } from '$lib/interfaces';

    let { children, data } = $props();

    // Each mode gets its own title, description and canonical URL, so a shared
    // /challenger link previews as the Challenger game rather than the main one.
    const mode = $derived(resolveMode(page.data.mode));
    // Carries the janedle easter egg into the tab title and share previews too,
    // so the alias is consistent rather than only skin-deep on the wordmark.
    const name = $derived(siteName(!!page.data.viaAlias));
    const pageTitle = $derived(mode.id === MODES.normal.id ? name : `${name} · ${mode.label}`);
    // Both blurbs end in their own punctuation, so a plain space is enough to
    // keep the two sentences apart in the link previews Discord and Slack build
    // from this.
    const pageDescription = $derived(
        mode.id === MODES.normal.id ? DESCRIPTION : `${mode.blurb} ${DESCRIPTION}`
    );
    // The current page, not the mode root, and built from page.url rather than
    // resolve(), which returns paths relative to the current route ('.',
    // '../challenger') and so cannot be concatenated onto an origin.
    const canonical = $derived(SITE + page.url.pathname);
    // og:image/twitter:image have to be absolute: the Vite import resolves to a
    // root-relative /_app/immutable path, which crawlers are not obliged to
    // resolve against the page. Prefixed with SITE rather than the request
    // origin for the same reason as canonical: a preview shared from either
    // host then points at the one origin. Not $derived: the import is static.
    const previewImage = SITE + favicon128;
    // Painted straight into the SSR'd <head>, so the correct colors are in the
    // very first HTML response rather than applied later by the settings
    // effect below, which only runs client-side after hydration
    // html:root, not the bare :root layout.css itself uses for its own
    // hardcoded 'dark' fallback: both rules match the same element, so with
    // equal specificity the one that is LATER in the document wins, and
    // layout.css's compiled <style> tag lands after this one. html:root
    // (0,1,1) beats a plain :root (0,1,0) regardless of order, closing that
    // gap for every theme but dark, where the two values happen to coincide.
    // No separate body{} rule needed: layout.css's own already reads
    // var(--bg-color)/var(--text-color), so fixing the variable is enough
    const ssrThemeStyleTag = $derived.by(() => {
        if (!data.theme) return '';
        const t = themes[data.theme as keyof typeof themes];
        const css = `html:root{--bg-color:${t.bg};--text-color:${t.text};--accent-color:${t.accent};--card-color:${t.card};--muted-color:${t.muted}}`;
        return `<style>${css}</style>`;
    });
    // Seeded from the theme cookie +layout.server.ts already read, when there
    // is one, so the very first client render already matches what the SSR'd
    // <style> block below painted, instead of starting at the hardcoded
    // default and only correcting once the settings effect runs
    // untrack, since this is a genuine one-time seed: onMount and saveSettings
    // own settings.theme from here on, and re-deriving it from data on every
    // future change to data would fight the user's own later choices
    let settings: AppSettings = $state({
        volume: 10,
        theme: untrack(() => data.theme) ?? 'dark',
        firstTimeHelp: false,
    });
    setSettingsContext(settings);

    onMount(() => {
        const settingsJson = localStorage.getItem(`removedle-settings`);
        if (settingsJson) {
            try {
                const parsed = JSON.parse(settingsJson);
                if (parsed && typeof parsed === 'object') {
                    const volumeNumber = Number(parsed.volume);
                    if (!isNaN(volumeNumber) && volumeNumber >= 1 && volumeNumber <= 100) {
                        settings.volume = volumeNumber;
                    }
                    if (parsed.theme && parsed.theme in themes) {
                        settings.theme = parsed.theme;
                    }
                    settings.firstTimeHelp = !!parsed.firstTimeHelp;

                    // Anyone with a saved theme from before the cookie existed
                    // has none yet, so every full page load keeps missing the
                    // SSR benefit until they happen to open Settings. Writes
                    // once per mismatch, not every mount
                    if (settings.theme !== data.theme) saveSettings();
                }
            } catch (e) {
                console.error('Failed to parse settings:', e);
            }
        } else {
            // No saved settings, this is a first-time user
            settings.firstTimeHelp = true;

            // Check system preference for theme
            const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
            if (prefersLight) {
                settings.theme = 'white';
            }

            // Save the initial settings so it's not a "first time" anymore next refresh
            saveSettings();
        }
    });

    $effect(() => {
        const themeData = themes[settings.theme];
        const root = document.documentElement;

        Object.entries(themeData).forEach(([key, value]) => {
            root.style.setProperty(`--${key}-color`, value);
        });

        document.body.style.backgroundColor = themeData.bg;
        document.body.style.color = themeData.text;
    });

    // save everytime theres a change to settings
    function saveSettings() {
        const stateToSave = JSON.stringify(settings);
        localStorage.setItem(`removedle-settings`, stateToSave);
        // Only the theme needs a cookie, since it's the only setting the
        // server render depends on. Volume and firstTimeHelp stay localStorage-only
        document.cookie = `${THEME_COOKIE}=${settings.theme}; Max-Age=${THEME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
    }
</script>

<svelte:head>
    <link rel="preload" href={royal2Url} as="font" type="font/woff" crossorigin="anonymous" />
    <!-- Only the latin subset: unicode-range on the other two poppins-*-400
         subsets (devanagari, latin-ext) already stops the browser fetching
         them unless the page actually contains those characters, so
         preloading them too would just waste bandwidth on files that were
         never going to load anyway -->
    <link
        rel="preload"
        href={poppinsLatinUrl}
        as="font"
        type="font/woff2"
        crossorigin="anonymous"
    />
    <!-- {@html}, not a plain <style> tag with an expression inside it
         Svelte parses any <style> element as CSS wherever it appears, not just
         its own top-level one, so an interpolated expression there is read as
         literal invalid CSS text instead of being evaluated
         ssrThemeStyleTag only ever holds the fixed hex values from
         $lib/themes, indexed by a cookie value +layout.server.ts already
         validated against that same theme list, so there is no injected
         content to escape -->
    {#if data.theme}
        {@html ssrThemeStyleTag}
    {/if}
    <title>{pageTitle}</title>
    <meta name="description" content={pageDescription} />
    <link rel="canonical" href={canonical} />

    <!-- Google / Search Engine Tags -->
    <meta itemprop="name" content={pageTitle} />
    <meta itemprop="description" content={pageDescription} />
    <meta itemprop="image" content={previewImage} />

    <!-- Facebook Meta Tags -->
    <meta property="og:url" content={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={pageTitle} />
    <meta property="og:description" content={pageDescription} />
    <meta property="og:image" content={previewImage} />

    <!-- Twitter Meta Tags -->
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content={pageTitle} />
    <meta name="twitter:description" content={pageDescription} />
    <meta name="twitter:image" content={previewImage} />

    <!-- Every icon below declares its size. There used to be a bare
         <link rel="icon"> here with no `sizes` and an absolute SITE URL: it gave
         icon-picking user agents nothing to rank it by, and because the href was
         hardcoded to production, localhost and preview fetched the site icon
         cross-origin from the live site. It pointed at static/favicon.png, which
         was a byte-identical copy of favicon-512x512.png, so 329 KB shipped
         twice. Removed with the file; /favicon.ico still covers the bare
         convention request. -->
    <link rel="icon" type="image/png" sizes="32x32" href={favicon32} />
    <!-- iOS does not read the web app manifest for home-screen icons, so this
         tag is the only thing that feeds it, and it needs its own file. The one
         requirement it adds over a favicon is opacity: iOS composites an
         apple-touch-icon onto black rather than onto the wallpaper, so the
         artwork's own transparent rounded corners would show as black notches
         under iOS's (wider) squircle mask. apple-touch-icon-180x180.png is
         favicon-180x180.png flattened onto the artwork's #FAFAFA background.
         It stays full-bleed; unlike the maskable icons below, iOS crops gently
         and doesn't need the 80% safe zone. -->
    <link rel="apple-touch-icon" sizes="180x180" href={appleTouchIcon} />
    <!-- This tag alone didn't stop the 404s: plenty of clients (bots, link
         unfurlers, some older iOS builds) fetch /apple-touch-icon.png and
         /apple-touch-icon-precomposed.png at the site root by convention
         instead of parsing the page for a <link>. static/apple-touch-icon.png
         and static/apple-touch-icon-precomposed.png are byte-identical copies
         of this same file, serving that convention directly, the same way
         static/favicon.ico backs the bare favicon request above -->
    <link rel="icon" type="image/png" sizes="192x192" href={favicon192} />
    <link rel="icon" type="image/png" sizes="512x512" href={favicon512} />
    <!-- Root-relative and hardcoded rather than resolve()d: resolve() returns
         URLs relative to the current route ('.', '../challenger'), which would
         make the manifest's own URL, and therefore the resolution base for
         start_url and scope, depend on the page it was linked from. -->
    <link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

<div class="m-auto flex w-full max-w-[800px] flex-col items-center p-2 align-middle">
    <Header
        bind:volume={settings.volume}
        bind:theme={settings.theme}
        bind:firstTimeHelp={settings.firstTimeHelp}
        {saveSettings}
    />
    {@render children()}
</div>
