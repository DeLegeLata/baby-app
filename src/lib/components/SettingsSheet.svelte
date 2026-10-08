<script lang="ts">
  // The child, his daily schedule, the starting points the app learns from,
  // and the reminders on this phone. Shared with the other phone on save.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { settingsSchema, type AppSettings, type NoSleepWindow } from '../model';
  import { disablePush, enablePush, sendTest } from '../reminders';

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let dialog = $state<HTMLDialogElement | null>(null);
  let draft = $state<AppSettings>($state.snapshot(app.settings));
  let name = $state('');
  let birth = $state('');
  let error = $state('');
  let pushBusy = $state(false);
  let pushMessage = $state('');

  $effect(() => {
    if (ui.settings) {
      untrack(() => {
        draft = $state.snapshot(app.settings);
        name = app.child.name;
        birth = app.child.birth_at ? app.child.birth_at.slice(0, 10) : '';
        error = '';
        pushMessage = '';
        void app.refreshPush();
      });
      if (!dialog?.open) dialog?.showModal();
    } else {
      dialog?.close();
    }
  });

  /** Empty time inputs mean "none". */
  const orNull = (v: string | null) => (v ? v : null);

  async function save() {
    const candidate = {
      ...draft,
      schedule: {
        ...draft.schedule,
        must_be_up: orNull(draft.schedule.must_be_up),
        nap_start: orNull(draft.schedule.nap_start),
        nap_end: orNull(draft.schedule.nap_end),
        latest_bedtime: orNull(draft.schedule.latest_bedtime),
        no_sleep: draft.schedule.no_sleep.map((w) => ({ ...w, label: w.label.trim() }))
      },
      daycare_days: [...draft.daycare_days].sort(),
      routine_min: Number(draft.routine_min),
      settle_min: Number(draft.settle_min),
      reminder_lead_min: Number(draft.reminder_lead_min)
    };
    const parsed = settingsSchema.safeParse(candidate);
    if (!parsed.success) {
      error = parsed.error.issues[0]?.message ?? 'Something is out of range';
      return;
    }
    await app.saveSettings(parsed.data);
    // Noon UTC keeps the date the same in any Canadian time zone.
    await app.saveChild({ name: name.trim() || 'Toddler', birth_at: birth ? `${birth}T12:00:00.000Z` : null });
    ui.settings = false;
  }

  function toggleDay(day: number) {
    draft.daycare_days = draft.daycare_days.includes(day)
      ? draft.daycare_days.filter((d) => d !== day)
      : [...draft.daycare_days, day];
  }

  function addWindow() {
    const w: NoSleepWindow = { start: '17:00', end: '17:30', label: 'Drive home' };
    draft.schedule.no_sleep = [...draft.schedule.no_sleep, w];
  }

  async function turnOn() {
    const who = app.who;
    if (!who || who.user_id === 'local') {
      pushMessage = 'Sign in first, so the reminders know which household to follow.';
      return;
    }
    pushBusy = true;
    pushMessage = '';
    try {
      await enablePush(who.household_id, who.user_id);
      pushMessage = 'Reminders are on for this phone.';
    } catch (e) {
      pushMessage = e instanceof Error ? e.message : String(e);
    } finally {
      pushBusy = false;
      await app.refreshPush();
    }
  }

  async function turnOff() {
    pushBusy = true;
    try {
      await disablePush();
      pushMessage = 'Reminders are off for this phone.';
    } finally {
      pushBusy = false;
      await app.refreshPush();
    }
  }

  async function test() {
    if (!app.who) return;
    try {
      await sendTest(app.who.household_id);
      pushMessage = 'Sent. It should arrive on every phone with reminders on within a minute.';
    } catch (e) {
      pushMessage = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (ui.settings = false)}>
  <div class="spread">
    <h3>Settings</h3>
    <button class="ghost" onclick={() => (ui.settings = false)}>Close</button>
  </div>

  <div class="grid2">
    <div>
      <label for="child-name">Name</label>
      <input id="child-name" bind:value={name} autocomplete="off" />
    </div>
    <div>
      <label for="child-birth">Born</label>
      <input id="child-birth" type="date" bind:value={birth} />
    </div>
  </div>
  <p class="muted">The birth date picks the sleep guideline for his age.</p>

  <hr class="soft" />
  <h3>His daily schedule</h3>
  <p class="muted">Every day, weekends included. Change a single date from the Today screen.</p>

  <div class="grid2">
    <div>
      <label for="must-up">Must be up by</label>
      <input id="must-up" type="time" bind:value={draft.schedule.must_be_up} />
    </div>
    <div>
      <label for="latest-bed">Latest bedtime</label>
      <input id="latest-bed" type="time" bind:value={draft.schedule.latest_bedtime} />
    </div>
    <div>
      <label for="nap-start">Daycare nap from</label>
      <input id="nap-start" type="time" bind:value={draft.schedule.nap_start} />
    </div>
    <div>
      <label for="nap-end">to</label>
      <input id="nap-end" type="time" bind:value={draft.schedule.nap_end} />
    </div>
  </div>
  <p class="muted">Leave a time empty for none. On home days the nap aims for the daycare window too.</p>

  <label for="daycare-days">Daycare days</label>
  <div class="chips" id="daycare-days" role="group">
    {#each WEEKDAYS as day, i}
      <button aria-pressed={draft.daycare_days.includes(i + 1)} onclick={() => toggleDay(i + 1)}>{day}</button>
    {/each}
  </div>

  <label for="no-sleep">Times he must stay awake</label>
  <div id="no-sleep">
    {#each draft.schedule.no_sleep as w, i}
      <div class="grid2" style="margin-top: 6px">
        <input type="time" aria-label="From" bind:value={w.start} />
        <input type="time" aria-label="To" bind:value={w.end} />
      </div>
      <div class="grid-end">
        <input placeholder="What it is, e.g. drive home" aria-label="What it is" bind:value={w.label} maxlength="40" />
        <button class="ghost" onclick={() => draft.schedule.no_sleep.splice(i, 1)}>Remove</button>
      </div>
    {/each}
    <button style="margin-top: 6px" onclick={addWindow}>Add a stay-awake time</button>
  </div>
  <p class="muted">Such as the drive home from daycare, so a catnap there does not push bedtime late.</p>

  <hr class="soft" />
  <h3>Bedtime</h3>
  <div class="grid2">
    <div>
      <label for="routine">Bedtime routine (min)</label>
      <input id="routine" type="number" inputmode="numeric" min="0" max="120" bind:value={draft.routine_min} />
    </div>
    <div>
      <label for="lead">Reminder before the routine (min)</label>
      <input id="lead" type="number" inputmode="numeric" min="0" max="120" bind:value={draft.reminder_lead_min} />
    </div>
  </div>

  <h3 style="margin-top: 16px">Starting points</h3>
  <p class="muted">What the app assumes until it has learned from about a week of logging.</p>
  <div class="grid2">
    <div>
      <label for="usual-bed">Usually asleep at</label>
      <input id="usual-bed" type="time" bind:value={draft.usual_bedtime} />
    </div>
    <div>
      <label for="usual-wake">Usually up at</label>
      <input id="usual-wake" type="time" bind:value={draft.usual_wake} />
    </div>
    <div>
      <label for="settle">Time to fall asleep (min)</label>
      <input id="settle" type="number" inputmode="numeric" min="0" max="90" bind:value={draft.settle_min} />
    </div>
    <div>
      <label for="tz">Time zone</label>
      <input id="tz" bind:value={draft.time_zone} />
    </div>
  </div>

  <label for="look">Screen at night</label>
  <div class="chips" id="look" role="group">
    <button aria-pressed={draft.night_look === 'auto'} onclick={() => (draft.night_look = 'auto')}>
      Dim red from the routine to morning
    </button>
    <button aria-pressed={draft.night_look === 'off'} onclick={() => (draft.night_look = 'off')}>Off</button>
  </div>

  {#if error}<p class="flag">{error}</p>{/if}
  <button class="primary" style="width: 100%; margin-top: 16px" onclick={save}>Save</button>

  <hr class="soft" />
  <h3>Reminders on this phone</h3>
  {#if app.push === 'on'}
    <p class="muted">On. This phone hears about the routine {app.settings.reminder_lead_min} min ahead, and when to wake him.</p>
    <div class="row">
      <button onclick={test} disabled={pushBusy}>Send a test</button>
      <button class="ghost" onclick={turnOff} disabled={pushBusy}>Turn off</button>
    </div>
  {:else if app.push === 'off'}
    <button class="primary" onclick={turnOn} disabled={pushBusy}>Turn on reminders</button>
  {:else if app.push === 'needs-install'}
    <p class="muted">
      On an iPhone, reminders work from the home-screen app only: in Safari, tap Share, then Add to Home Screen, and
      open it from there.
    </p>
  {:else if app.push === 'blocked'}
    <p class="muted">Notifications are blocked for this app. Allow them in the phone's settings, then come back.</p>
  {:else if app.push === 'unsupported'}
    <p class="muted">This browser cannot receive reminders. Try the home-screen app in Safari or Chrome.</p>
  {:else}
    <p class="muted">This build has no reminder key yet. See SETUP.md, step 6.</p>
  {/if}
  {#if pushMessage}<p class="muted">{pushMessage}</p>{/if}
</dialog>
