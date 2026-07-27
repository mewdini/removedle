<script lang="ts">
    import { page } from '$app/state';
    import type { AlbumArt } from '$lib/interfaces';
    import { artUrl, resolveMode } from '$lib/modes';

    const { albumName, class: className = '' } = $props();

    const albums = $derived(page.data.albums || []);
    const albumFile = $derived(albums.find((a: AlbumArt) => a.name === albumName)?.file);
    // Per-mode prefix, not decoration: album names collide across modes (both
    // catalogs have "Teen Week"), so the slug alone would serve the official
    // cover for a challenger track.
    const src = $derived(albumFile ? artUrl(resolveMode(page.data.mode), albumFile) : '');

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
