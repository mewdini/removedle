<script lang="ts">
    import { fly } from 'svelte/transition';

    // `maxWidth` and `bodyClass` exist for the catalog, which is a long scrolling
    // list rather than the short centred blurb every other modal holds: it needs
    // the room, and centring a tracklist reads as a poem. Both default to what
    // the existing modals already had, so nothing else changes.
    const {
        children,
        revealed,
        onClose,
        maxWidth = 'max-w-md',
        bodyClass = 'p-6 text-center',
    } = $props();
</script>

{#if revealed}
    <div
        transition:fly={{ y: 10, duration: 250 }}
        class="animate-fade-in animate fixed inset-0 z-50 flex h-dvh items-center justify-center bg-black/65"
    >
        <!-- flex-col + max-h-[90dvh], scrolling only the inner body below, not
             this box: the close button lives out here so it can never scroll
             out of reach on a viewport short enough that the body needs to
             scroll (the catalog on a short phone screen, mainly).

             dvh, not vh: plain vh on mobile Safari sizes against the large
             viewport, as if the address bar were already collapsed, not the
             viewport actually visible while it's showing. inset-0 on this
             fixed overlay stretches to that same oversized box, so a modal
             centered and capped at 90vh could still render taller than
             what's on screen, with the close button landing above the
             visible area: reported as "cut off" on an iPhone 14. Chrome on
             iOS doesn't share the discrepancy, which is why the bug never
             reproduced there. dvh tracks the real, current visible viewport
             as the address bar shows and hides, so both the overlay (h-dvh)
             and the box's cap need it: fixing only one still centers the
             box inside an oversized outer container -->
        <div
            class="animate-fly-fade-in relative mx-3 flex max-h-[90dvh] w-full flex-col rounded-lg border-2 border-theme-text bg-theme-bg sm:mx-0 {maxWidth}"
            style="box-shadow: 0 0 20px rgba(0,0,0,0.5);"
        >
            <button
                onclick={onClose}
                class="absolute top-2 right-2 z-10 cursor-pointer text-theme-muted transition-colors hover:text-theme-text"
                title="close"
            >
                <svg
                    class="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={2}
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            </button>
            <!-- min-h-0 overrides flexbox's default min-height:auto, which
                 would otherwise let this child grow past the parent's
                 max-h-[90dvh] instead of scrolling -->
            <div class="min-h-0 overflow-y-auto {bodyClass}">
                {@render children()}
            </div>
        </div>
    </div>
{/if}
