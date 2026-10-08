<script lang="ts">
  // A one-page summary of the last four weeks for his doctor: the averages
  // against the guideline for his age, the diary chart, and a line per day.
  // Printing (or Save as PDF) prints this page alone.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clock12, dur, keyLabel, longDate } from '../format';
  import { OFF_LABEL } from '../model';
  import { averages, chartRows, dayStats, sleepBand } from '../engine';
  import { addDays, ageInMonths } from '../time';
  import SleepChart from './SleepChart.svelte';

  const DAYS = 28;
  const tz = $derived(app.settings.time_zone);
  const last = $derived(addDays(app.today, -1));
  // Four weeks back, but no earlier than the first day anything was logged.
  const span = $derived.by(() => {
    const all = dayStats(app.input, last, DAYS);
    const first = all.findIndex((s) => s.asleep !== null || s.daySleep > 0 || s.up !== null);
    return first < 0 ? DAYS : DAYS - first;
  });
  const stats = $derived(dayStats(app.input, last, span));
  const avg2 = $derived(averages(stats.slice(-14)));
  const avg4 = $derived(averages(stats));
  const band = $derived(sleepBand(app.child.birth_at, app.now, tz));
  const rows = $derived(chartRows(app.input, last, span));
  const age = $derived.by(() => {
    if (!app.child.birth_at) return 'age not entered';
    const m = ageInMonths(app.child.birth_at, app.now, tz);
    return `${Math.floor(m / 12)} years ${m % 12} months`;
  });

  const fmt = (v: number | null, f: (x: number) => string) => (v === null ? '-' : f(v));

  function print() {
    document.body.classList.add('printing');
    addEventListener('afterprint', () => document.body.classList.remove('printing'), { once: true });
    window.print();
  }
</script>

{#if ui.report}
  <div class="report">
    <div class="page">
      <div class="spread no-print" style="margin-bottom: 12px">
        <button class="primary" onclick={print}>Print or save as PDF</button>
        <button class="ghost" onclick={() => (ui.report = false)}>Close</button>
      </div>

      <h2>Sleep summary: {app.child.name}</h2>
      <p>
        {age}{app.child.birth_at ? `, born ${longDate(app.child.birth_at.slice(0, 10))}` : ''}.
      </p>
      <p>
        {longDate(addDays(last, -(span - 1)))} to {longDate(last)}, from his parents' logs. Printed
        {longDate(app.today)}.
      </p>
      <p class="muted">
        Guideline for {band.label}: {band.minH} to {band.maxH} hours of sleep in 24 hours, naps included (Canadian
        24-Hour Movement Guidelines for the Early Years).
      </p>

      <h3>Averages</h3>
      <table class="stats">
        <thead>
          <tr><th></th><th>Last 2 weeks</th><th>{span < DAYS ? `All ${span} days` : 'Last 4 weeks'}</th></tr>
        </thead>
        <tbody>
          <tr><td>Nights logged</td><td>{avg2.days}</td><td>{avg4.days}</td></tr>
          <tr><td>Asleep at</td><td>{fmt(avg2.bedtime, clock12)}</td><td>{fmt(avg4.bedtime, clock12)}</td></tr>
          <tr><td>Up for the day</td><td>{fmt(avg2.up, clock12)}</td><td>{fmt(avg4.up, clock12)}</td></tr>
          <tr><td>Night sleep</td><td>{fmt(avg2.night, dur)}</td><td>{fmt(avg4.night, dur)}</td></tr>
          <tr><td>Day sleep</td><td>{fmt(avg2.nap, dur)}</td><td>{fmt(avg4.nap, dur)}</td></tr>
          <tr><td>Total in 24 h</td><td>{fmt(avg2.total, dur)}</td><td>{fmt(avg4.total, dur)}</td></tr>
          <tr>
            <td>Night wakings</td>
            <td>{avg2.wakings} ({avg2.days ? (avg2.wakings / avg2.days).toFixed(1) : '0'} a night)</td>
            <td>{avg4.wakings} ({avg4.days ? (avg4.wakings / avg4.days).toFixed(1) : '0'} a night)</td>
          </tr>
          <tr><td>Unusual days, left out</td><td>{avg2.offDays}</td><td>{avg4.offDays}</td></tr>
        </tbody>
      </table>

      <div class="diary">
        <h3>Sleep diary</h3>
        <SleepChart {rows} />
      </div>

      <h3>Day by day</h3>
      <table class="stats">
        <thead>
          <tr>
            <th>Day</th><th>Day sleep</th><th>In bed</th><th>Asleep</th><th>Night wakings</th><th>Up</th><th>Night</th><th>Total</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {#each stats as s (s.date)}
            <tr>
              <td>{keyLabel(s.date)}</td>
              <td>{s.daySleep ? dur(s.daySleep) : '-'}</td>
              <td>{fmt(s.inBed, clock12)}</td>
              <td>{fmt(s.asleep, clock12)}</td>
              <td>{s.wakings ? `${s.wakings}, ${dur(s.wakingMin)}` : '-'}</td>
              <td>{fmt(s.up, clock12)}</td>
              <td>{fmt(s.night, dur)}</td>
              <td>{fmt(s.total, dur)}</td>
              <td>{[s.off ? OFF_LABEL[s.off] : '', s.note ?? ''].filter(Boolean).join('. ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}
