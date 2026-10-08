<script lang="ts">
  // Today at a glance: the fixed times that apply, and every sleep that
  // belongs to today (last night included). The daycare nap has its own card.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { clock12, clockAt, dur, keyLabel } from '../format';
  import { KIND_LABEL, MOOD_LABEL, OFF_LABEL, PLACE_LABEL, type Sleep } from '../model';
  import { netSleepMinutes } from '../engine';
  import { addDays } from '../time';

  const tz = $derived(app.settings.time_zone);
  const sched = $derived(app.todaySchedule);
  const sleeps = $derived([
    ...app.sleepsOn(addDays(app.today, -1)).filter((s) => s.kind === 'night'),
    ...app.sleepsOn(app.today)
  ]);

  const fixed = $derived.by(() => {
    const out: string[] = [];
    if (sched.mustBeUp !== null) out.push(`Up by ${clock12(sched.mustBeUp)}`);
    // On a daycare day the Daycare card shows the nap.
    if (!sched.daycare && sched.napStart !== null && sched.napEnd !== null) {
      out.push(`Nap ${clock12(sched.napStart)} to ${clock12(sched.napEnd)}`);
    }
    if (sched.latestBedtime !== null) out.push(`Asleep by ${clock12(sched.latestBedtime)} at the latest`);
    for (const w of sched.noSleep) {
      out.push(`Stay awake ${clock12(w.start)} to ${clock12(w.end)}${w.label ? ` (${w.label})` : ''}`);
    }
    return out;
  });

  function describe(s: Sleep): string {
    const start = s.asleep_at ?? s.in_bed_at!;
    const range = `${clockAt(Date.parse(start), tz)}${s.woke_at ? ` to ${clockAt(Date.parse(s.woke_at), tz)}` : ', still going'}`;
    const bits = [range];
    if (s.asleep_at) bits.push(dur(netSleepMinutes(s, app.now)));
    if (s.wakings.length) bits.push(`${s.wakings.length} waking${s.wakings.length === 1 ? '' : 's'}`);
    if (s.place && s.place !== 'bed') bits.push(PLACE_LABEL[s.place].toLowerCase());
    if (s.mood) bits.push(MOOD_LABEL[s.mood].toLowerCase());
    return bits.join(' · ');
  }
</script>

<section class="card">
  <div class="spread">
    <h3>Today, {keyLabel(app.today)}</h3>
    <span class="tag">{sched.daycare ? 'Daycare day' : 'Home day'}</span>
  </div>

  {#if sched.off || sched.overridden}
    <p class="muted" style="margin: 6px 0 0">
      {#if sched.off}<span class="tag">{OFF_LABEL[sched.off]}</span> Left out of the learning.{/if}
      {#if sched.overridden}<span class="tag">Schedule changed</span>{/if}
    </p>
  {/if}

  {#if fixed.length}
    <ul class="reasons">
      {#each fixed as line}<li>{line}</li>{/each}
    </ul>
  {/if}

  {#if sleeps.length}
    <ul class="sleeps" style="margin-top: 8px">
      {#each sleeps as s (s.id)}
        <li>
          <span class="key {s.kind}" aria-hidden="true"></span>
          <span class="what">
            <b>{KIND_LABEL[s.kind]}</b>
            <span class="muted">{describe(s)}</span>
          </span>
          <button class="ghost" onclick={() => ui.editSleep(s.id)}>Edit</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">Nothing logged yet today.</p>
  {/if}

  <div class="row" style="margin-top: 10px">
    <button onclick={() => (ui.day = app.today)}>Change today</button>
    <button onclick={() => (ui.day = addDays(app.today, 1))}>Change tomorrow</button>
  </div>
  <button class="link" style="margin-top: 8px" onclick={() => ui.newSleep()}>Add a sleep from earlier</button>
</section>
