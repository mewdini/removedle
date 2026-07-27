<script lang="ts">
    import { fly } from 'svelte/transition';
    import AlbumArt from './AlbumArt.svelte';
    // `open` stays true from the moment the dropdown first appears for a guess
    // until that guess is answered -- not just while there are results. The outer
    // element reserves the dropdown's height (`minH`, latched to the tallest the
    // list has been) the whole time, so the page grows only once, when you first
    // start typing. After that, deleting/retyping doesn't change the page height,
    // so iOS stops re-scrolling the view up and down on every keystroke.
    let { results, suggestionIndex, submitGuess, open = false } = $props();

    let contentH = $state(0);
    let minH = $state(0);

    $effect(() => {
        if (contentH > minH) minH = contentH;
    });
    $effect(() => {
        if (!open) minH = 0;
    });
</script>

{#if open}
    <div
        style:min-height={`${minH}px`}
        class="pointer-events-none absolute top-full left-0 z-100 mt-2 w-full"
    >
        {#if results.length > 0}
            <div
                transition:fly={{ y: 10, duration: 250 }}
                bind:clientHeight={contentH}
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
