<script lang="ts">
  // One-off changes for a date (an appointment, a trip, daycare closed), and
  // marking a day as unusual so it stays out of the learning.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clock12, keyLabel } from '../format';
  import { OFF_LABEL, OFF_TAGS, type DayOverride, type NoSleepWindow, type OffTag } from '../model';
  import { CLOCK_PATTERN, parseClock } from '../time';

  type Mode = 'usual' | 'set' | 'none';

  let dialog = $state<HTMLDialogElement | null>(null);
  let date = $state('');
  let daycare = $state<'usual' | 'yes' | 'no'>('usual');
  let upMode = $state<Mode>('usual');
  let up = $state('07:00');
  let napMode = $state<Mode>('usual');
  let napStart = $state('12:30');
  let napEnd = $state('14:30');
  let bedMode = $state<Mode>('usual');
  let bed = $state('20:30');
  let windowsMode = $state<'usual' | 'set'>('usual');
  let windows = $state<NoSleepWindow[]>([]);
  let off = $state<OffTag | null>(null);
  let noNap = $state(false);
  let note = $state('');
  let error = $state('');

  const t = $derived(app.settings.schedule);
  const usual = (c: string | null) => (c ? clock12(parseClock(c)) : 'none');

  $effect(() => {
    const d = ui.day;
    if (!d) {
      dialog?.close();
      return;
    }
    untrack(() => load(d));
    if (!dialog?.open) dialog?.showModal();
  });

  function load(d: string) {
    date = d;
    const row = app.dayRow(d);
    const o: DayOverride = row?.override ?? {};
    const sched = app.settings.schedule;
    daycare = o.daycare === undefined ? 'usual' : o.daycare ? 'yes' : 'no';
    upMode = !('must_be_up' in o) ? 'usual' : o.must_be_up === null ? 'none' : 'set';
    up = o.must_be_up ?? sched.must_be_up ?? '07:00';
    napMode = !('nap_start' in o) ? 'usual' : o.nap_start === null ? 'none' : 'set';
    napStart = o.nap_start ?? sched.nap_start ?? '12:30';
    napEnd = o.nap_end ?? sched.nap_end ?? '14:30';
    bedMode = !('latest_bedtime' in o) ? 'usual' : o.latest_bedtime === null ? 'none' : 'set';
    bed = o.latest_bedtime ?? sched.latest_bedtime ?? '20:30';
    windowsMode = o.no_sleep ? 'set' : 'usual';
    windows = (o.no_sleep ?? sched.no_sleep).map((w) => ({ ...w }));
    off = row?.off_tag ?? null;
    noNap = row?.no_nap ?? false;
    note = row?.note ?? '';
    error = '';
  }

  function close() {
    ui.day = null;
  }

  async function save() {
    const o: DayOverride = {};
    const check = (c: string) => CLOCK_PATTERN.test(c);
    if (daycare !== 'usual') o.daycare = daycare === 'yes';
    if (upMode === 'set') {
      if (!check(up)) return void (error = 'Give the must-be-up time.');
      o.must_be_up = up;
    } else if (upMode === 'none') o.must_be_up = null;
    if (napMode === 'set') {
      if (!check(napStart) || !check(napEnd) || parseClock(napEnd) <= parseClock(napStart)) {
        return void (error = 'The nap window must end after it starts.');
      }
      o.nap_start = napStart;
      o.nap_end = napEnd;
    } else if (napMode === 'none') {
      o.nap_start = null;
      o.nap_end = null;
    }
    if (bedMode === 'set') {
      if (!check(bed)) return void (error = 'Give the latest bedtime.');
      o.latest_bedtime = bed;
    } else if (bedMode === 'none') o.latest_bedtime = null;
    if (windowsMode === 'set') {
      for (const w of windows) {
        if (!check(w.start) || !check(w.end)) return void (error = 'Give each stay-awake window a start and an end.');
      }
      o.no_sleep = windows.map((w) => ({ start: w.start, end: w.end, label: w.label.trim() }));
    }
    await app.saveDay(date, { override: o, off_tag: off, no_nap: noNap, note: note.trim() || null });
    close();
  }

  async function clear() {
    await app.saveDay(date, { override: {}, off_tag: null, no_nap: false, note: null });
    close();
  }
</script>

{#snippet modes(name: string, value: Mode, set: (m: Mode) => void, usualText: string)}
  <div class="chips" role="group" aria-label={name}>
    <button aria-pressed={value === 'usual'} onclick={() => set('usual')}>As usual ({usualText})</button>
    <button aria-pressed={value === 'set'} onclick={() => set('set')}>Change</button>
    <button aria-pressed={value === 'none'} onclick={() => set('none')}>None</button>
  </div>
{/snippet}

<dialog bind:this={dialog} onclose={close}>
  <div class="spread">
    <h3>{date ? keyLabel(date) : 'A day'}</h3>
    <button class="ghost" onclick={close}>Close</button>
  </div>
  <p class="muted">Changes here apply to this date only. The daily schedule is in Settings.</p>

  <label for="day-date">Date</label>
  <input id="day-date" type="date" value={date} onchange={(e) => e.currentTarget.value && load(e.currentTarget.value)} />

  <label for="daycare">Daycare</label>
  <div class="chips" id="daycare" role="group">
    <button aria-pressed={daycare === 'usual'} onclick={() => (daycare = 'usual')}>As usual</button>
    <button aria-pressed={daycare === 'yes'} onclick={() => (daycare = 'yes')}>Daycare day</button>
    <button aria-pressed={daycare === 'no'} onclick={() => (daycare = 'no')}>No daycare</button>
  </div>

  <label for="up-mode">Must be up by</label>
  {@render modes('Must be up by', upMode, (m) => (upMode = m), usual(t.must_be_up))}
  {#if upMode === 'set'}<input type="time" style="margin-top: 6px" bind:value={up} />{/if}

  <label for="nap-mode">Nap window</label>
  {@render modes(
    'Nap window',
    napMode,
    (m) => (napMode = m),
    t.nap_start && t.nap_end ? `${usual(t.nap_start)} to ${usual(t.nap_end)}` : 'none'
  )}
  {#if napMode === 'set'}
    <div class="grid2" style="margin-top: 6px">
      <input type="time" aria-label="Nap from" bind:value={napStart} />
      <input type="time" aria-label="Nap to" bind:value={napEnd} />
    </div>
  {/if}

  <label for="bed-mode">Latest bedtime</label>
  {@render modes('Latest bedtime', bedMode, (m) => (bedMode = m), usual(t.latest_bedtime))}
  {#if bedMode === 'set'}<input type="time" style="margin-top: 6px" bind:value={bed} />{/if}

  <label for="windows">Times he must stay awake</label>
  <div class="chips" id="windows" role="group">
    <button aria-pressed={windowsMode === 'usual'} onclick={() => (windowsMode = 'usual')}>As usual</button>
    <button aria-pressed={windowsMode === 'set'} onclick={() => (windowsMode = 'set')}>Change for this day</button>
  </div>
  {#if windowsMode === 'set'}
    {#each windows as w, i}
      <div class="grid2" style="margin-top: 6px">
        <input type="time" aria-label="From" bind:value={w.start} />
        <input type="time" aria-label="To" bind:value={w.end} />
      </div>
      <div class="grid-end">
        <input placeholder="What it is (optional)" aria-label="What it is" bind:value={w.label} maxlength="40" />
        <button class="ghost" onclick={() => windows.splice(i, 1)}>Remove</button>
      </div>
    {/each}
    <button style="margin-top: 6px" onclick={() => windows.push({ start: '17:00', end: '17:30', label: '' })}>
      Add a stay-awake time
    </button>
  {/if}

  <hr class="soft" />

  <label for="off">An unusual day (left out of the learning)</label>
  <div class="chips" id="off" role="group">
    <button aria-pressed={off === null} onclick={() => (off = null)}>Normal</button>
    {#each OFF_TAGS as tag}
      <button aria-pressed={off === tag} onclick={() => (off = tag)}>{OFF_LABEL[tag]}</button>
    {/each}
  </div>

  <label class="check" style="margin-top: 12px">
    <input type="checkbox" bind:checked={noNap} />
    <span>Daycare reported that he did not nap</span>
  </label>

  <label for="day-note">Note</label>
  <textarea id="day-note" bind:value={note} maxlength="500"></textarea>

  {#if error}<p class="flag">{error}</p>{/if}

  <button class="primary" style="width: 100%; margin-top: 12px" onclick={save}>Save</button>
  <button class="ghost" style="width: 100%; margin-top: 8px" onclick={clear}>Back to the usual schedule</button>
</dialog>
