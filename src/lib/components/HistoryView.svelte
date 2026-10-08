<script lang="ts">
  // The weekly summary, the sleep diary chart with its table, every sleep, and
  // the two exports.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clock12, clockAt, dayLabel, dur, keyLabel } from '../format';
  import { KIND_LABEL, OFF_LABEL, type Sleep } from '../model';
  import { chartRows, dayStats, netSleepMinutes, weeklySummary } from '../engine';
  import { saveFile, sleepsCsv } from '../export';
  import SleepChart from './SleepChart.svelte';

  const DAYS = 14;
  let showAll = $state(false);

  const tz = $derived(app.settings.time_zone);
  const summary = $derived(weeklySummary(app.input));
  const rows = $derived(chartRows(app.input, app.today, DAYS));
  const stats = $derived(dayStats(app.input, app.today, DAYS).reverse());
  const list = $derived(showAll ? app.sleeps : app.sleeps.slice(0, 30));

  function describe(s: Sleep): string {
    const start = Date.parse(s.asleep_at ?? s.in_bed_at!);
    let text = `${dayLabel(start, tz)}, ${clockAt(start, tz)}`;
    if (s.woke_at) text += ` to ${clockAt(Date.parse(s.woke_at), tz)}`;
    if (s.asleep_at) text += ` · ${dur(netSleepMinutes(s, app.now))}`;
    return text;
  }

  async function csv() {
    const all = await app.allSleeps();
    await saveFile(`sleep-${app.today}.csv`, sleepsCsv(all, tz));
  }
</script>

<section class="card">
  <h3>This week</h3>
  <ul class="reasons">
    {#each summary.lines as line}<li>{line}</li>{/each}
  </ul>
</section>

<section class="card">
  <h3 style="margin-bottom: 8px">The last {DAYS} days</h3>
  <SleepChart {rows} />

  <details>
    <summary>As a table</summary>
    <div class="scroll-x">
      <table class="stats">
        <thead>
          <tr><th>Day</th><th>Nap</th><th>Asleep</th><th>Woke</th><th>Up</th><th>Night</th></tr>
        </thead>
        <tbody>
          {#each stats as s (s.date)}
            <tr>
              <td>{keyLabel(s.date)}{#if s.off}<br /><span class="muted">{OFF_LABEL[s.off]}</span>{/if}</td>
              <td>{s.daySleep ? dur(s.daySleep) : '-'}</td>
              <td>{s.asleep !== null ? clock12(s.asleep) : '-'}</td>
              <td>{s.wakings ? `${s.wakings} (${dur(s.wakingMin)})` : '-'}</td>
              <td>{s.up !== null ? clock12(s.up) : '-'}</td>
              <td>{s.night !== null ? dur(s.night) : '-'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</section>

<section class="card">
  <div class="spread">
    <h3>Every sleep</h3>
    <button class="ghost" onclick={() => ui.newSleep()}>Add</button>
  </div>
  {#if list.length === 0}
    <p class="muted">Nothing logged yet.</p>
  {:else}
    <ul class="sleeps">
      {#each list as s (s.id)}
        <li>
          <span class="key {s.kind}" aria-hidden="true"></span>
          <span class="what">
            <b>{KIND_LABEL[s.kind]}</b>
            <span class="muted">
              {describe(s)}
            </span>
          </span>
          {#if !s.synced}<span class="muted" title="not sent yet">&#9679;</span>{/if}
          <button class="ghost" onclick={() => ui.editSleep(s.id)}>Edit</button>
        </li>
      {/each}
    </ul>
    {#if !showAll && app.sleeps.length > 30}
      <button class="ghost" onclick={() => (showAll = true)}>Show all {app.sleeps.length}</button>
    {/if}
  {/if}
</section>

<section class="card">
  <h3>Export</h3>
  <p class="muted">A spreadsheet of every sleep, or a one-page summary to print or bring to his doctor.</p>
  <div class="row">
    <button onclick={csv}>Download CSV</button>
    <button onclick={() => (ui.report = true)}>Doctor's summary</button>
  </div>
</section>
