<script lang="ts">
    import { NAME } from '$lib/statics';

    // The wordmark upstream shipped was the word "underscordle" converted to
    // vector outlines, so its letters could not be edited. This renders the site
    // name as text in Poppins, which the app already loads, and reads the name
    // from statics so there is one source of truth. Swap back to an inline
    // <svg> here if a designed wordmark ever replaces it.
    const { class: className = '' } = $props();
</script>

<span class={`leading-none font-bold tracking-wide select-none ${className}`}>{NAME}</span>
