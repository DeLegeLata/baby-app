<script lang="ts">
  // His weight and height against the WHO Child Growth Standards for boys, the
  // tables behind the WHO Growth Charts for Canada that his doctor uses.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { longDate } from '../format';
  import { dateKey, daysBetween } from '../time';
  import {
    WHO_LAST_DAY,
    ageLabel,
    birthKey,
    imperial,
    percentileLabel,
    readings,
    show,
    valueOf,
    type Measure,
    type Reading
  } from '../growth';
  import GrowthChart from './GrowthChart.svelte';

  const tz = $derived(app.settings.time_zone);
  const today = $derived(dateKey(app.now, tz));
  const birth = $derived(birthKey(app.child.birth_at));
  const nowDay = $derived(birth ? daysBetween(birth, today) : 0);
  const pastFive = $derived(nowDay > WHO_LAST_DAY);

  const MEASURES: { id: Measure; title: string }[] = [
    { id: 'weight', title: 'Weight' },
    { id: 'height', title: 'Height' }
  ];
  const series = $derived<Record<Measure, Reading[]>>({
    weight: readings(app.growth, birth, 'weight'),
    height: readings(app.growth, birth, 'height')
  });
  const newestFirst = $derived([...app.growth].reverse());

  const age = (date: string) => (birth ? ageLabel(birth, date) : '');

  /** The latest reading in words, and the one before it for comparison. */
  function latest(m: Measure): { main: string; before: string | null } | null {
    const list = series[m];
    const last = list.at(-1);
    if (!last) return null;
    const when = `${longDate(last.date)}${birth ? `, at ${age(last.date)}` : ''}`;
    const where = last.p === null ? '' : `: ${percentileLabel(last.p)} percentile`;
    const prev = list.at(-2);
    const before =
      prev && prev.p !== null ? `Before that, ${percentileLabel(prev.p)} at ${age(prev.date)} (${show(prev.value, m)}).` : null;
    return { main: `${show(last.value, m)} (${imperial(last.value, m)}) on ${when}${where}.`, before };
  }

  function both(row: (typeof app.growth)[number]): string {
    const parts = MEASURES.map((m) => valueOf(row, m.id))
      .map((v, i) => (v === null ? null : show(v, MEASURES[i].id)))
      .filter(Boolean);
    return parts.join(' · ');
  }
</script>

<section class="card">
  <div class="spread">
    <h3>Growth</h3>
    <button class="primary" onclick={() => (ui.growth = { id: null })}>Add a measurement</button>
  </div>
  {#if !birth}
    <p class="flag">Add his birth date in Settings to see his percentiles.</p>
    <button onclick={() => (ui.settings = true)}>Open Settings</button>
  {:else if pastFive}
    <p class="muted" style="margin: 6px 0 0">
      He is {age(today)} old. The WHO standards end at 5 years, so measurements from then on are listed without
      a percentile.
    </p>
  {:else}
    <p class="muted" style="margin: 6px 0 0">He is {age(today)} old today.</p>
  {/if}
  {#if !app.growth.length}
    <p class="muted">
      No measurements yet. Add his weight and height from a checkup or his health record. Older ones go in with their
      own dates, and the charts fill in from there.
    </p>
  {/if}
</section>

{#each MEASURES as m (m.id)}
  {@const words = latest(m.id)}
  {#if words}
    <section class="card">
      <h3>{m.title}</h3>
      <p style="margin: 6px 0 2px">{words.main}</p>
      {#if words.before}<p class="muted" style="margin: 0 0 8px">{words.before}</p>{/if}
      {#if birth && !pastFive}
        <GrowthChart measure={m.id} {birth} {nowDay} points={series[m.id]} />
        <p class="muted" style="margin: 6px 0 0; font-size: 13px">
          Shaded: the 3rd to 97th percentiles for boys his age, darker from the 15th to the 85th; the firm line is the
          50th.
        </p>
      {/if}
    </section>
  {/if}
{/each}

{#if app.growth.length}
  <section class="card">
    <h3>Measurements</h3>
    <ul class="sleeps">
      {#each newestFirst as row (row.id)}
        <li>
          <span class="what">
            {longDate(row.measured_on)}{#if birth}<span class="muted"> · {age(row.measured_on)}</span>{/if}
            <br />{both(row)}{#if row.note}<span class="muted"> · {row.note}</span>{/if}
          </span>
          <button class="ghost" onclick={() => (ui.growth = { id: row.id })}>Edit</button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<p class="muted" style="margin: 4px 4px 12px; font-size: 13px">
  Percentiles come from the WHO Child Growth Standards for boys, the tables behind the WHO Growth Charts for Canada.
  Under 2, length is measured lying down; from 2, standing height, as at the doctor's.
</p>
