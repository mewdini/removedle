<script lang="ts">
    import './layout.css';
    import favicon32 from '$lib/assets/favicon-32x32.png';
    import favicon128 from '$lib/assets/favicon-128x128.png';
    import favicon180 from '$lib/assets/favicon-180x180.png';
    import favicon192 from '$lib/assets/favicon-192x192.png';
    import favicon512 from '$lib/assets/favicon-512x512.png';

    import '@fontsource/poppins';
    import Header from '$lib/components/Header.svelte';
    import { DESCRIPTION, SITE, siteName } from '$lib/statics.js';
    import { onMount } from 'svelte';
    import { setSettingsContext } from '$lib/settings.svelte';
    import { themes } from '$lib/themes';
    import { page } from '$app/state';
    import { MODES, resolveMode } from '$lib/modes';

    import type { AppSettings } from '$lib/interfaces';

    let { children } = $props();

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
    // The current page, not the mode root -- and built from page.url rather than
    // resolve(), which returns paths relative to the current route ('.',
    // '../challenger') and so cannot be concatenated onto an origin.
    const canonical = $derived(SITE + page.url.pathname);
    // og:image/twitter:image have to be absolute: the Vite import resolves to a
    // root-relative /_app/immutable path, which crawlers are not obliged to
    // resolve against the page. Prefixed with SITE rather than the request
    // origin for the same reason as canonical -- a preview shared from either
    // host then points at the one origin. Not $derived: the import is static.
    const previewImage = SITE + favicon128;
    let settings: AppSettings = $state({
        volume: 10,
        theme: 'dark',
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
    }
</script>

<svelte:head>
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

    <link rel="icon" href={SITE + '/favicon.png'} />
    <link rel="icon" type="image/png" sizes="32x32" href={favicon32} />
    <link rel="apple-touch-icon" sizes="180x180" href={favicon180} />
    <link rel="icon" type="image/png" sizes="192x192" href={favicon192} />
    <link rel="icon" type="image/png" sizes="512x512" href={favicon512} />
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
