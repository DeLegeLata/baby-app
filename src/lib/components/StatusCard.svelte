<script lang="ts">
  // Where he is now, and the next thing to do: tonight's bedtime while he is
  // up, the morning wake while a night is running. Every recommendation can be
  // opened up to show why the app chose it.
  import { app } from '../state.svelte';
  import { clockAt, dur, since, tidy } from '../format';
  import { KIND_LABEL, MOODS, MOOD_LABEL, SLEEP_KINDS } from '../model';
  import { netSleepMinutes, wakingMinutes } from '../engine';

  const tz = $derived(app.settings.time_zone);
  const at = (ms: number) => clockAt(ms, tz);
  const cur = $derived(app.current);

  /** "in 1 h 25 min", "5 min ago" */
  function relative(target: number): string {
    const diff = target - app.now;
    if (Math.abs(diff) < 60_000) return 'now';
    return diff > 0 ? `in ${since(diff)}` : `${since(-diff)} ago`;
  }

  // Ask how he woke, for a quarter of an hour after a sleep ends.
  const justWoke = $derived(
    app.phase === 'awake'
      ? (app.sleeps.find(
          (s) => s.woke_at && !s.mood && app.now - Date.parse(s.woke_at) < 15 * 60_000
        ) ?? null)
      : null
  );

  const nightWakings = $derived(cur?.kind === 'night' ? cur.wakings : []);
  const openWaking = $derived(nightWakings.find((w) => !w.end) ?? null);

  const sinceLine = $derived.by(() => {
    if (!cur?.asleep_at) return '';
    let line = `Since ${at(Date.parse(cur.asleep_at))}.`;
    if (nightWakings.length) {
      const times = nightWakings.length === 1 ? 'once' : `${nightWakings.length} times`;
      line += ` Woke ${times} (${dur(wakingMinutes(cur, app.now))} awake).`;
    }
    return tidy(line);
  });
</script>

<section class="card status" aria-live="polite">
  {#if app.phase === 'awake'}
    <p class="muted">Awake</p>
    <p class="big">
      {app.lastWoke ? `Up ${since(app.now - app.lastWoke)}` : 'Up'}
    </p>
    {#if app.lastWoke}
      <p class="muted">since {at(app.lastWoke)}</p>
    {/if}
  {:else if app.phase === 'in_bed' && cur}
    <p class="muted">In bed for {KIND_LABEL[cur.kind].toLowerCase()}</p>
    <p class="big">Settling {since(app.now - Date.parse(cur.in_bed_at!))}</p>
    <p class="muted">
      {tidy(`In bed at ${at(Date.parse(cur.in_bed_at!))}.`)} He usually takes about
      {dur(app.bedtime?.learned.settle ?? app.settings.settle_min)} to fall asleep.
    </p>
  {:else if app.phase === 'waking' && cur && openWaking}
    <p class="muted">Awake in the night</p>
    <p class="big">Awake {since(app.now - Date.parse(openWaking.start))}</p>
    <p class="muted">{tidy(`Asleep since ${at(Date.parse(cur.asleep_at!))}.`)}</p>
  {:else if cur}
    <p class="muted">{cur.kind === 'night' ? 'Asleep for the night' : `${KIND_LABEL[cur.kind]}`}</p>
    <p class="big">Asleep {dur(netSleepMinutes(cur, app.now))}</p>
    <p class="muted">{sinceLine}</p>
  {/if}

  {#if cur}
    <div class="chips" style="margin-top: 8px" role="group" aria-label="Kind of sleep">
      {#each SLEEP_KINDS as kind}
        <button aria-pressed={cur.kind === kind} onclick={() => app.setKind(cur.id, kind)}>
          {KIND_LABEL[kind]}
        </button>
      {/each}
    </div>
  {/if}

  {#if justWoke}
    <p class="muted" style="margin: 12px 0 6px">How did he wake?</p>
    <div class="chips">
      {#each MOODS as mood}
        <button onclick={() => app.setMood(justWoke.id, mood)}>{MOOD_LABEL[mood]}</button>
      {/each}
    </div>
  {/if}

  {#if app.wake}
    {@const plan = app.wake}
    <p class="next">
      Wake him at <span class="when">{at(plan.wakeAt)}</span>
    </p>
    <p class="muted">
      {tidy(
        `Best between ${at(plan.windowStart)} and ${at(plan.windowEnd)}, ${relative(plan.wakeAt)}.` +
          (plan.mustBeUpAt ? ` Must be up by ${at(plan.mustBeUpAt)}.` : '')
      )}
    </p>
    <details>
      <summary>Why this time?</summary>
      <ul>
        {#each plan.reasons as reason}<li>{reason}</li>{/each}
      </ul>
    </details>
  {:else if app.bedtime}
    {@const plan = app.bedtime}
    <p class="next">
      Asleep by <span class="when">{at(plan.asleepBy)}</span>
    </p>
    <p class="muted">Window {at(plan.windowStart)} to {at(plan.windowEnd)}</p>
    <p class="muted">
      Start the routine at <b>{at(plan.routineAt)}</b> ({relative(plan.routineAt)}), in bed by
      {tidy(`${at(plan.inBedBy)}.`)}
    </p>
    {#if plan.assumptions.length}
      <ul>
        {#each plan.assumptions as note}<li>{note}</li>{/each}
      </ul>
    {/if}
    <details>
      <summary>Why this time?</summary>
      <ul>
        {#each plan.reasons as reason}<li>{reason}</li>{/each}
      </ul>
    </details>
  {/if}
</section>
