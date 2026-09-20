<script lang="ts">
  import { app } from '../state.svelte';
  import { clock, mmss, toLocalInput } from '../format';
  import { stoolFlagged, type Entry } from '../model';
  import { fromLocal } from '../rule';

  let editing = $state<Entry | null>(null);
  let startInput = $state('');
  let dialog = $state<HTMLDialogElement | null>(null);
  let confirming = $state(false);

  $effect(() => {
    if (editing) dialog?.showModal();
    else dialog?.close();
  });

  function describe(entry: Entry): string {
    if (entry.kind === 'diaper') {
      const bits = [entry.wet ? 'Wet' : null, entry.dirty ? 'Dirty' : null].filter(Boolean);
      const colour = entry.stool_color ? ` (colour ${entry.stool_color})` : '';
      return `${bits.join(' + ') || 'Diaper'}${colour}`;
    }
    if (entry.feed_method === 'bottle') {
      return `Bottle ${entry.bottle_ml ?? 0} ml ${entry.milk_type === 'breast' ? 'breast milk' : 'formula'}`;
    }
    const left = entry.left_sec ?? 0;
    const right = entry.right_sec ?? 0;
    const sides = left || right ? ` L ${mmss(left)} / R ${mmss(right)}` : '';
    return `${entry.ended_at ? 'Nursing' : 'Nursing (running)'}${sides}`;
  }

  function edit(entry: Entry) {
    editing = entry;
    confirming = false;
    startInput = toLocalInput(entry.started_at, app.settings);
  }

  async function saveStart() {
    if (!editing) return;
    const [date, time] = startInput.split('T');
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const at = fromLocal(app.settings.time_zone, y, m, d, hh, mm, 0);
    await app.editEntry(editing.id, { started_at: new Date(at).toISOString() });
    editing = null;
  }

  async function remove() {
    if (!editing) return;
    await app.removeEntry(editing.id);
    editing = null;
  }
</script>

<section class="card">
  <h3>Timeline</h3>
  {#if app.entries.length === 0}
    <p class="muted">Nothing logged yet.</p>
  {:else}
    <ul class="timeline">
      {#each app.entries.slice(0, 40) as entry (entry.id)}
        <li>
          <time>{clock(entry.started_at, app.settings)}</time>
          <span class="what" class:flag={stoolFlagged(app.settings, entry.stool_color)}>
            {describe(entry)}
          </span>
          {#if !entry.synced}<span class="muted" title="not sent yet">&#9679;</span>{/if}
          <button class="ghost" onclick={() => edit(entry)}>Edit</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<dialog bind:this={dialog} onclose={() => (editing = null)}>
  {#if editing}
    <div class="row" style="justify-content: space-between">
      <h3>Edit entry</h3>
      <button class="ghost" onclick={() => (editing = null)}>Close</button>
    </div>
    <p class="muted">{describe(editing)}</p>

    <label for="start">Started</label>
    <input id="start" type="datetime-local" bind:value={startInput} />

    <div class="row" style="margin-top: 12px">
      <button class="primary" onclick={saveStart}>Save</button>
      {#if confirming}
        <button style="color: var(--alarm)" onclick={remove}>Really delete</button>
        <button class="ghost" onclick={() => (confirming = false)}>Keep</button>
      {:else}
        <button class="ghost" onclick={() => (confirming = true)}>Delete</button>
      {/if}
    </div>
    <p class="muted">Deleting removes it from both phones. There is no bin yet.</p>
  {/if}
</dialog>
