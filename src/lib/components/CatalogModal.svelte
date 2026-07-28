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
        releaseKey,
        releaseYear,
        type CatalogFlag,
    } from '$lib/catalog';
    import { getGameDate } from '$params/date';
    import Modal from './Modal.svelte';
    import AlbumArtComponent from './game/AlbumArt.svelte';
    import StreamingLinks from './game/StreamingLinks.svelte';

    type Catalog = { songList: Song[]; albums: AlbumArt[] };

    const { revealed, onClose } = $props();

    // The mode being PLAYED, which is not necessarily the one being browsed.
    const pageMode = $derived(resolveMode(page.data.mode));
    // The live game day, which the NEW/UPDATED badge window is measured against.
    // Same reckoning the pipeline stamps addedAt/updatedAt with, so a song
    // published in the evening is not immediately described as "yesterday".
    const today = getGameDate();

    type SortKey = 'title' | 'album' | 'release' | 'recent';

    // Four pills rather than a <select>: at these labels the row is ~230px wide,
    // which still clears the narrowest case (a 320px viewport gives the modal
    // body 264px, after mx-3 and p-4), and on mobile it sits on its own line
    // under the search box. Labels are kept to one short word for that budget.
    //
    // "Updated", not "Newest": there are two different dates on this screen and
    // "Newest" names neither of them unambiguously -- next to a "Year" pill it
    // reads as "the newest MUSIC", which is what Year already does. These two
    // sorts genuinely disagree (a 2018 demo added last week is the oldest track
    // and the newest entry), so the labels have to say which date they mean.
    // Each pill also carries a title attribute spelling it out in full.
    const SORTS = [
        ['title', 'A-Z', 'Sort by title'],
        ['album', 'Album', 'Sort by album, then by title within it'],
        ['release', 'Year', 'Sort by release date, newest music first'],
        ['recent', 'Updated', 'Sort by what was most recently added to or changed in the catalog'],
    ] as const satisfies readonly (readonly [SortKey, string, string])[];

    let browsingId = $state<ModeId>(MODES.normal.id);
    let query = $state('');
    let sort = $state<SortKey>('title');
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

    const byTitle = (a: Song, b: Song) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });

    // Every ordering falls back to title, so rows that tie -- two tracks off the
    // same album, or two loosies from the same year -- keep a stable, readable
    // order instead of whatever the input array happened to hold.
    const ordered = $derived(
        [...matches].sort((a, b) => {
            switch (sort) {
                case 'album':
                    // Under challenger's singlesAsOwnAlbum every loosie is its own
                    // one-track "album" named after the track, so this degenerates
                    // to a title sort over there. That is the honest answer for a
                    // catalog with no albums in it, not a case to special-case.
                    return (
                        a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }) ||
                        byTitle(a, b)
                    );
                case 'release': {
                    // Newest release first, matching the direction of "Updated".
                    // Tracks with no date go to the END: an empty sort key would
                    // otherwise lead the list, and 9 blank rows above everything
                    // reads as a bug rather than as missing metadata.
                    const ka = releaseKey(a);
                    const kb = releaseKey(b);
                    if (!ka || !kb) return ka === kb ? byTitle(a, b) : ka ? -1 : 1;
                    return kb.localeCompare(ka) || byTitle(a, b);
                }
                case 'recent':
                    return lastTouched(b).localeCompare(lastTouched(a)) || byTitle(a, b);
                default:
                    return byTitle(a, b);
            }
        })
    );

    // The changelist is a shortcut to the top of a list that does not otherwise
    // surface recent changes -- A-Z, album and release order all scatter them.
    // Under "Updated" the list already leads with the same tracks, so repeating
    // them would only push the catalog down the page.
    const showRecent = $derived(sort !== 'recent' && !query.trim() && flagged.length > 0);

    function albumOf(song: Song) {
        return albums.find((a: AlbumArt) => a.name === song.album);
    }

    /**
     * The "artist · album · year" line under a title, as the segments that
     * actually have something to say.
     *
     * The artist is dropped when the track is credited solely to the mode's
     * primary artist, which is almost all of them: this is a game about one
     * artist, so "Jane Remover" on every row is the least informative thing on
     * the screen and it pushes the album and year along. It reappears the moment
     * a track credits somebody else -- "Jane Remover, Lucy Bedroque" -- which is
     * the only time the field tells you anything. Compared case-insensitively
     * and trimmed, so a stray tag variant does not resurrect it on one row.
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
                {#if flag}
                    {@render badge(flag, flagDate(song, flag))}
                {/if}
            </div>
            <!-- Built as parts and joined, rather than as inline {#if}s around a
                 literal separator. Every segment here is optional now -- the
                 artist is omitted on the ~135 tracks credited solely to the
                 primary artist, the album on a one-track "album", the year on a
                 master with no date tag -- and hand-placed separators would
                 leave a leading "· Teen Week" the moment the first one dropped.

                 Non-breaking spaces around the dot, not plain ones: Svelte trims
                 whitespace at the start of a block, so a literal space there
                 disappears and it renders "Jane Remover· Teen Week". They also
                 keep the dot from wrapping onto a line of its own. The album
                 keeps its italics, so the parts are rendered rather than joined
                 into one string. -->
            <span class="text-[11px] text-theme-muted">
                {#each metaParts(song, album, year) as part, i (part.key)}
                    {#if i > 0}&nbsp;·&nbsp;{/if}{#if part.key === 'album'}<span class="italic"
                            >{part.text}</span
                        >{:else}{part.text}{/if}
                {/each}
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
            <!-- Not "artist": this is a game about one artist, so offering to
                 search by it promises something the list cannot give you. The
                 second name on a challenger remix ("Charli XCX - I Finally
                 Understand (remix)") lives in the title. matchesQuery still
                 checks the artist field anyway -- see the note there. -->
            <input
                type="search"
                placeholder="Search by title or album"
                aria-label="Search the catalog by title or album"
                bind:value={query}
                class="min-w-0 flex-1 rounded-lg border border-theme-text bg-theme-bg p-2 text-sm text-theme-text outline-none focus:ring-2 focus:ring-theme-accent"
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
