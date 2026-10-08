<script lang="ts">
  // Log a bath given earlier, or correct or remove one.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { fromLocalInput, toLocalInput } from '../format';

  let dialog = $state<HTMLDialogElement | null>(null);
  let when = $state('');
  let note = $state('');
  let error = $state('');
  let confirming = $state(false);

  const tz = $derived(app.settings.time_zone);

  $effect(() => {
    const draft = ui.bath;
    if (!draft) {
      dialog?.close();
      return;
    }
    untrack(() => {
      const existing = draft.id ? app.baths.find((b) => b.id === draft.id) : null;
      when = toLocalInput(existing?.at ?? new Date().toISOString(), tz);
      note = existing?.note ?? '';
      error = '';
      confirming = false;
    });
    if (!dialog?.open) dialog?.showModal();
  });

  function close() {
    ui.bath = null;
  }

  async function save() {
    const at = fromLocalInput(when, tz);
    if (!at) return void (error = 'Give the day and time of the bath.');
    if (Date.parse(at) > Date.now() + 60_000) return void (error = 'That time is still to come.');
    const id = ui.bath?.id;
    if (id) await app.saveBath(id, at, note.trim() || null);
    else await app.logBath(at, note.trim() || null);
    close();
  }

  async function remove() {
    const id = ui.bath?.id;
    if (!id) return;
    await app.removeBath(id);
    close();
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  <div class="spread">
    <h3>{ui.bath?.id ? 'Edit bath' : 'An earlier bath'}</h3>
    <button class="ghost" onclick={close}>Close</button>
  </div>

  <label for="bath-when">When</label>
  <input id="bath-when" type="datetime-local" bind:value={when} />

  <label for="bath-note">Note (optional)</label>
  <input id="bath-note" bind:value={note} maxlength="200" />

  {#if error}<p class="flag">{error}</p>{/if}
  <button class="primary" style="width: 100%; margin-top: 12px" onclick={save}>Save</button>

  {#if ui.bath?.id}
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
