<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { secondsUntilReset } from '$params/date';

    // Purely a display. It must NOT navigate or invalidate when it reaches zero:
    // it renders inside Results, which the Board's toggle can open mid-game, so a
    // refresh fired from here would yank a board out from under a player. The
    // rollover is handled in Game.svelte, which can see the game state.
    let timeLeft = $state(format(secondsUntilReset()));
    let timer: ReturnType<typeof setInterval> | null = null;

    onMount(() => {
        timer = setInterval(() => {
            timeLeft = format(secondsUntilReset());
        }, 1000);
    });

    onDestroy(() => {
        if (timer) {
            clearInterval(timer);
        }
    });

    // Seconds until the next 21:00 Pacific, as HH:MM:SS. The Pacific arithmetic
    // lives in secondsUntilReset so this agrees with getGameDate by construction
    // rather than being a second, separately-maintained copy of it -- which is
    // how this component came to count down to UTC midnight while the game rolled
    // over on Pacific time.
    function format(total: number) {
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const seconds = total % 60;

        return [hours, minutes, seconds].map((n) => n.toString().padStart(2, '0')).join(':');
    }
</script>

<div class="flex flex-col items-center gap-2">
    <p class="text-sm text-theme-text uppercase">Next Challenge</p>
    <div class="flex min-w-[50px] flex-col text-center">
        <span class="text-2xl font-bold">{timeLeft}</span>
        <span class="text-sm whitespace-nowrap uppercase opacity-50">Remaining</span>
    </div>
</div>
