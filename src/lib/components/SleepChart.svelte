<script lang="ts">
  // The sleep diary: one row per day, midnight to midnight, a bar for each
  // stretch of sleep, gaps where he woke in the night. Tap or hover a bar for
  // its times; the table under the chart carries the same numbers.
  import { clock12 } from '../format';
  import { KIND_LABEL, OFF_LABEL } from '../model';
  import type { ChartRow, ChartSegment } from '../engine';

  let { rows }: { rows: ChartRow[] } = $props();

  const W = 340;
  const LABEL = 54;
  const PLOT = W - LABEL - 8;
  const ROW = 22;
  const BAR = 12;
  const TOP = 18;
  const H = $derived(TOP + rows.length * ROW + 4);
  const x = (min: number) => LABEL + (min / 1440) * PLOT;
  const TICKS = [0, 360, 720, 1080, 1440];
  const tickLabel = (m: number) => (m === 720 ? 'noon' : m === 0 || m === 1440 ? 'midnight' : clock12(m).replace(':00', ''));

  let tip = $state<{ top: number; text: string } | null>(null);

  function rowLabel(date: string) {
    const [y, m, d] = date.split('-').map(Number);
    const wd = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short' }).format(
      new Date(Date.UTC(y, m - 1, d, 12))
    );
    return `${wd} ${d}`;
  }

  function describe(row: ChartRow, s: ChartSegment) {
    const what = s.kind === 'in_bed' ? 'In bed' : KIND_LABEL[s.kind];
    const from = s.start === 0 ? 'midnight' : clock12(s.start);
    const to = s.end >= 1440 ? 'midnight' : clock12(s.end);
    return `${rowLabel(row.date)}: ${what}, ${from} to ${to}`;
  }

  function show(row: ChartRow, s: ChartSegment, i: number) {
    tip = { top: ((TOP + i * ROW) / H) * 100, text: describe(row, s) };
  }
</script>

<div class="legend" aria-hidden="true">
  <span><i class="key night"></i>Night</span>
  <span><i class="key nap"></i>Nap</span>
  <span><i class="key catnap"></i>Catnap</span>
  <span><i class="key in_bed"></i>In bed, awake</span>
  <span>* unusual day</span>
</div>

<div class="chart">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Sleep diary for the last {rows.length} days">
    {#each TICKS as t}
      <line x1={x(t)} x2={x(t)} y1={TOP - 4} y2={H - 2} stroke="var(--grid)" stroke-width="1" />
      <text
        x={x(t)}
        y={10}
        font-size="9"
        fill="var(--muted)"
        text-anchor={t === 0 ? 'start' : t === 1440 ? 'end' : 'middle'}>{tickLabel(t)}</text
      >
    {/each}

    {#each rows as row, i (row.date)}
      {@const y = TOP + i * ROW}
      <text x="0" y={y + ROW / 2 + 3} font-size="10" fill="var(--muted)">
        {rowLabel(row.date)}{row.off ? ' *' : ''}
        {#if row.off}<title>{OFF_LABEL[row.off]}: left out of the learning</title>{/if}
      </text>
      {#each row.segments as s}
        {@const left = x(s.start)}
        {@const width = Math.max(1.5, x(s.end) - x(s.start) - (s.end < 1440 ? 1 : 0))}
        <rect
          x={left}
          y={y + (ROW - BAR) / 2}
          {width}
          height={BAR}
          rx="2"
          fill={s.kind === 'in_bed' ? 'var(--series-night)' : `var(--series-${s.kind})`}
          fill-opacity={s.kind === 'in_bed' ? 0.28 : 1}
        />
        <!-- a hit target taller and wider than the bar -->
        <rect
          x={left - 3}
          y={y}
          width={width + 6}
          height={ROW}
          fill="transparent"
          role="button"
          tabindex="-1"
          aria-label={describe(row, s)}
          onpointerenter={() => show(row, s, i)}
          onpointerleave={() => (tip = null)}
          onclick={() => show(row, s, i)}
          onkeydown={() => {}}
        />
      {/each}
    {/each}
  </svg>
  {#if tip}
    <div class="tip" style="top: {tip.top}%">{tip.text}</div>
  {/if}
</div>
