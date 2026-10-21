<script lang="ts">
  // The weekly summary, the sleep diary chart with its table, every sleep, and
  // the two exports.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clock12, clockAt, dayLabel, dur, keyLabel } from '../format';
  import { KIND_LABEL, OFF_LABEL, type Sleep } from '../model';
  import { activityEffects, chartRows, dayStats, napEvidence, netSleepMinutes, weeklySummary } from '../engine';
  import { habitEffects } from '../habits';
  import { saveFile, sleepsCsv } from '../export';
  import SleepChart from './SleepChart.svelte';

  const DAYS = 14;
  let showAll = $state(false);

  const tz = $derived(app.settings.time_zone);
  const summary = $derived(weeklySummary(app.input));
  const before = $derived(activityEffects(app.input));
  const napNote = $derived(napEvidence(app.history, app.today).note);
  const nightEffects = $derived(before.effects.filter((e) => e.kind === 'night'));
  const napEffects = $derived(before.effects.filter((e) => e.kind === 'nap'));
  const habitLines = $derived(habitEffects(app.input, app.habits));
  const rows = $derived(chartRows(app.input, app.today, DAYS));
  const stats = $derived(dayStats(app.input, app.today, DAYS).reverse());
  const list = $derived(showAll ? app.sleeps : app.sleeps.slice(0, 30));

  function describe(s: Sleep): string {
    const start = Date.parse(s.asleep_at ?? s.in_bed_at!);
    let text = `${dayLabel(start, tz)}, ${clockAt(start, tz)}`;
    if (s.woke_at) text += ` to ${clockAt(Date.parse(s.woke_at), tz)}`;
    if (s.asleep_at) text += ` · ${dur(netSleepMinutes(s, app.now))}`;
    else text += ' · not marked asleep';
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
              <td>{s.asleep !== null ? clock12(s.asleep) : '-'}{s.assumed ? '*' : ''}</td>
              <td>{s.wakings ? `${s.wakings} (${dur(s.wakingMin)})` : '-'}</td>
              <td>{s.up !== null ? clock12(s.up) : '-'}</td>
              <td>{s.night !== null ? dur(s.night) : '-'}{s.assumed && s.night !== null ? '*' : ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if stats.some((s) => s.assumed)}
      <p class="muted" style="margin: 6px 0 0">
        * Assumed: he was put to bed but not marked asleep. Left out of the weekly averages and the learning.
      </p>
    {/if}
  </details>
</section>

<section class="card">
  <h3>Before sleep</h3>
  {#if before.effects.length === 0}
    <p class="muted" style="margin-top: 6px">
      Choose what he did before a sleep from the list under "Before this sleep" on the Today screen, or when editing a
      sleep. After a few nights, this shows how each activity lines up with how quickly he falls asleep, how often he
      wakes and how long he sleeps.
    </p>
  {:else}
    {#if nightEffects.length}
      <ul class="reasons">
        {#each nightEffects as effect (effect.activity)}<li>{effect.line}</li>{/each}
      </ul>
    {/if}
    {#if napEffects.length}
      <p class="muted" style="margin: 10px 0 0"><b>Naps</b></p>
      <ul class="reasons">
        {#each napEffects as effect (effect.activity)}<li>{effect.line}</li>{/each}
      </ul>
    {/if}
    <p class="muted" style="margin: 10px 0 0">
      These compare his own sleeps over the last 60 days, counting only those where at least one activity was
      recorded, and leaving out unusual days. They show patterns, not proof: a busy day can bring both a trip to the
      park and a good night, and a difference resting on a handful of nights can be chance.
    </p>
  {/if}
</section>

<section class="card">
  <h3>Screens and the soother</h3>
  {#if habitLines.length === 0}
    <p class="muted" style="margin-top: 6px">
      Use Screen on and off, and answer "With the soother" on his sleeps. After a few nights, this shows how they line
      up with how quickly he falls asleep, how often he wakes and how long he sleeps.
    </p>
  {:else}
    <ul class="reasons">
      {#each habitLines as effect (effect.key)}<li>{effect.kind === 'nap' ? `Naps: ${effect.line}` : effect.line}</li>{/each}
    </ul>
    <p class="muted" style="margin: 10px 0 0">
      The screen lines use the nights since the first screen was logged, so a day with screens that were not logged
      counts as a day without. The soother lines use only sleeps where it was answered. Unusual days are left out.
      Patterns, not proof.
    </p>
  {/if}
</section>

<section class="card">
  <h3>Naps and bedtime</h3>
  <p style="margin: 6px 0 0">{napNote}</p>
  <p class="muted" style="margin: 10px 0 0">
    This sets how long he took to fall asleep at night (Put to bed to Fell asleep) against when that day's nap ended,
    over the last 8 weeks, recent days counting most and unusual days left out. When later naps clearly mean a longer
    wait, the nap suggested on home days moves earlier, by half an hour at most and keeping its length. A pattern in
    his own days, not proof.
  </p>
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
