<script lang="ts">
  // "Fell asleep" without being put to bed: usually a catnap in the car.
  import { app } from '../state.svelte';
  import { ui } from '../ui.svelte';
  import { guessKind } from '../engine';
  import { KIND_LABEL, PLACES, PLACE_LABEL, SLEEP_KINDS, type Place, type SleepKind } from '../model';

  let dialog = $state<HTMLDialogElement | null>(null);
  let kind = $state<SleepKind>('nap');
  let place = $state<Place | null>(null);

  $effect(() => {
    if (ui.asleep) {
      kind = guessKind(app.input, 'asleep', Date.now());
      place = kind === 'catnap' ? 'car' : 'bed';
      dialog?.showModal();
    } else {
      dialog?.close();
    }
  });

  async function now() {
    await app.fellAsleep(kind, place ?? undefined);
    ui.asleep = false;
  }

  function earlier() {
    ui.asleep = false;
    ui.newSleep({ kind, place, asleep_at: new Date().toISOString() });
  }
</script>

<dialog bind:this={dialog} onclose={() => (ui.asleep = false)}>
  <div class="spread">
    <h3>Fell asleep</h3>
    <button class="ghost" onclick={() => (ui.asleep = false)}>Close</button>
  </div>

  <label for="asleep-kind">Kind</label>
  <div class="chips" id="asleep-kind" role="group">
    {#each SLEEP_KINDS as k}
      <button aria-pressed={kind === k} onclick={() => (kind = k)}>{KIND_LABEL[k]}</button>
    {/each}
  </div>

  <label for="asleep-place">Where</label>
  <div class="chips" id="asleep-place" role="group">
    {#each PLACES as p}
      <button aria-pressed={place === p} onclick={() => (place = place === p ? null : p)}>{PLACE_LABEL[p]}</button>
    {/each}
  </div>

  <button class="primary" style="width: 100%; margin-top: 16px" onclick={now}>Asleep now</button>
  <button class="ghost" style="width: 100%; margin-top: 8px" onclick={earlier}>He fell asleep earlier...</button>
</dialog>
