<script lang="ts">
    import icon128 from '$lib/assets/favicon-128x128.png';
    import { resolve } from '$app/paths';
    import {
        ArchiveOutline,
        CogOutline,
        ExclamationCircleOutline,
        GithubSolid,
        QuestionCircleOutline,
    } from 'flowbite-svelte-icons';
    import Modal from './Modal.svelte';
    import Logo from './Logo.svelte';
    import StreamingLinks from './game/StreamingLinks.svelte';
    import { themes } from '$lib/themes';
    import { page } from '$app/state';
    import { MODE_LIST, modeParam, resolveMode, type ModeConfig } from '$lib/modes';

    let {
        volume = $bindable(),
        theme = $bindable(),
        firstTimeHelp = $bindable(),
        saveSettings,
    } = $props();
    let showHelpModal = $state(false);
    let showSettingsModal = $state(false);
    let inputVolume = $derived(volume);

    $effect(() => {
        if (firstTimeHelp) {
            showHelpModal = true;
        }
    });

    function setVolume(value: number) {
        inputVolume = value;
        volume = value;
    }

    const currentMode = $derived(resolveMode(page.data.mode));
    // Resolved server-side (see loadBlurbLinks) because the quoted track is an
    // official release, so it is not in challenger's own catalog.
    const blurbLinks = $derived(page.data.blurbLinks ?? {});
    const hasBlurbLinks = $derived(
        Object.values(blurbLinks).some((v: unknown) => typeof v === 'string' && v.trim())
    );
    // Hover stays in CSS; this is only the tap path. A CSS-only group-hover reveal
    // (what the 404 citation does) leaves the links permanently unreachable on a
    // phone, since there is no hover and tapping a span focuses nothing.
    let blurbToggled = $state(false);

    // The mode switcher is navigation, not a setting: the URL is the source of
    // truth, so these are plain anchors that work without JS and stay on the
    // equivalent page. Switching from a dated game keeps the date, so you can
    // compare the same day across modes.
    function modeHref(target: ModeConfig) {
        const mode = modeParam(target);

        switch (page.route.id) {
            case '/[[mode=mode]]/[date=date]':
                return resolve('/[[mode=mode]]/[date=date]', {
                    mode,
                    date: page.params.date!,
                });
            case '/[[mode=mode]]/archive':
                return resolve('/[[mode=mode]]/archive', { mode });
            // '/[[mode=mode]]' and the 404 page (route.id === null)
            default:
                return resolve('/[[mode=mode]]', { mode });
        }
    }
</script>

<div class="flex w-full flex-col items-center justify-center gap-2 pt-4 align-middle">
    <!-- The type scale lives in Logo.svelte, which varies it by which name it is
         rendering (the janedle alias is nearly twice as long). -->
    <Logo class="text-theme-text" />
    <!-- The byline belongs to the wordmark, not to the tagline: under the tagline
         it sat directly beneath the song citation and read as a credit for the
         song itself. -->
    <p class="text-sm text-theme-text">by mewdini</p>
    <span class="px-4 text-center">
        <!-- The citation runs on from the quote rather than taking a line of its
             own, to keep the header stack short. A span rather than a p because
             StreamingLinks renders a div, and the parser closes a p on one. -->
        <span class="block text-lg text-theme-text">
            {currentMode.blurb}
            {#if currentMode.blurbSong}
                <span class="group inline-block align-middle text-xs text-theme-muted italic">
                    {#if hasBlurbLinks}
                        <button
                            type="button"
                            class="cursor-pointer italic underline decoration-dotted underline-offset-2"
                            aria-expanded={blurbToggled}
                            onclick={() => (blurbToggled = !blurbToggled)}
                            >from “{currentMode.blurbSong}”</button
                        >
                        <!-- Expands in flow, same as the 404 citation. Floating it
                             over the header instead would drop the links onto the
                             mode toggle sitting right below. Focus is scoped to the
                             links rather than the whole group, or focusing the
                             button would hold it open and break the second tap. -->
                        <span
                            class="block overflow-hidden transition-all duration-200 group-hover:mt-1 group-hover:max-h-8 group-hover:opacity-100 has-[a:focus]:mt-1 has-[a:focus]:max-h-8 has-[a:focus]:opacity-100 {blurbToggled
                                ? 'mt-1 max-h-8 opacity-100'
                                : 'max-h-0 opacity-0'}"
                        >
                            <StreamingLinks links={blurbLinks} inGame={false} />
                        </span>
                    {:else}
                        from “{currentMode.blurbSong}”
                    {/if}
                </span>
            {/if}
        </span>
    </span>
    <div class="flex flex-row items-center gap-2 text-theme-text">
        <span class="flex items-center transition-all hover:scale-105 active:scale-95"
            ><a href={resolve('/[[mode=mode]]/archive', { mode: modeParam(currentMode) })}
                ><ArchiveOutline class="h-8 w-8 shrink-0" /></a
            ></span
        >
        <span class="flex items-center transition-all hover:scale-105 active:scale-95"
            ><button
                onclick={() => {
                    showHelpModal = true;
                }}><QuestionCircleOutline class="h-8 w-8 shrink-0 cursor-pointer" /></button
            ></span
        >
        <span class="flex items-center transition-all hover:scale-105 active:scale-95"
            ><button
                onclick={() => {
                    showSettingsModal = true;
                }}><CogOutline class="h-8 w-8 shrink-0 cursor-pointer" /></button
            ></span
        >
        <span class="flex items-center transition-all hover:scale-105 active:scale-95"
            ><a href="https://github.com/mewdini/removedle" target="_blank" rel="noreferrer"
                ><GithubSolid class="h-8 w-8 shrink-0" /></a
            ></span
        >
    </div>
    <hr class="h-3 w-full max-w-[280px] border-theme-muted sm:max-w-sm" />
</div>

<Modal
    revealed={showHelpModal}
    onClose={() => {
        showHelpModal = false;
        if (firstTimeHelp) {
            firstTimeHelp = false;
            saveSettings();
        }
    }}
>
    <div class="flex flex-col items-center gap-3">
        <span class="text-xl font-bold text-theme-text">How to Play:</span>
        <ul class="list-outside list-disc space-y-2 pl-4 text-left text-theme-text">
            <li>Each day you will have 5 songs to guess, with 3 guesses each.</li>
            <li>Click the play button to hear the clue and type in the box to make your guess.</li>
            <li>Feel free to come back later, progress is always saved.</li>
        </ul>
        <hr class="h-3 w-full max-w-[280px] border-theme-muted sm:max-w-sm" />
        <span class="text-xl font-bold text-theme-text">Credits</span>
        <div class="flex flex-col items-center justify-center">
            <img src={icon128} alt="removedle icon" class="h-[100px] rounded-xl" />
            <p class="text-theme-text">
                Icon sourced from <a
                    class="hover:underline"
                    target="_blank"
                    href="https://www.nts.live/shows/deadair-transmissions/episodes/deadair-transmissions-15th-august-2025"
                    >deadAir - Transmissions w/ Jane Remover</a
                >
            </p>
        </div>
        <p class="text-theme-text">
            <b>removedle</b> is a fork of
            <a
                class="hover:underline"
                target="_blank"
                rel="noopener noreferrer"
                href="https://github.com/angelolz/underscordle"><i>underscordle</i></a
            >
            by
            <a
                class="hover:underline"
                target="_blank"
                rel="noopener noreferrer"
                href="https://github.com/angelolz">angelolz</a
            >.
        </p>
    </div>
</Modal>

<Modal
    revealed={showSettingsModal}
    onClose={() => {
        showSettingsModal = false;
    }}
>
    <div class="flex flex-col gap-4 text-theme-text">
        <span class="text-xl font-bold">Settings</span>

        <div class="flex flex-col gap-2">
            <span class="text-sm font-bold">Game mode</span>
            <!-- Sits with the settings but is not one: these stay plain anchors
                 so the URL remains the source of truth, which means picking a
                 mode navigates and closes the modal with it. -->
            <nav
                aria-label="Game mode"
                class="flex flex-row gap-0.5 self-center rounded-full border border-theme-muted p-0.5"
            >
                {#each MODE_LIST as m (m.id)}
                    <a
                        href={modeHref(m)}
                        aria-current={m.id === currentMode.id ? 'page' : undefined}
                        class="rounded-full px-4 py-1 text-sm font-bold transition-all active:scale-95 {m.id ===
                        currentMode.id
                            ? 'bg-theme-accent text-theme-text'
                            : 'text-theme-muted hover:text-theme-text'}">{m.label}</a
                    >
                {/each}
            </nav>
        </div>

        <div class="flex flex-col gap-2">
            <label for="theme-select" class="text-sm font-bold">Theme</label>
            <select
                id="theme-select"
                class="w-full rounded-lg border border-theme-text bg-theme-bg p-2 text-sm text-theme-text outline-none focus:ring-2 focus:ring-theme-accent"
                bind:value={theme}
                onchange={saveSettings}
            >
                {#each Object.keys(themes) as t (t)}
                    <option value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                {/each}
            </select>
        </div>

        <div class="flex flex-col items-center justify-around gap-2 align-middle">
            <span class="flex w-full flex-row gap-1 text-sm font-bold">
                <p>Volume: <b>{inputVolume}%</b></p>
                {#if inputVolume > 35}
                    <span
                        class="flex flex-row items-center justify-between gap-1 text-[10px] text-red-500"
                    >
                        <ExclamationCircleOutline class="h-4 w-4 shrink-0" /> This may be too loud, please
                        take caution.
                    </span>
                {/if}
            </span>
            <input
                class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-theme-accent accent-theme-text"
                type="range"
                name="volume"
                aria-label="Volume"
                min="1"
                max="100"
                value={inputVolume}
                oninput={(e) => {
                    setVolume(Number(e.currentTarget.value));
                }}
                onchange={() => {
                    saveSettings();
                }}
            />
        </div>
    </div>
</Modal>
