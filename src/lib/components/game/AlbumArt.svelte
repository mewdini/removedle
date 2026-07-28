<script lang="ts">
    import { page } from '$app/state';
    import type { AlbumArt } from '$lib/interfaces';
    import { artUrl, resolveMode } from '$lib/modes';

    // `albumMap` and `modeId` default to the page's own mode, which is what every
    // in-game caller wants. The catalog browser overrides them because it can
    // show a mode other than the one being played, and page.data always describes
    // the game underneath the modal.
    const { albumName, class: className = '', albumMap = undefined, modeId = undefined } = $props();

    const albums = $derived(albumMap ?? page.data.albums ?? []);
    const albumFile = $derived(albums.find((a: AlbumArt) => a.name === albumName)?.file);
    // Per-mode prefix, not decoration: album names collide across modes (both
    // catalogs have "Teen Week"), so the slug alone would serve the official
    // cover for a challenger track. Which is also why the override above has to
    // move the mode and the album map together -- one without the other is how
    // you get the official cover on a leak.
    const src = $derived(albumFile ? artUrl(resolveMode(modeId ?? page.data.mode), albumFile) : '');

    // A cover can be listed in covers.json and still 404 -- `push-data-json`
    // publishes the manifests but NOT the art, so a scan that adds an album
    // followed by that push leaves the catalog referencing an object that is not
    // in the bucket. Without this the browser draws its broken-image icon;
    // falling back to the same placeholder used for "no art at all" keeps the
    // layout intact. Reset per src so one failure doesn't poison later covers.
    let failed = $state(false);
    $effect(() => {
        const _ = src;
        failed = false;
    });
</script>

{#if src && !failed}
    <img {src} alt={albumName} class={className} onerror={() => (failed = true)} />
{:else}
    <div class={`${className} bg-theme-card`}></div>
{/if}
