<script lang="ts">
    import { fly } from 'svelte/transition';
    import AlbumArt from './AlbumArt.svelte';
    import { MAX_SEARCH_RESULTS } from '$lib/statics';
    // `open` stays true from the moment the dropdown first appears for a guess
    // until that guess is answered, not just while there are results, so its
    // reserved space isn't released mid-typing
    //
    // The reserved height is measured from the hidden row-height probe below,
    // then multiplied out to the worst case (MAX_SEARCH_RESULTS rows), rather
    // than from the real list's own rendered height. Measuring the real list
    // meant the reserved space only grew to match AFTER the browser had
    // already laid out a taller box for one frame
    // That one frame was enough for iOS to scroll the page to keep the
    // focused input in view, which is exactly what this component exists to
    // prevent. The probe is mounted unconditionally, not just while open, so
    // its height is already known by the time the dropdown opens for the
    // first time
    let { results, suggestionIndex, submitGuess, open = false } = $props();

    let rowHeight = $state(0);
    const reservedHeight = $derived(rowHeight * MAX_SEARCH_RESULTS);
</script>

<!-- Same padding/height classes as a real row below, sized for measurement
     only: invisible, pulled out of flow, and never receives pointer events -->
<div
    bind:clientHeight={rowHeight}
    aria-hidden="true"
    class="invisible absolute flex w-full flex-row items-center gap-2 px-2 py-1"
>
    <div class="h-[28px] w-[28px] shrink-0 sm:h-[24px] sm:w-[24px]"></div>
</div>

{#if open}
    <div
        style:min-height={`${reservedHeight}px`}
        class="pointer-events-none absolute top-full left-0 z-100 mt-2 w-full"
    >
        {#if results.length > 0}
            <div
                transition:fly={{ y: 10, duration: 250 }}
                class="pointer-events-auto flex w-full flex-col overflow-hidden rounded-md border border-theme-text bg-theme-bg"
            >
                {#each results as result, i (result.id)}
                    <button
                        class={`text-theme-text ${i === suggestionIndex ? 'font-bold' : ''} px-2 py-1 text-left text-[14px] hover:font-bold sm:text-[12px] ${i === suggestionIndex ? 'bg-theme-accent text-white' : ''} flex w-full flex-row items-center gap-2 transition-colors hover:bg-theme-accent hover:text-white`}
                        onclick={() => {
                            submitGuess(result.title, result.id);
                        }}
                    >
                        <AlbumArt
                            albumName={result?.album}
                            class="h-[28px] rounded-md sm:h-[24px]"
                        />
                        {result.title}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
{/if}
