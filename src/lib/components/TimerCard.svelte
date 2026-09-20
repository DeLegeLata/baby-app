<script lang="ts">
  import { app } from '../state.svelte';
  import { since } from '../format';

  const CIRC = 2 * Math.PI * 56;

  const maxGapMs = $derived(app.settings.max_gap_min * 60_000);
  const targetMs = $derived(app.settings.target_min * 60_000);
  const elapsed = $derived(app.timer.sinceAnchorMs ?? 0);
  const fraction = $derived(Math.min(1, elapsed / maxGapMs));
  const colour = $derived(
    elapsed >= maxGapMs ? 'var(--alarm)' : elapsed >= targetMs ? 'var(--warn)' : 'var(--accent)'
  );
</script>

<section class="card timer">
  <svg class="ring" viewBox="0 0 132 132" aria-hidden="true">
    <circle cx="66" cy="66" r="56" fill="none" stroke="var(--line)" stroke-width="11" />
    <circle
      cx="66"
      cy="66"
      r="56"
      fill="none"
      stroke={colour}
      stroke-width="11"
      stroke-linecap="round"
      stroke-dasharray={CIRC}
      stroke-dashoffset={CIRC * (1 - fraction)}
      transform="rotate(-90 66 66)"
    />
    <text class="big" x="66" y="64" text-anchor="middle">
      {app.timer.anchorAt === null ? '--' : since(elapsed)}
    </text>
    <text class="small" x="66" y="84" text-anchor="middle">since feed start</text>
  </svg>

  <div>
    {#if app.timer.anchorAt === null}
      <h2>No feeds yet</h2>
      <p class="muted">Start one below and the timer counts from its start.</p>
    {:else}
      <h2>Feed due in {since(Math.max(0, (app.timer.targetAt ?? 0) - app.now))}</h2>
      <p class="muted">
        {#if app.timer.running}
          Feeding now{app.timer.stillFeeding ? ' - still feeding?' : ''}
        {:else}
          ended {since(app.timer.endedAgoMs)}{(app.timer.endedAgoMs ?? 0) < 60_000 ? '' : ' ago'}
        {/if}
      </p>
      {#if app.timer.maxGapAt !== null}
        <p class="muted" class:flag={app.now >= app.timer.maxGapAt}>
          {app.now >= app.timer.maxGapAt
            ? 'Past the wake-to-feed gap'
            : `Wake to feed in ${since(app.timer.maxGapAt - app.now)}`}
        </p>
      {:else}
        <p class="muted">Back to birth weight: no wake-to-feed alert.</p>
      {/if}
    {/if}
  </div>
</section>
