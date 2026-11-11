<script lang="ts">
  // Add his weight and height on a date, or correct or remove a measurement.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { dateKey } from '../time';
  import { birthKey, imperial } from '../growth';

  let dialog = $state<HTMLDialogElement | null>(null);
  let date = $state('');
  let weight = $state('');
  let height = $state('');
  let note = $state('');
  let error = $state('');
  let confirming = $state(false);

  const today = $derived(dateKey(app.now, app.settings.time_zone));

  $effect(() => {
    const draft = ui.growth;
    if (!draft) {
      dialog?.close();
      return;
    }
    untrack(() => {
      const existing = draft.id ? app.growth.find((g) => g.id === draft.id) : null;
      date = existing?.measured_on ?? today;
      weight = existing?.weight_g != null ? String(existing.weight_g / 1000) : '';
      height = existing?.height_mm != null ? String(existing.height_mm / 10) : '';
      note = existing?.note ?? '';
      error = '';
      confirming = false;
    });
    if (!dialog?.open) dialog?.showModal();
  });

  /** A typed number, with a comma accepted for the decimal point; null when left empty. */
  const num = (text: string) => {
    const t = text.trim().replace(',', '.');
    return t === '' ? null : Number(t);
  };
  const kg = $derived(num(weight));
  const cm = $derived(num(height));
  const kgOk = $derived(kg !== null && kg >= 0.5 && kg <= 60);
  const cmOk = $derived(cm !== null && cm >= 30 && cm <= 160);

  function close() {
    ui.growth = null;
  }

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return void (error = 'Give the date of the measurement.');
    if (date > today) return void (error = 'That date is still to come.');
    const birth = birthKey(app.child.birth_at);
    if (birth && date < birth) return void (error = 'That date is before his birth date in Settings.');
    if (kg === null && cm === null) return void (error = 'Give a weight, a height or both.');
    if (kg !== null && !kgOk) return void (error = 'Give the weight in kilograms, such as 12.4.');
    if (cm !== null && !cmOk) return void (error = 'Give the height in centimetres, such as 87.5.');
    const fields = {
      measured_on: date,
      weight_g: kg === null ? null : Math.round(kg * 1000),
      height_mm: cm === null ? null : Math.round(cm * 10),
      note: note.trim() || null
    };
    const id = ui.growth?.id;
    if (id) await app.saveGrowth(id, fields);
    else await app.addGrowth(fields);
    close();
  }

  async function remove() {
    const id = ui.growth?.id;
    if (!id) return;
    await app.removeGrowth(id);
    close();
  }
</script>

<dialog bind:this={dialog} onclose={close}>
  <div class="spread">
    <h3>{ui.growth?.id ? 'Edit measurement' : 'Add a measurement'}</h3>
    <button class="ghost" onclick={close}>Close</button>
  </div>

  <label for="growth-date">Measured on</label>
  <input id="growth-date" type="date" max={today} bind:value={date} />

  <div class="grid2">
    <div>
      <label for="growth-weight">Weight (kg)</label>
      <input id="growth-weight" inputmode="decimal" placeholder="12.4" bind:value={weight} autocomplete="off" />
      {#if kgOk}<p class="muted" style="margin: 4px 0 0">{imperial(kg!, 'weight')}</p>{/if}
    </div>
    <div>
      <label for="growth-height">Height (cm)</label>
      <input id="growth-height" inputmode="decimal" placeholder="87.5" bind:value={height} autocomplete="off" />
      {#if cmOk}<p class="muted" style="margin: 4px 0 0">{imperial(cm!, 'height')}</p>{/if}
    </div>
  </div>
  <p class="muted" style="margin: 6px 0 0">Either one is fine on its own.</p>

  <label for="growth-note">Note (optional)</label>
  <input id="growth-note" bind:value={note} maxlength="200" placeholder="18-month checkup" />

  {#if error}<p class="flag">{error}</p>{/if}
  <button class="primary" style="width: 100%; margin-top: 12px" onclick={save}>Save</button>

  {#if ui.growth?.id}
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
