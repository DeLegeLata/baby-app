<script lang="ts">
  // Today's daycare nap, adjusted where it is seen. Times still to come are the
  // day's plan; times already past are what happened. Either way tonight's
  // bedtime follows at once, and the card shows it.
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
  const nap = $derived(app.daycareNap(date));
  const override = $derived(app.dayRow(date)?.override ?? {});
  const changedWindow = $derived(Boolean(override.nap_start && override.nap_end));

  let from = $state('');
  let to = $state('');
  let error = $state('');
  let saved = $state('');
  let confirmRemove = $state(false);
  let filledFor = '';

  // Fill the times from what is saved for today: the nap if it is in, else
  // today's window. Refilled when that changes, never while typing.
  const source = $derived(
    `${date}|${nap?.asleep_at ?? ''}|${nap?.woke_at ?? ''}|${sched.napStart}|${sched.napEnd}`
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
    if (sched.noNap) return 'Daycare says he did not nap today.';
    const usual =
      template.nap_start && template.nap_end
        ? `${clock12(parseClock(template.nap_start))} to ${clock12(parseClock(template.nap_end))}`
        : null;
    if (changedWindow && sched.napStart !== null && sched.napEnd !== null) {
      return tidy(
        `Planned for today: ${clock12(sched.napStart)} to ${clock12(sched.napEnd)}${usual ? ` (usually ${usual})` : ''}.`
      );
    }
    return usual
      ? tidy(`Usually ${usual}. Change the times if today is different, and enter their report at pickup.`)
      : 'Enter the nap times from their report at pickup.';
  });

  async function save() {
    error = '';
    saved = '';
    if (!from || !to) return void (error = 'Give both times.');
    const result = await app.setDaycareNap(date, from, to);
    if (result.kind === 'error') return void (error = result.message);
    saved =
      result.kind === 'plan'
        ? "Saved as today's plan. Update it with their report at pickup."
        : "Saved as today's nap.";
  }

  async function removeNap() {
    if (!nap) return;
    await app.removeSleep(nap.id);
    saved = '';
  }
</script>

{#if usualDays || sched.daycare}
  <section class="card">
    <div class="spread">
      <h3>Daycare</h3>
      {#if sched.daycare}<span class="tag">Today</span>{/if}
    </div>

    {#if !sched.daycare}
      <p class="muted" style="margin: 6px 0 8px">No daycare today.</p>
      <button class="ghost" onclick={() => app.setDaycare(date, true)}>He is at daycare after all</button>
    {:else}
      <p class="muted" style="margin: 6px 0 4px">{status}</p>
      {#if changedWindow && !nap}
        <button class="link" onclick={() => app.usualNapWindow(date)}>Use the usual time</button>
      {/if}

      <div class="grid2">
        <div>
          <label for="daycare-from">Nap from</label>
          <input id="daycare-from" type="time" bind:value={from} />
        </div>
        <div>
          <label for="daycare-to">to</label>
          <input id="daycare-to" type="time" bind:value={to} />
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
          <button onclick={() => app.setNoNap(date, false)}>He napped after all</button>
        {:else}
          <button onclick={() => app.setNoNap(date, true)}>He did not nap</button>
        {/if}
      </div>

      {#if error}<p class="flag">{error}</p>{/if}
      {#if saved}<p class="muted" style="margin: 8px 0 0">{saved}</p>{/if}
      {#if app.bedtime}
        <p style="margin: 8px 0 0">
          Tonight: asleep by <b>{clockAt(app.bedtime.asleepBy, tz)}</b>
        </p>
      {/if}

      <button class="link" style="margin-top: 6px" onclick={() => app.setDaycare(date, false)}>No daycare today</button>
    {/if}
  </section>
{/if}
