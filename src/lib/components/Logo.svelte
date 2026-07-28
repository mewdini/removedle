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
    // name is being rendered. Royal2's cap height is 810/1000 units, so 74px
    // lands the caps on the 60px of the outlined wordmark this replaced -- a
    // smaller font-size than Poppins needed (0.72em caps) for the same letters
    // on screen. At 74px the word measures 597px inside a 784px container.
    //
    // The base size is NOT the matching 49px, because Royal2 sets much wider
    // than Poppins: 'removedle' is 404px there against the 359px a 375px phone
    // actually has, and a single word cannot wrap, so it would scroll the whole
    // page sideways. 41.6px brings it to 339px and fits the narrower 360px
    // phones too. Re-measure this if the name or the tracking ever changes.
    //
    // The janedle alias is 17 characters against removedle's 9 and overflows the
    // 800px container at the full size, so it steps down a notch and wraps onto
    // two lines.
    //
    // Its leading is 1.15 rather than the 0.95 that suited Poppins, because in
    // Royal2 the two lines collide. Measured off the rendered ink: JANEDLE drops
    // 0.11em below its baseline (the J's tail, the E's swash) and REMOVEDLE
    // rises 0.81em above its own, so the lines touch outright at 0.92 and 0.95
    // left 1.7px of clearance. Poppins caps have no descender to speak of, so
    // the same 0.95 gave it 0.23em of air; 1.15 buys Royal2 that back. Derive it
    // again from the ink, not from the em box, if the face ever changes.
    const size = $derived(
        name === NAME
            ? 'text-[2.6rem] leading-none sm:text-[4.65rem]'
            : 'text-[2.2rem] leading-[1.15] sm:text-[3.55rem]'
    );
</script>

<!-- uppercase is not styling, it is a requirement: Royal2 draws A-Z and nothing
     else, so the untransformed name would render entirely in the fallback serif
     and look like the swap never happened. It only stays safe because both NAME
     and ALT_NAME are pure letters -- a name with a digit or an apostrophe in it
     would come out with invisible holes. See the note in layout.css.
     No font-bold either -- the face ships a single weight and the browser would
     synthesise one, which thickens the strokes unevenly. -->
<span
    class={`block text-center [font-family:'Royal2',sans-serif] tracking-wide uppercase select-none ${size} ${className}`}
    >{name}</span
>
