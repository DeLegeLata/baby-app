<script lang="ts">
  // His weight or height over the WHO percentile curves for boys: the 3rd to
  // 97th band shaded, the 15th to 85th darker, the 50th drawn firmest. Tap a dot
  // for the date, his age and the percentile; the list under the charts carries
  // the same numbers.
  import { longDate } from '../format';
  import {
    CURVES,
    MONTH_DAYS,
    ageLabel,
    ageTicks,
    axisAge,
    chartWindow,
    curve,
    percentileLabel,
    show,
    ticks,
    type Measure,
    type Reading
  } from '../growth';
  import type { DateKey } from '../time';

  let { measure, birth, nowDay, points }: { measure: Measure; birth: DateKey; nowDay: number; points: Reading[] } =
    $props();

  type Pt = { day: number; value: number };

  const W = 340;
  const H = 230;
  const LEFT = 30;
  const RIGHT = 22;
  const TOP = 10;
  const BOTTOM = 22;

  const win = $derived(chartWindow(nowDay, points));
  const lines = $derived(CURVES.map((c) => ({ ...c, pieces: curve(measure, c.z, win) })));
  const shown = $derived(points.filter((p) => p.z !== null && p.day >= win.from && p.day <= win.to));
  const range = $derived.by(() => {
    const values = [...lines[0].pieces.flat(), ...lines[lines.length - 1].pieces.flat(), ...shown].map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.04;
    return { lo: lo - pad, hi: hi + pad };
  });

  const x = (day: number) => LEFT + ((day - win.from) / (win.to - win.from)) * (W - LEFT - RIGHT);
  const y = (v: number) => TOP + (1 - (v - range.lo) / (range.hi - range.lo)) * (H - TOP - BOTTOM);
  const at = (p: Pt) => `${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`;
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${at(p)}`).join('');

  /** The area between two curves, piece by piece (height breaks at the second birthday). */
  function band(lower: Pt[][], upper: Pt[][]): string {
    return upper
      .map((up, i) => path(up) + [...(lower[i] ?? [])].reverse().map((p) => `L${at(p)}`).join('') + 'Z')
      .join('');
  }

  const outer = $derived(band(lines[0].pieces, lines[4].pieces));
  const inner = $derived(band(lines[1].pieces, lines[3].pieces));
  const yTicks = $derived(ticks(range.lo, range.hi, 7));
  const xTicks = $derived(ageTicks(win));
  const today = $derived(nowDay >= win.from && nowDay <= win.to ? x(nowDay) : null);

  let tip = $state<{ top: number; text: string } | null>(null);

  function describe(p: Reading) {
    return `${longDate(p.date)}, ${ageLabel(birth, p.date)}: ${show(p.value, measure)}, ${percentileLabel(p.p!)} percentile`;
  }

  function showTip(p: Reading) {
    tip = { top: (y(p.value) / H) * 100, text: describe(p) };
  }
</script>

<div class="chart">
  <svg
    viewBox="0 0 {W} {H}"
    role="img"
    aria-label="{measure === 'weight' ? 'Weight' : 'Height'} for age, against the WHO percentiles for boys"
  >
    {#each yTicks as v}
      <line x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} stroke="var(--grid)" stroke-width="1" />
      <text x={LEFT - 4} y={y(v) + 3} font-size="9" fill="var(--muted)" text-anchor="end">{v}</text>
    {/each}
    {#each xTicks as m}
      <line x1={x(m * MONTH_DAYS)} x2={x(m * MONTH_DAYS)} y1={TOP} y2={H - BOTTOM} stroke="var(--grid)" stroke-width="1" />
      <text x={x(m * MONTH_DAYS)} y={H - BOTTOM + 13} font-size="9" fill="var(--muted)" text-anchor="middle"
        >{axisAge(m)}</text
      >
    {/each}

    <path d={outer} fill="var(--accent-soft)" fill-opacity="0.55" />
    <path d={inner} fill="var(--accent-soft)" />
    {#each lines as line (line.p)}
      {@const end = line.pieces.at(-1)?.at(-1)}
      {#each line.pieces as piece}
        <path
          d={path(piece)}
          fill="none"
          stroke={line.p === 50 ? 'var(--accent)' : 'var(--muted)'}
          stroke-opacity={line.p === 50 ? 0.7 : 0.4}
          stroke-width={line.p === 50 ? 1.4 : 0.8}
        />
      {/each}
      {#if end}
        <text x={W - RIGHT + 3} y={y(end.value) + 3} font-size="9" fill="var(--muted)">{line.p}</text>
      {/if}
    {/each}

    {#if today !== null}
      <line x1={today} x2={today} y1={TOP} y2={H - BOTTOM} stroke="var(--muted)" stroke-dasharray="3 3" stroke-opacity="0.6" />
      <text x={today - 3} y={TOP + 8} font-size="9" fill="var(--muted)" text-anchor="end">today</text>
    {/if}

    {#if shown.length > 1}
      <path d={path(shown)} fill="none" stroke="var(--series-nap)" stroke-width="2" stroke-linejoin="round" />
    {/if}
    {#each shown as p (p.id)}
      <circle cx={x(p.day)} cy={y(p.value)} r="4" fill="var(--series-nap)" stroke="var(--card)" stroke-width="1.5" />
      <!-- a hit target bigger than the dot -->
      <circle
        cx={x(p.day)}
        cy={y(p.value)}
        r="14"
        fill="transparent"
        role="button"
        tabindex="-1"
        aria-label={describe(p)}
        onpointerenter={() => showTip(p)}
        onpointerleave={() => (tip = null)}
        onclick={() => showTip(p)}
        onkeydown={() => {}}
      />
    {/each}

    <text x="0" y={TOP - 2} font-size="9" fill="var(--muted)">{measure === 'weight' ? 'kg' : 'cm'}</text>
  </svg>
  {#if tip}
    <div class="tip" style="top: {tip.top}%">{tip.text}</div>
  {/if}
</div>
