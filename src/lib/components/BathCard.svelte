<script lang="ts">
  // When he last had a bath, and whether one is due by the interval in Settings.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clock12, clockAt, dayLabel } from '../format';
  import { parseClock } from '../time';

  const tz = $derived(app.settings.time_zone);
  const bath = $derived(app.bath);
  const remindAt = $derived(app.settings.bath_remind_at);
</script>

<section class="card">
  <div class="spread">
    <h3>Bath</h3>
    {#if bath.due}<span class="tag">Due</span>{/if}
  </div>
  <p class="muted" style="margin: 6px 0 10px">{bath.line}</p>
  <div class="row">
    <button class={bath.due ? 'primary' : ''} onclick={() => app.logBath()}>Bath done</button>
    <button class="ghost" onclick={() => (ui.bath = { id: null })}>An earlier bath...</button>
  </div>

  {#if bath.events.length}
    <details>
      <summary>Recent baths</summary>
      <ul class="sleeps">
        {#each bath.events.slice(0, 8) as event (event.id)}
          <li>
            <span class="what">
              {dayLabel(event.at, tz)}, {clockAt(event.at, tz)}
              {#if event.source === 'routine'}<span class="muted"> · in the bedtime routine</span>{/if}
            </span>
            <button
              class="ghost"
              onclick={() => (event.source === 'log' ? (ui.bath = { id: event.id }) : ui.editSleep(event.id))}
            >
              Edit
            </button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  <p class="muted" style="margin: 8px 0 0">
    One every {app.settings.bath_every_days}
    {app.settings.bath_every_days === 1 ? 'day' : 'days'}{remindAt
      ? `, with a reminder at ${clock12(parseClock(remindAt))} on the day one is due`
      : ''}. Change this in Settings.
  </p>
</section>
