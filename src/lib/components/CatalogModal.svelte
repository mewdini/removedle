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
        albumReleaseKeys,
        describeAge,
        isNewTrack,
        matchesQuery,
        releaseYear,
    } from '$lib/catalog';
    import { getGameDate } from '$params/date';
    import Modal from './Modal.svelte';
    import AlbumArtComponent from './game/AlbumArt.svelte';
    import StreamingLinks from './game/StreamingLinks.svelte';

    type Catalog = { songList: Song[]; albums: AlbumArt[] };

    const { revealed, onClose } = $props();

    // The mode being PLAYED, which is not necessarily the one being browsed
    const pageMode = $derived(resolveMode(page.data.mode));
    // The live game day, which the NEW badge window is measured against. Same
    // reckoning the pipeline stamps addedAt with, so a song published in the
    // evening is not immediately described as "yesterday"
    const today = getGameDate();

    type SortKey = 'title' | 'album';

    // Two pills rather than a <select>: narrow enough to clear the mobile
    // width budget (a 320px viewport gives the modal body 264px, after mx-3
    // and p-4), and on mobile it sits on its own line under the search box.
    //
    // No dedicated Year sort: it only reordered individual tracks by their
    // own release date with no album grouping, which is a narrower view of
    // what Album already gives you (album release order, then track order
    // within it) plus the actual tracklist sequencing Year couldn't offer.
    const SORTS = [
        ['title', 'A-Z', 'Sort by title'],
        ['album', 'Album', 'Sort by album release order, then by track order within it'],
    ] as const satisfies readonly (readonly [SortKey, string, string])[];

    let browsingId = $state<ModeId>(MODES.normal.id);
    let query = $state('');
    let sort = $state<SortKey>('title');
    let loading = $state(false);
    let loadError = $state(false);

    // Only the other mode ever lands here; the played mode's catalog is already
    // in page.data. Kept for the life of the page so flipping tabs back and forth
    // costs one request, not one per tap
    const fetched = new SvelteMap<ModeId, Catalog>();

    // Open on whatever is being played. Keyed on `revealed` alone: reading
    // pageMode untracked, or a mid-session mode switch would yank the tab out
    // from under someone with the modal already open
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
            // error over the catalog they are actually reading
            if (browsingId === id) loadError = true;
        } finally {
            if (browsingId === id) loading = false;
        }
    }

    const songs = $derived(catalog?.songList ?? []);
    const albums = $derived(catalog?.albums ?? []);
    const matches = $derived(songs.filter((s) => matchesQuery(s, query)));
    // Computed over the whole browsed catalog, not `matches`, so filtering
    // down to a search doesn't reorder albums relative to each other
    const albumOrder = $derived(albumReleaseKeys(songs));
    // isSingle per album name, same shape and reason as albumOrder above
    const albumIsSingle = $derived(new Map(albums.map((a) => [a.name, a.isSingle])));

    const byTitle = (a: Song, b: Song) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

    // Every ordering falls back to title, so rows that tie (two tracks off the
    // same album, or two loosies from the same year) keep a stable, readable
    // order instead of whatever the input array happened to hold
    const ordered = $derived(
        [...matches].sort((a, b) => {
            switch (sort) {
                case 'album': {
                    // Real albums before loosies (singlesAsOwnAlbum's one-track
                    // "albums"), as two separate blocks each sorted by date among
                    // themselves, rather than interleaving a loosie's own release
                    // date between two actual albums
                    const aSingle = albumIsSingle.get(a.album) ?? false;
                    const bSingle = albumIsSingle.get(b.album) ?? false;
                    if (aSingle !== bSingle) return aSingle ? 1 : -1;
                    // Albums ordered by their own earliest track (albumOrder, see
                    // $lib/catalog), newest first. Undated albums go to the end
                    const ra = albumOrder.get(a.album) ?? '';
                    const rb = albumOrder.get(b.album) ?? '';
                    if (ra !== rb) return !ra || !rb ? (ra ? -1 : 1) : rb.localeCompare(ra);
                    // Two different albums tied on the same rank key (undated
                    // loosies under singlesAsOwnAlbum tie constantly, all at '')
                    // still need to sort as two separate contiguous blocks, not
                    // interleave by title, or a real multi-track album caught in
                    // the same tie loses its own internal grouping
                    if (a.album !== b.album) return a.album.localeCompare(b.album);
                    // Same album: the track's own position on the release
                    // Falls back to title when either side has no track number, since
                    // an untagged track can't be placed against its numbered neighbors
                    if (
                        a.trackNumber != null &&
                        b.trackNumber != null &&
                        a.trackNumber !== b.trackNumber
                    ) {
                        return a.trackNumber - b.trackNumber;
                    }
                    return byTitle(a, b);
                }
                default:
                    return byTitle(a, b);
            }
        })
    );

    function albumOf(song: Song) {
        return albums.find((a: AlbumArt) => a.name === song.album);
    }

    // Consecutive runs of `ordered`, since album sort already groups same-album
    // tracks together. Loosies are excluded and handled separately below: a
    // heading naming a one-track "album" just repeats that track's own title
    // back at it, so they render as one flat, undivided-by-heading list instead
    const albumGroups = $derived.by(() => {
        const groups: { name: string; songs: Song[] }[] = [];
        for (const song of ordered) {
            if (albumIsSingle.get(song.album)) continue;
            const current = groups.at(-1);
            if (current?.name === song.album) {
                current.songs.push(song);
            } else {
                groups.push({ name: song.album, songs: [song] });
            }
        }
        return groups;
    });
    const loosies = $derived(ordered.filter((song) => albumIsSingle.get(song.album)));

    /**
     * The "artist · album · year" line under a title, as the segments that
     * actually have something to say.
     *
     * The artist is dropped when the track is credited solely to the mode's
     * primary artist, which is almost all of them: this is a game about one
     * artist, so "Jane Remover" on every row is the least informative thing on
     * the screen and it pushes the album and year along. It reappears the moment
     * a track credits somebody else ("Jane Remover, Lucy Bedroque"), which is
     * the only time the field tells you anything. Compared case-insensitively
     * and trimmed, so a stray tag variant does not resurrect it on one row
     */
    function metaParts(song: Song, album: AlbumArt | undefined, year: string | null) {
        const parts: { key: string; text: string }[] = [];
        const artist = song.artist?.trim() ?? '';
        if (artist && artist.toLowerCase() !== browsing.primaryArtist.toLowerCase()) {
            parts.push({ key: 'artist', text: artist });
        }
        if (album && !album.isSingle) parts.push({ key: 'album', text: song.album });
        if (year) parts.push({ key: 'year', text: year });
        return parts;
    }
</script>

{#snippet badge(when: string | undefined)}
    <span
        class="shrink-0 rounded-full bg-theme-accent px-2 py-[1px] text-[9px] font-bold tracking-widest text-theme-text uppercase"
        title={when ? `Added ${describeAge(when, today)}` : ''}
    >
        new
    </span>
{/snippet}

{#snippet row(song: Song, isNew: boolean)}
    {@const album = albumOf(song)}
    {@const year = releaseYear(song)}
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
                {#if isNew}
                    {@render badge(song.addedAt)}
                {/if}
            </div>
            <!-- Built as parts and joined, not inline {#if}s around a literal
                 separator. Every segment is optional (artist on tracks credited
                 solely to the primary artist, album on a one-track "album", year
                 on an undated master), and hand-placed separators would leave a
                 leading "· Teen Week" once the first one dropped.

                 Non-breaking spaces around the dot, not plain ones: Svelte trims
                 whitespace at the start of a block, so a literal space disappears
                 and it renders "Jane Remover· Teen Week". They also keep the dot
                 from wrapping onto its own line. The album keeps its italics, so
                 parts are rendered rather than joined into one string -->
            <span class="text-[11px] text-theme-muted">
                {#each metaParts(song, album, year) as part, i (part.key)}
                    {#if i > 0}&nbsp;·&nbsp;{/if}{#if part.key === 'album'}<span class="italic"
                            >{part.text}</span
                        >{:else}{part.text}{/if}
                {/each}
            </span>
            <!-- Every track that has any link gets them here. This is the whole
                 point of the browser: the catalog is full of leaks and demos
                 nobody can be expected to recognise from the title alone -->
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
                 look at the other tracklist into the other game -->
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
            <!-- Not "artist": this is a game about one artist, so offering to
                 search by it promises something the list cannot give you. The
                 second name on a challenger remix ("Charli XCX - I Finally
                 Understand (remix)") lives in the title. matchesQuery still
                 checks the artist field anyway; see the note there -->
            <!-- text-base, not text-sm: under 16px, iOS Safari zooms the page on focus -->
            <input
                type="search"
                placeholder="Search by title or album"
                aria-label="Search the catalog by title or album"
                bind:value={query}
                class="min-w-0 flex-1 rounded-lg border border-theme-text bg-theme-bg p-2 text-base text-theme-text outline-none focus:ring-2 focus:ring-theme-accent"
            />
            <div
                role="group"
                aria-label="Sort the catalog"
                class="flex shrink-0 flex-row gap-0.5 self-start rounded-full border border-theme-muted p-0.5"
            >
                {#each SORTS as [value, label, hint] (value)}
                    <button
                        type="button"
                        title={hint}
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
                {matches.length}
                {matches.length === 1 ? 'match' : 'matches'}
            </p>

            <!-- Fixed height, not just a cap: a short match count (or zero) used
                 to size this area down to its own content, so the whole modal
                 visibly shrank while narrowing a search and grew back on
                 clearing it.

                 dvh, not vh: see the note on Modal.svelte's max-h-[90dvh].
                 55vh compounded with the header content above it could push
                 the outer max-h-[90dvh] cap to clip against Safari's
                 inflated large-viewport height rather than the real
                 visible one -->
            <div class="catalog-scroll h-[55dvh] overflow-y-auto pr-1">
                {#if matches.length === 0}
                    <p class="py-10 text-center text-sm text-theme-muted">
                        Nothing matches “{query.trim()}”.
                    </p>
                {:else if sort === 'album'}
                    {#each albumGroups as group (group.songs[0].id)}
                        <span
                            class="mt-3 block text-xs font-bold tracking-widest text-theme-muted uppercase first:mt-0"
                            >{group.name}</span
                        >
                        <ul class="divide-y divide-theme-muted/25">
                            {#each group.songs as song (song.id)}
                                {@render row(song, isNewTrack(song, browsing, today))}
                            {/each}
                        </ul>
                    {/each}
                    {#if loosies.length > 0}
                        <!-- N/A, not each loosie's own title: this is one heading
                                 for the whole trailing block, not a divider repeating
                                 40 different one-track "albums" back at themselves -->
                        <span
                            class="mt-3 block text-xs font-bold tracking-widest text-theme-muted uppercase first:mt-0"
                            >N/A</span
                        >
                        <ul class="divide-y divide-theme-muted/25">
                            {#each loosies as song (song.id)}
                                {@render row(song, isNewTrack(song, browsing, today))}
                            {/each}
                        </ul>
                    {/if}
                {:else}
                    <ul class="divide-y divide-theme-muted/25">
                        {#each ordered as song (song.id)}
                            {@render row(song, isNewTrack(song, browsing, today))}
                        {/each}
                    </ul>
                {/if}
            </div>
        {/if}
    </div>
</Modal>

<style>
    /* No Tailwind utility reaches ::-webkit-scrollbar, so this is plain CSS.
       Thin and near-invisible at rest, closer to the browser's own subtle
       overlay style, rather than the bulky default track+thumb */
    .catalog-scroll {
        scrollbar-width: thin;
        scrollbar-color: var(--muted-color) transparent;
    }
    .catalog-scroll::-webkit-scrollbar {
        width: 8px;
    }
    .catalog-scroll::-webkit-scrollbar-track {
        background: transparent;
    }
    .catalog-scroll::-webkit-scrollbar-thumb {
        background-color: color-mix(in srgb, var(--muted-color) 40%, transparent);
        border-radius: 9999px;
    }
    .catalog-scroll:hover::-webkit-scrollbar-thumb {
        background-color: color-mix(in srgb, var(--muted-color) 70%, transparent);
    }
</style>
