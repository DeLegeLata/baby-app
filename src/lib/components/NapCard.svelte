<script lang="ts">
  // Today's nap, adjusted where it is seen: daycare's nap on a daycare day, his
  // nap at home on any other, where the card also suggests when to have it.
  // Times still to come are the day's plan; times already past are what
  // happened. Either way tonight's bedtime follows at once, and the card shows it.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { clock12, clockAt, dur, tidy } from '../format';
  import { netSleepMinutes } from '../engine';
  import { clockString, isoWeekday, minutesOf, parseClock } from '../time';

  const tz = $derived(app.settings.time_zone);
  const date = $derived(app.today);
  const sched = $derived(app.todaySchedule);
  const usualDays = $derived(app.settings.daycare_days.includes(isoWeekday(date)));
  const template = $derived(app.settings.schedule);
  const nap = $derived(app.napOn(date));
  // In bed or asleep right now: the buttons at the foot of the screen log it.
  const live = $derived(Boolean(nap && !nap.woke_at));
  const override = $derived(app.dayRow(date)?.override ?? {});
  const changedWindow = $derived(Boolean(override.nap_start && override.nap_end));
  // The nap to aim for on a home day; daycare sets its own.
  const suggestion = $derived(app.napSuggestion);
  const suggestedOver = $derived(suggestion !== null && minutesOf(date, app.minute, tz) > suggestion.upBy);

  let from = $state('');
  let to = $state('');
  let error = $state('');
  let saved = $state('');
  let confirmRemove = $state(false);
  let filledFor = '';

  // Fill the times from what is saved for today: the nap if it is in, else the
  // day's own window, else the suggested nap. Refilled when that changes, never
  // while typing.
  const source = $derived(
    `${date}|${nap?.asleep_at ?? ''}|${nap?.woke_at ?? ''}|${sched.napStart}|${sched.napEnd}|${changedWindow}|${suggestion?.asleepBy}|${suggestion?.upBy}`
  );
  $effect(() => {
    void source;
    untrack(fill);
  });

  function fill() {
    const usualStart = template.nap_start ? parseClock(template.nap_start) : 12 * 60 + 30;
    const usualEnd = template.nap_end ? parseClock(template.nap_end) : 14 * 60 + 30;
    if (nap?.asleep_at && nap.woke_at) {
      from = clockString(minutesOf(date, nap.asleep_at, tz));
      to = clockString(minutesOf(date, nap.woke_at, tz));
    } else if (suggestion && !changedWindow) {
      from = clockString(suggestion.asleepBy);
      to = clockString(suggestion.upBy);
    } else {
      from = clockString(sched.napStart ?? usualStart);
      to = clockString(sched.napEnd ?? usualEnd);
    }
    error = '';
    confirmRemove = false;
    if (filledFor !== date) saved = '';
    filledFor = date;
  }

  const status = $derived.by(() => {
    if (nap?.asleep_at && nap.woke_at) {
      const a = clockAt(Date.parse(nap.asleep_at), tz);
      const b = clockAt(Date.parse(nap.woke_at), tz);
      return tidy(`Napped ${a} to ${b} (${dur(netSleepMinutes(nap, app.now))}).`);
    }
    // The status card above has the running times.
    if (nap?.asleep_at) return 'He is asleep now. Check the times here once he is up.';
    if (nap) return 'He is in bed, not asleep yet.';
    if (sched.noNap) return sched.daycare ? 'Daycare says he did not nap today.' : 'He did not nap today.';
    const usual =
      template.nap_start && template.nap_end
        ? `${clock12(parseClock(template.nap_start))} to ${clock12(parseClock(template.nap_end))}`
        : null;
    if (changedWindow && sched.napStart !== null && sched.napEnd !== null) {
      const other = suggestion
        ? `suggested ${clock12(suggestion.asleepBy)} to ${clock12(suggestion.upBy)}`
        : usual
          ? `usually ${usual}`
          : '';
      return tidy(
        `Planned for today: ${clock12(sched.napStart)} to ${clock12(sched.napEnd)}${other ? ` (${other})` : ''}.`
      );
    }
    if (sched.daycare) {
      return usual
        ? tidy(`Usually ${usual}. Change the times if today is different, and enter their report at pickup.`)
        : 'Enter the nap times from their report at pickup.';
    }
    if (suggestion) {
      return tidy(
        suggestedOver
          ? `Today's suggested nap was ${clock12(suggestion.asleepBy)} to ${clock12(suggestion.upBy)}. Enter the times he really slept.`
          : `Suggested today: in bed ${clock12(suggestion.inBed)}, asleep by ${clock12(suggestion.asleepBy)}, up by ${clock12(suggestion.upBy)}. Enter the real times once he is up.`
      );
    }
    return 'Enter the nap times once he is up.';
  });

  async function save() {
    error = '';
    saved = '';
    if (!from || !to) return void (error = 'Give both times.');
    const result = await app.setNap(date, from, to);
    if (result.kind === 'error') return void (error = result.message);
    if (result.kind === 'actual') saved = "Saved as today's nap.";
    else if (sched.daycare) saved = "Saved as today's plan. Update it with their report at pickup.";
    else saved = "Saved as today's plan. Enter the real times once he is up.";
  }

  async function removeNap() {
    if (!nap) return;
    await app.removeSleep(nap.id);
    saved = '';
  }

  async function useUsual() {
    await app.usualNapWindow(date);
    saved = '';
  }

  async function setNoNap(noNap: boolean) {
    await app.setNoNap(date, noNap);
    saved = '';
  }
</script>

<section class="card">
  <div class="spread">
    <h3>{sched.daycare ? 'Daycare' : 'Nap'}</h3>
    {#if sched.daycare}<span class="tag">Today</span>{/if}
  </div>

  <p class="muted" style="margin: 6px 0 4px">{status}</p>

  {#if !live}
    {#if suggestion && !nap && !sched.noNap}
      <details>
        <summary>Why these times?</summary>
        <ul>
          {#each suggestion.reasons as reason}<li>{reason}</li>{/each}
        </ul>
      </details>
    {/if}
    {#if changedWindow && !nap}
      <button class="link" onclick={useUsual}>{suggestion ? 'Use the suggested time' : 'Use the usual time'}</button>
    {/if}

    <div class="grid2">
      <div>
        <label for="nap-from">Nap from</label>
        <input id="nap-from" type="time" bind:value={from} />
      </div>
      <div>
        <label for="nap-to">to</label>
        <input id="nap-to" type="time" bind:value={to} />
      </div>
    </div>

    <div class="row" style="margin-top: 10px">
      <button class="primary" onclick={save}>Save nap</button>
      {#if nap}
        {#if confirmRemove}
          <button style="color: var(--alarm)" onclick={removeNap}>Really remove</button>
          <button class="ghost" onclick={() => (confirmRemove = false)}>Keep</button>
        {:else}
          <button class="ghost" onclick={() => (confirmRemove = true)}>Remove nap</button>
        {/if}
      {:else if sched.noNap}
        <button onclick={() => setNoNap(false)}>He napped after all</button>
      {:else}
        <button onclick={() => setNoNap(true)}>He did not nap</button>
      {/if}
    </div>

    {#if error}<p class="flag">{error}</p>{/if}
    {#if saved}<p class="muted" style="margin: 8px 0 0">{saved}</p>{/if}
  {/if}

  {#if app.bedtime}
    <p style="margin: 8px 0 0">
      Tonight: asleep by <b>{clockAt(app.bedtime.asleepBy, tz)}</b>
    </p>
  {/if}

  {#if sched.daycare}
    <button class="link" style="margin-top: 6px" onclick={() => app.setDaycare(date, false)}>No daycare today</button>
  {:else if usualDays}
    <button class="link" style="margin-top: 6px" onclick={() => app.setDaycare(date, true)}>He is at daycare after all</button>
  {/if}
</section>
