<script lang="ts">
  // Add a sleep after the fact, or correct one. Times are entered in the
  // household time zone.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { ui, type SleepDraft } from '../ui.svelte';
  import { fromLocalInput, toLocalInput } from '../format';
  import {
    KIND_LABEL,
    MOODS,
    MOOD_LABEL,
    PLACES,
    PLACE_LABEL,
    SLEEP_KINDS,
    type Mood,
    type Place,
    type SleepKind
  } from '../model';

  let dialog = $state<HTMLDialogElement | null>(null);
  let kind = $state<SleepKind>('nap');
  let inBed = $state('');
  let asleep = $state('');
  let woke = $state('');
  let wakings = $state<{ start: string; end: string }[]>([]);
  let place = $state<Place | null>(null);
  let mood = $state<Mood | null>(null);
  let note = $state('');
  let error = $state('');
  let confirming = $state(false);

  const tz = $derived(app.settings.time_zone);
  const editing = $derived(ui.sleep?.id ? (app.sleeps.find((s) => s.id === ui.sleep!.id) ?? null) : null);
  const input = (iso: string | null | undefined) => (iso ? toLocalInput(iso, tz) : '');

  // Load the form when the sheet opens, and only then: a sync from the other
  // phone must not wipe an edit in progress.
  $effect(() => {
    const draft = ui.sleep;
    if (!draft) {
      dialog?.close();
      return;
    }
    untrack(() => load(draft));
    if (!dialog?.open) dialog?.showModal();
  });

  function load(draft: SleepDraft) {
    const s = draft.id ? app.sleeps.find((x) => x.id === draft.id) : null;
    const src = { ...(s ?? {}), ...draft.preset };
    kind = (src.kind as SleepKind) ?? 'nap';
    inBed = input(src.in_bed_at);
    asleep = input(src.asleep_at) || (draft.id ? '' : toLocalInput(new Date().toISOString(), tz));
    woke = input(src.woke_at);
    wakings = (src.wakings ?? []).map((w) => ({ start: input(w.start), end: input(w.end) }));
    place = (src.place as Place | null) ?? null;
    mood = (src.mood as Mood | null) ?? null;
    note = (src.note as string | null) ?? '';
    error = '';
    confirming = false;
  }

  function close() {
    ui.sleep = null;
  }

  async function save() {
    const inBedAt = fromLocalInput(inBed, tz);
    const asleepAt = fromLocalInput(asleep, tz);
    const wokeAt = fromLocalInput(woke, tz);
    if (!asleepAt && !inBedAt) return void (error = 'Give at least the time he fell asleep.');
    if (inBedAt && asleepAt && Date.parse(inBedAt) > Date.parse(asleepAt)) {
      return void (error = 'He cannot fall asleep before he is in bed.');
    }
    if (asleepAt && wokeAt && Date.parse(wokeAt) <= Date.parse(asleepAt)) {
      return void (error = 'He has to wake after he fell asleep.');
    }
    for (const at of [inBedAt, asleepAt, wokeAt]) {
      if (at && Date.parse(at) > Date.now() + 60_000) return void (error = 'That time is still to come.');
    }
    const nightWakings: { start: string; end: string | null }[] = [];
    if (kind === 'night') {
      for (const w of wakings) {
        const start = fromLocalInput(w.start, tz);
        const end = fromLocalInput(w.end, tz);
        if (!start) continue;
        if (asleepAt && Date.parse(start) < Date.parse(asleepAt)) {
          return void (error = 'A night waking starts before he fell asleep.');
        }
        if (end && Date.parse(end) <= Date.parse(start)) {
          return void (error = 'A night waking ends before it starts.');
        }
        if (wokeAt && (Date.parse(start) >= Date.parse(wokeAt) || (end && Date.parse(end) > Date.parse(wokeAt)))) {
          return void (error = 'A night waking runs past the morning wake.');
        }
        nightWakings.push({ start, end });
      }
      nightWakings.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    }
    await app.saveSleep(ui.sleep?.id ?? null, kind, {
      in_bed_at: inBedAt,
      asleep_at: asleepAt,
      woke_at: wokeAt,
      wakings: nightWakings,
      place,
      mood,
      note: note.trim() || null
    });
    close();
  }

  async function remove() {
    if (!ui.sleep?.id) return;
    await app.removeSleep(ui.sleep.id);
    close();
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  <div class="spread">
    <h3>{ui.sleep?.id ? 'Edit sleep' : 'Add a sleep'}</h3>
    <button class="ghost" onclick={close}>Close</button>
  </div>

  <label for="sleep-kind">Kind</label>
  <div class="chips" id="sleep-kind" role="group">
    {#each SLEEP_KINDS as k}
      <button aria-pressed={kind === k} onclick={() => (kind = k)}>{KIND_LABEL[k]}</button>
    {/each}
  </div>

  <label for="in-bed">In bed (optional)</label>
  <input id="in-bed" type="datetime-local" bind:value={inBed} />
  <label for="asleep">Fell asleep</label>
  <input id="asleep" type="datetime-local" bind:value={asleep} />
  <label for="woke">{kind === 'night' ? 'Up for the day' : 'Woke'} (leave empty if still asleep)</label>
  <input id="woke" type="datetime-local" bind:value={woke} />

  {#if kind === 'night'}
    <label for="wakings">Night wakings</label>
    <div id="wakings">
      {#each wakings as w, i}
        <div class="entry">
          <div class="spread">
            <b>Waking {i + 1}</b>
            <button class="ghost" onclick={() => wakings.splice(i, 1)}>Remove</button>
          </div>
          <label for="waking-start-{i}">Woke</label>
          <input id="waking-start-{i}" type="datetime-local" bind:value={w.start} />
          <label for="waking-end-{i}">Back asleep (empty if still awake)</label>
          <input id="waking-end-{i}" type="datetime-local" bind:value={w.end} />
        </div>
      {/each}
      <button style="margin-top: 8px" onclick={() => wakings.push({ start: asleep, end: '' })}>Add a waking</button>
    </div>
  {/if}

  <label for="place">Where</label>
  <div class="chips" id="place" role="group">
    {#each PLACES as p}
      <button aria-pressed={place === p} onclick={() => (place = place === p ? null : p)}>{PLACE_LABEL[p]}</button>
    {/each}
  </div>

  <label for="mood">Mood on waking</label>
  <div class="chips" id="mood" role="group">
    {#each MOODS as m}
      <button aria-pressed={mood === m} onclick={() => (mood = mood === m ? null : m)}>{MOOD_LABEL[m]}</button>
    {/each}
  </div>

  <label for="note">Note</label>
  <textarea id="note" bind:value={note} maxlength="500"></textarea>

  {#if error}<p class="flag">{error}</p>{/if}

  <button class="primary" style="width: 100%; margin-top: 12px" onclick={save}>Save</button>

  {#if editing}
    <div class="row" style="margin-top: 8px">
      {#if confirming}
        <button style="color: var(--alarm)" onclick={remove}>Really delete</button>
        <button class="ghost" onclick={() => (confirming = false)}>Keep</button>
      {:else}
        <button class="ghost" onclick={() => (confirming = true)}>Delete</button>
      {/if}
    </div>
    <p class="muted">Deleting removes it from both phones.</p>
  {/if}
</dialog>
