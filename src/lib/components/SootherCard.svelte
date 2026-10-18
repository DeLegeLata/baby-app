<script lang="ts">
  // The soother in the day, its last week, and the weaning plan (research/10).
  // Only a parent moves the plan on; the card says when the next stage fits.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clockAt, dayLabel, dur, tidy } from '../format';
  import { WEAN_STAGES, sessions } from '../habits';

  const tz = $derived(app.settings.time_zone);
  const day = $derived(app.soother);
  const wean = $derived(app.wean);
  const recent = $derived(sessions(app.habits, 'soother').reverse().slice(0, 8));
  const length = (start: string, end: string | null) => dur(((end ? Date.parse(end) : app.now) - Date.parse(start)) / 60_000);
  let stopping = $state(false);
</script>

<section class="card">
  <div class="spread">
    <h3>Soother</h3>
    {#if day.running}<span class="tag">In</span>{:else if wean.active}<span class="tag">Stage {wean.stage} of 4</span>{/if}
  </div>

  <ul class="reasons">
    <li>
      {#if day.running}
        {tidy(`In since ${clockAt(day.running.start_at, tz)}.`)} {dur(day.dayMin)} in the day today.
      {:else}
        {day.dayMin >= 1 ? `${dur(day.dayMin)} in the day today.` : 'Not used in the day today.'}
      {/if}
    </li>
    {#each app.sootherWeek.lines as line}<li>{line}</li>{/each}
  </ul>
  <div class="row" style="margin-top: 10px">
    {#if day.running}
      <button class="primary" onclick={() => app.stopHabit('soother')}>Soother out</button>
    {:else}
      <button onclick={() => app.startHabit('soother')}>Soother in</button>
    {/if}
    <button class="ghost" onclick={() => (ui.habit = { id: null, kind: 'soother' })}>An earlier time...</button>
  </div>
  <p class="muted" style="margin: 8px 0 0">
    In and out are for the day. For sleeps, answer "With the soother" on the Today screen while he is in bed, or when
    editing a sleep. A soother still in when he goes down stops here and counts for that sleep.
  </p>

  {#if recent.length}
    <details>
      <summary>Recent daytime use</summary>
      <ul class="sleeps">
        {#each recent as s (s.id)}
          <li>
            <span class="what">
              {dayLabel(s.start_at, tz)}, {clockAt(s.start_at, tz)}{s.end_at ? ` to ${clockAt(s.end_at, tz)}` : ', still in'}
              <span class="muted"> · {length(s.start_at, s.end_at)}</span>
            </span>
            <button class="ghost" onclick={() => (ui.habit = { id: s.id, kind: 'soother' })}>Edit</button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}

  <h3 style="margin-top: 14px">Weaning plan</h3>
  {#if !wean.active}
    <p class="muted" style="margin: 6px 0 0">
      Four stages, about a week or two each: sleep and comfort only, then sleeps only, then night only, then gone. You
      move it on; the app says when a stage has held for a week.
    </p>
    <ul class="reasons">
      {#each wean.lines as line}<li>{line}</li>{/each}
    </ul>
    <button class="primary" style="margin-top: 8px" onclick={() => app.setWeanStage(1)}>Start the plan</button>
  {:else}
    <ul class="reasons">
      {#each wean.lines as line}<li>{line}</li>{/each}
    </ul>
    <div class="row" style="margin-top: 10px">
      {#if wean.stage < 4}
        <button class={wean.suggestNext ? 'primary' : ''} onclick={() => app.setWeanStage(wean.stage + 1)}>
          Move to stage {wean.stage + 1}
        </button>
      {/if}
      {#if wean.stage > 1}
        <button class="ghost" onclick={() => app.setWeanStage(wean.stage - 1)}>Back to stage {wean.stage - 1}</button>
      {/if}
    </div>
    <div class="row" style="margin-top: 8px">
      {#if stopping}
        <button style="color: var(--alarm)" onclick={() => { stopping = false; app.setWeanStage(0); }}>Really stop the plan</button>
        <button class="ghost" onclick={() => (stopping = false)}>Keep it</button>
      {:else}
        <button class="ghost" onclick={() => (stopping = true)}>Stop the plan</button>
      {/if}
    </div>
  {/if}

  <details>
    <summary>The four stages</summary>
    <ol>
      {#each WEAN_STAGES as s}
        <li><b>{s.name}.</b> {s.allowed}. A day counts as kept when {s.rule}.</li>
      {/each}
    </ol>
    <p class="muted">
      From the Canadian Paediatric Society: keep it to sleep and comfort, involve him when it goes (the soother fairy),
      praise and cuddle, and don't give it back once it is gone. Tell daycare which stage you are on.
    </p>
  </details>
</section>
