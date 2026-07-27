<script lang="ts">
    import { page } from '$app/state';
    import { NAME, siteName } from '$lib/statics';

    // The wordmark upstream shipped was the word "underscordle" converted to
    // vector outlines, so its letters could not be edited. This renders the site
    // name as text in Poppins, which the app already loads, and reads the name
    // from statics so there is one source of truth. Swap back to an inline
    // <svg> here if a designed wordmark ever replaces it.
    const { class: className = '' } = $props();

    // Resolved server-side from the alias cookie, so the easter egg is already in
    // the SSR'd HTML. Falls back to the plain name when there is no layout data
    // to read, which is the case on the error page. See siteName() in
    // $lib/statics.
    const name = $derived(siteName(!!page.data.viaAlias));

    // Sized here rather than by the caller, because the size depends on which
    // name is being rendered. Base case matches the outlined wordmark this
    // replaced: that SVG rendered at h-10 / sm:h-15, so its glyphs were 40px and
    // 60px tall, and Poppins caps are roughly 0.72em -- hence 56px / 84px.
    //
    // The janedle alias is 17 characters against removedle's 9 and overflows the
    // 800px container at the full size, so it steps down a notch and is allowed
    // to wrap. On a phone it breaks between the two words, which is why the
    // leading is tightened there instead of left at leading-none.
    const size = $derived(
        name === NAME
            ? 'text-[3.5rem] leading-none sm:text-[5.25rem]'
            : 'text-[2.5rem] leading-[0.95] sm:text-[4rem]'
    );
</script>

<span class={`block text-center font-bold tracking-wide select-none ${size} ${className}`}
    >{name}</span
>
