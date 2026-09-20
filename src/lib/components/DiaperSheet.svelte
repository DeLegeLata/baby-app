<script lang="ts">
  // The diaper is already logged by the time this opens: one tap logs it, and
  // this sheet only adds the colour, the wet flag or a different time.
  import { app } from '../state.svelte';
  import { stoolFlagged } from '../model';

  let { entryId = $bindable<string | null>(null) }: { entryId?: string | null } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  const entry = $derived(app.entries.find((e) => e.id === entryId) ?? null);
  const flagged = $derived(stoolFlagged(app.settings, entry?.stool_color ?? null));

  $effect(() => {
    if (entryId) dialog?.showModal();
    else dialog?.close();
  });

  async function setColour(n: number) {
    if (!entry) return;
    await app.editEntry(entry.id, { stool_color: entry.stool_color === n ? null : n });
  }

  async function toggleWet() {
    if (!entry) return;
    await app.editEntry(entry.id, { wet: !entry.wet });
  }

  async function backdate(mins: number) {
    if (!entry) return;
    await app.editEntry(entry.id, {
      started_at: new Date(Date.now() - mins * 60_000).toISOString()
    });
  }
</script>

<dialog bind:this={dialog} onclose={() => (entryId = null)}>
  {#if entry}
    <div class="row" style="justify-content: space-between">
      <h3>Logged: {entry.wet ? 'wet' : ''}{entry.wet && entry.dirty ? ' + ' : ''}{entry.dirty ? 'dirty' : ''}</h3>
      <button class="ghost" onclick={() => (entryId = null)}>Done</button>
    </div>

    {#if entry.dirty}
      <label for="colours">Stool colour (British Columbia card)</label>
      <div class="colours" id="colours">
        {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as n}
          <button aria-pressed={entry.stool_color === n} onclick={() => setColour(n)}>{n}</button>
        {/each}
      </div>
      {#if flagged}
        <p class="flag">
          This colour may mean a liver or gut problem. Photograph the diaper and contact your doctor.
        </p>
      {:else if entry.stool_color !== null}
        <p class="muted">Colour {entry.stool_color} is in the normal range.</p>
      {:else}
        <p class="muted">Colour is optional.</p>
      {/if}
    {/if}

    <label for="when">Happened</label>
    <div class="row" id="when">
      {#each [0, 5, 10, 15, 30] as mins}
        <button onclick={() => backdate(mins)}>{mins === 0 ? 'now' : `${mins} min ago`}</button>
      {/each}
    </div>

    <button style="width: 100%; margin-top: 12px" onclick={toggleWet}>
      {entry.wet ? 'Not wet after all' : 'Wet as well'}
    </button>
  {/if}
</dialog>
