<script lang="ts">
    import { untrack } from 'svelte';
    import { SvelteMap } from 'svelte/reactivity';
    import { page } from '$app/state';
    import type { AlbumArt, Song } from '$lib/interfaces';
    import {
        catalogFeedUrl,
        MODE_LIST,
        MODES,
        resolveMode,
        type ModeConfig,
        type ModeId,
    } from '$lib/modes';
    import {
        catalogFlag,
        describeAge,
        describeChange,
        flagDate,
        lastTouched,
        matchesQuery,
        RECENT_WINDOW_DAYS,
        type CatalogFlag,
    } from '$lib/catalog';
    import { getTodayDate } from '$params/date';
    import Modal from './Modal.svelte';
    import AlbumArtComponent from './game/AlbumArt.svelte';
    import StreamingLinks from './game/StreamingLinks.svelte';

    type Catalog = { songList: Song[]; albums: AlbumArt[] };

    const { revealed, onClose } = $props();

    // The mode being PLAYED, which is not necessarily the one being browsed.
    const pageMode = $derived(resolveMode(page.data.mode));
    const today = getTodayDate();

    let browsingId = $state<ModeId>(MODES.normal.id);
    let query = $state('');
    let sort = $state<'title' | 'recent'>('title');
    let loading = $state(false);
    let loadError = $state(false);

    // Only the other mode ever lands here; the played mode's catalog is already
    // in page.data. Kept for the life of the page so flipping tabs back and forth
    // costs one request, not one per tap.
    const fetched = new SvelteMap<ModeId, Catalog>();

    // Open on whatever is being played. Keyed on `revealed` alone -- reading
    // pageMode untracked, or a mid-session mode switch would yank the tab out
    // from under someone with the modal already open.
    $effect(() => {
        if (!revealed) return;
        untrack(() => {
            browsingId = pageMode.id;
            query = '';
            sort = 'title';
            loadError = false;
        });
    });

    const browsing: ModeConfig = $derived(MODES[browsingId]);
    const catalog = $derived<Catalog | null>(
        browsingId === pageMode.id
            ? { songList: page.data.songList ?? [], albums: page.data.albums ?? [] }
            : (fetched.get(browsingId) ?? null)
    );

    async function selectMode(id: ModeId) {
        browsingId = id;
        loadError = false;
        if (id === pageMode.id || fetched.has(id)) return;

        loading = true;
        try {
            const res = await fetch(catalogFeedUrl(MODES[id]));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            fetched.set(id, { songList: data.songList ?? [], albums: data.albums ?? [] });
        } catch (e) {
            console.error(`Failed to load the ${id} catalog:`, e);
            // Only surface the failure if the player is still looking at the tab
            // that failed, so a tab they already moved away from cannot show an
            // error over the catalog they are actually reading.
            if (browsingId === id) loadError = true;
        } finally {
            if (browsingId === id) loading = false;
        }
    }

    const songs = $derived(catalog?.songList ?? []);
    const albums = $derived(catalog?.albums ?? []);
    const matches = $derived(songs.filter((s) => matchesQuery(s, query)));

    const flagged = $derived(
        matches
            .map((song) => ({ song, flag: catalogFlag(song, browsing, today) }))
            .filter((r): r is { song: Song; flag: CatalogFlag } => r.flag !== null)
            .sort((a, b) =>
                (flagDate(b.song, b.flag) ?? '').localeCompare(flagDate(a.song, a.flag) ?? '')
            )
    );

    const ordered = $derived(
        [...matches].sort((a, b) =>
            sort === 'title'
                ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
                : lastTouched(b).localeCompare(lastTouched(a)) ||
                  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
        )
    );

    // The changelist is a shortcut to the top of an A-Z list. Under "Newest" the
    // whole list already leads with the same tracks, so repeating them would just
    // push the catalog down the page.
    const showRecent = $derived(sort === 'title' && !query.trim() && flagged.length > 0);

    function albumOf(song: Song) {
        return albums.find((a: AlbumArt) => a.name === song.album);
    }
</script>

{#snippet badge(flag: CatalogFlag, when: string | undefined)}
    <span
        class="shrink-0 rounded-full px-2 py-[1px] text-[9px] font-bold tracking-widest uppercase {flag ===
        'new'
            ? 'bg-theme-accent text-theme-text'
            : 'text-theme-muted ring-1 ring-theme-muted'}"
        title={when ? `${flag === 'new' ? 'Added' : 'Changed'} ${describeAge(when, today)}` : ''}
    >
        {flag}
    </span>
{/snippet}

{#snippet row(song: Song, flag: CatalogFlag | null)}
    {@const album = albumOf(song)}
    {@const change = flag === 'updated' ? describeChange(song) : null}
    <li class="flex flex-row gap-3 py-2">
        <AlbumArtComponent
            albumName={song.album}
            albumMap={albums}
            modeId={browsing.id}
            class="mt-0.5 h-10 w-10 shrink-0 rounded-md border border-theme-text"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex flex-row flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-sm font-semibold break-words text-theme-text">{song.title}</span>
                {#if flag}
                    {@render badge(flag, flagDate(song, flag))}
                {/if}
            </div>
            <!-- Non-breaking spaces around the separator, not plain ones: Svelte
                 trims whitespace at the start of a block, so a literal space
                 there disappears and it renders "Jane Remover· Teen Week". They
                 also keep the dot from wrapping onto a line of its own. -->
            <span class="text-[11px] text-theme-muted">
                {song.artist}{#if album && !album.isSingle}&nbsp;·&nbsp;<span class="italic"
                        >{song.album}</span
                    >{/if}
            </span>
            {#if change}
                <span class="text-[11px] text-theme-muted italic">{change}</span>
            {/if}
            <!-- Every track that has any link gets them here. This is the whole
                 point of the browser: the catalog is full of leaks and demos
                 nobody can be expected to recognise from the title alone. -->
            <div class="mt-0.5">
                <StreamingLinks links={song.links ?? {}} inGame={false} />
            </div>
        </div>
    </li>
{/snippet}

<Modal {revealed} {onClose} maxWidth="max-w-2xl" bodyClass="p-4 text-left sm:p-6">
    <div class="flex flex-col gap-3 text-theme-text">
        <div class="flex flex-col gap-3 pr-8">
            <span class="text-xl font-bold">Catalog</span>

            <!-- Client-side tabs rather than the anchors the header's mode
                 toggle uses. Navigating would move a player who only wanted to
                 look at the other tracklist into the other game. -->
            <nav
                aria-label="Catalog mode"
                class="flex flex-row gap-0.5 self-start rounded-full border border-theme-muted p-0.5"
            >
                {#each MODE_LIST as m (m.id)}
                    <button
                        type="button"
                        aria-pressed={m.id === browsingId}
                        onclick={() => selectMode(m.id)}
                        class="cursor-pointer rounded-full px-4 py-1 text-sm font-bold transition-all active:scale-95 {m.id ===
                        browsingId
                            ? 'bg-theme-accent text-theme-text'
                            : 'text-theme-muted hover:text-theme-text'}">{m.label}</button
                    >
                {/each}
            </nav>
        </div>

        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
                type="search"
                placeholder="Search title, artist or album"
                aria-label="Search the catalog"
                bind:value={query}
                class="min-w-0 flex-1 rounded-lg border border-theme-text bg-theme-bg p-2 text-sm text-theme-text outline-none focus:ring-2 focus:ring-theme-accent"
            />
            <div
                class="flex shrink-0 flex-row gap-0.5 self-start rounded-full border border-theme-muted p-0.5"
            >
                {#each [['title', 'A-Z'], ['recent', 'Newest']] as const as [value, label] (value)}
                    <button
                        type="button"
                        aria-pressed={sort === value}
                        onclick={() => (sort = value)}
                        class="cursor-pointer rounded-full px-3 py-1 text-xs font-bold transition-all active:scale-95 {sort ===
                        value
                            ? 'bg-theme-accent text-theme-text'
                            : 'text-theme-muted hover:text-theme-text'}">{label}</button
                    >
                {/each}
            </div>
        </div>

        {#if loading}
            <p class="py-10 text-center text-sm text-theme-muted">Loading {browsing.label}…</p>
        {:else if loadError}
            <div class="flex flex-col items-center gap-2 py-10 text-center">
                <p class="text-sm text-theme-muted">Could not load the {browsing.label} catalog.</p>
                <button
                    type="button"
                    class="cursor-pointer text-sm underline decoration-dotted underline-offset-2"
                    onclick={() => selectMode(browsingId)}>Try again</button
                >
            </div>
        {:else}
            <p class="text-xs text-theme-muted">
                {songs.length}
                {songs.length === 1 ? 'song' : 'songs'} can come up in {browsing.label}{#if query.trim()},
                    {matches.length}
                    matching{/if}. Badges mark anything added or retitled in the last {RECENT_WINDOW_DAYS}
                days.
            </p>

            <div class="max-h-[55vh] overflow-y-auto pr-1">
                {#if matches.length === 0}
                    <p class="py-10 text-center text-sm text-theme-muted">
                        Nothing matches “{query.trim()}”.
                    </p>
                {:else}
                    {#if showRecent}
                        <span class="text-xs font-bold tracking-widest text-theme-muted uppercase"
                            >Recently added or changed</span
                        >
                        <ul class="divide-y divide-theme-muted/25">
                            {#each flagged as { song, flag } (song.id)}
                                {@render row(song, flag)}
                            {/each}
                        </ul>
                        <hr class="my-3 border-theme-muted" />
                        <span class="text-xs font-bold tracking-widest text-theme-muted uppercase"
                            >All tracks</span
                        >
                    {/if}
                    <ul class="divide-y divide-theme-muted/25">
                        {#each ordered as song (song.id)}
                            {@render row(song, catalogFlag(song, browsing, today))}
                        {/each}
                    </ul>
                {/if}
            </div>
        {/if}
    </div>
</Modal>
