<script lang="ts">
    import { resolve } from '$app/paths';
    import { AngleLeftOutline } from 'flowbite-svelte-icons';
    import StreamingLinks from './game/StreamingLinks.svelte';

    const { data } = $props();
    const errorLine = $derived(data.errorLine);
    const links = $derived(errorLine?.links ?? {});
    const hasLinks = $derived(Object.values(links).some((v) => typeof v === 'string' && v.trim()));
</script>

<div class="my-5 flex justify-center text-white">
    <div class="w-[300px] rounded-xl border border-white p-2 text-center">
        <p class="text-lg font-bold">{errorLine?.line}</p>
        {#if errorLine?.song}
            <div class="group flex flex-col items-center">
                <span class="text-xs text-white/70 italic">from “{errorLine.song}”</span>
                {#if hasLinks}
                    <div
                        class="max-h-0 overflow-hidden text-white opacity-0 transition-all duration-200 group-focus-within:mt-1 group-focus-within:max-h-8 group-focus-within:opacity-100 group-hover:mt-1 group-hover:max-h-8 group-hover:opacity-100"
                    >
                        <StreamingLinks {links} inGame={false} />
                    </div>
                {/if}
            </div>
        {/if}
        <p class="mt-1 text-sm">Can't find what you're looking for!</p>
        <!-- white/70 rather than theme-muted: this card sets its own palette so it
             reads the same whichever theme the 404 is hit under. -->
        <a class="my-2 inline-flex items-center gap-2 text-white/70" href={resolve('/')}>
            <AngleLeftOutline class="h-4 w-4 shrink-0" />
            <span class="underline decoration-dotted underline-offset-2">Go Home</span>
        </a>
    </div>
</div>
