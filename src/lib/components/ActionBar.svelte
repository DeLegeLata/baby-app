<script lang="ts">
  // The buttons follow where he is: up, settling, asleep, or awake in the night.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { dateKey, minutesOf } from '../time';

  const cur = $derived(app.current);
  const morning = $derived.by(() => {
    const tz = app.settings.time_zone;
    const min = minutesOf(dateKey(app.now, tz), app.now, tz);
    return min >= 5 * 60 && min < 12 * 60;
  });
</script>

<nav class="actions no-print" aria-label="Log sleep">
  {#if app.phase === 'awake'}
    <!-- Put to bed: into the crib, not asleep yet. Fell asleep: asleep now (the car, the stroller). -->
    <button class="primary" onclick={() => app.putToBed()}>Put to bed</button>
    <button onclick={() => (ui.asleep = true)}>Fell asleep</button>
  {:else if app.phase === 'in_bed'}
    <button class="primary" onclick={() => app.fellAsleep()}>Fell asleep</button>
    <button onclick={() => app.notSleeping()}>Not sleeping</button>
  {:else if cur && cur.kind !== 'night'}
    <button class="primary" onclick={() => app.wokeUp()}>Awake</button>
  {:else if app.phase === 'waking'}
    <button class="primary" onclick={() => app.backAsleep()}>Back asleep</button>
    <button onclick={() => app.upForTheDay()}>Up for the day</button>
  {:else}
    <button class={morning ? '' : 'primary'} onclick={() => app.wokeUp()}>Woke up</button>
    <button class={morning ? 'primary' : ''} onclick={() => app.upForTheDay()}>Up for the day</button>
  {/if}
</nav>
