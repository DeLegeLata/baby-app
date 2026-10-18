<script lang="ts">
  // Today's screens against the Canadian Paediatric Society guide: under 1 hour
  // a day, and none in the hour before bed (research/10).
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clockAt, dayLabel, dur } from '../format';
  import { sessions } from '../habits';

  const tz = $derived(app.settings.time_zone);
  const screen = $derived(app.screen);
  const recent = $derived(sessions(app.habits, 'screen').reverse().slice(0, 8));
  const length = (start: string, end: string | null) => dur(((end ? Date.parse(end) : app.now) - Date.parse(start)) / 60_000);
</script>

<section class="card">
  <div class="spread">
    <h3>Screens</h3>
    {#if screen.running}<span class="tag">On</span>{:else if screen.over}<span class="tag">Over 1 h</span>{/if}
  </div>
  <ul class="reasons">
    {#each screen.lines as line}<li>{line}</li>{/each}
  </ul>
  <div class="row" style="margin-top: 10px">
    {#if screen.running}
      <button class="primary" onclick={() => app.stopHabit('screen')}>Screen off</button>
    {:else}
      <button onclick={() => app.startHabit('screen')}>Screen on</button>
    {/if}
    <button class="ghost" onclick={() => (ui.habit = { id: null, kind: 'screen' })}>An earlier screen...</button>
  </div>

  {#if recent.length}
    <details>
      <summary>Recent screens</summary>
      <ul class="sleeps">
        {#each recent as s (s.id)}
          <li>
            <span class="what">
              {dayLabel(s.start_at, tz)}, {clockAt(s.start_at, tz)}{s.end_at ? ` to ${clockAt(s.end_at, tz)}` : ', still on'}
              <span class="muted"> · {length(s.start_at, s.end_at)}</span>
            </span>
            <button class="ghost" onclick={() => (ui.habit = { id: s.id, kind: 'screen' })}>Edit</button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  <p class="muted" style="margin: 8px 0 0">
    The Canadian Paediatric Society suggests under 1 hour a day for ages 2 to 5, and none in the hour before bed. A
    screen still on when he goes to bed stops then.
  </p>
</section>
