<script lang="ts">
  // Log a screen or a daytime soother from earlier, or correct or remove one.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { fromLocalInput, toLocalInput } from '../format';

  let dialog = $state<HTMLDialogElement | null>(null);
  let start = $state('');
  let end = $state('');
  let note = $state('');
  let error = $state('');
  let confirming = $state(false);

  const tz = $derived(app.settings.time_zone);
  const noun = $derived(ui.habit?.kind === 'soother' ? 'soother' : 'screen');

  $effect(() => {
    const draft = ui.habit;
    if (!draft) {
      dialog?.close();
      return;
    }
    untrack(() => {
      const existing = draft.id ? app.habits.find((h) => h.id === draft.id) : null;
      start = toLocalInput(existing?.start_at ?? new Date(Date.now() - 30 * 60_000).toISOString(), tz);
      end = existing ? (existing.end_at ? toLocalInput(existing.end_at, tz) : '') : toLocalInput(new Date().toISOString(), tz);
      note = existing?.note ?? '';
      error = '';
      confirming = false;
    });
    if (!dialog?.open) dialog?.showModal();
  });

  function close() {
    ui.habit = null;
  }

  async function save() {
    const draft = ui.habit;
    if (!draft) return;
    const startAt = fromLocalInput(start, tz);
    const endAt = fromLocalInput(end, tz);
    if (!startAt) return void (error = 'Give the day and time it started.');
    if (Date.parse(startAt) > Date.now() + 60_000) return void (error = 'That time is still to come.');
    if (endAt && Date.parse(endAt) <= Date.parse(startAt)) return void (error = 'It has to end after it starts.');
    if (endAt && Date.parse(endAt) > Date.now() + 60_000) return void (error = 'The end is still to come.');
    await app.saveHabit(draft.id, draft.kind, startAt, endAt, note.trim() || null);
    close();
  }

  async function remove() {
    const id = ui.habit?.id;
    if (!id) return;
    await app.removeHabit(id);
    close();
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  <div class="spread">
    <h3>{ui.habit?.id ? `Edit ${noun}` : noun === 'screen' ? 'An earlier screen' : 'An earlier soother'}</h3>
    <button class="ghost" onclick={close}>Close</button>
  </div>

  <label for="habit-start">{noun === 'screen' ? 'Screen on' : 'Soother in'}</label>
  <input id="habit-start" type="datetime-local" bind:value={start} />
  <label for="habit-end">{noun === 'screen' ? 'Screen off' : 'Soother out'} (empty if still {noun === 'screen' ? 'on' : 'in'})</label>
  <input id="habit-end" type="datetime-local" bind:value={end} />

  <label for="habit-note">Note (optional)</label>
  <input id="habit-note" bind:value={note} maxlength="200" />

  {#if error}<p class="flag">{error}</p>{/if}
  <button class="primary" style="width: 100%; margin-top: 12px" onclick={save}>Save</button>

  {#if ui.habit?.id}
    <div class="row" style="margin-top: 8px">
      {#if confirming}
        <button style="color: var(--alarm)" onclick={remove}>Really remove</button>
        <button class="ghost" onclick={() => (confirming = false)}>Keep</button>
      {:else}
        <button class="ghost" onclick={() => (confirming = true)}>Remove</button>
      {/if}
    </div>
  {/if}
</dialog>
