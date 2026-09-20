<script lang="ts">
  // Both phones edited the same entry while offline. Show both versions and let
  // whoever is holding the phone settle it.
  import { app } from '../state.svelte';
  import { clock, mmss } from '../format';
  import type { Entry, EntryRow } from '../model';

  let dialog = $state<HTMLDialogElement | null>(null);
  const conflict = $derived(app.conflicts[0] ?? null);

  $effect(() => {
    if (conflict) dialog?.showModal();
    else dialog?.close();
  });

  function describe(entry: Entry | EntryRow): string {
    const when = clock(entry.started_at, app.settings);
    if (entry.kind === 'diaper') {
      const bits = [entry.wet ? 'wet' : null, entry.dirty ? 'dirty' : null].filter(Boolean);
      return `${when} - ${bits.join(' + ') || 'diaper'}${entry.stool_color ? `, colour ${entry.stool_color}` : ''}`;
    }
    if (entry.feed_method === 'bottle') return `${when} - bottle ${entry.bottle_ml ?? 0} ml`;
    return `${when} - nursing L ${mmss(entry.left_sec ?? 0)} / R ${mmss(entry.right_sec ?? 0)}`;
  }
</script>

<dialog bind:this={dialog}>
  {#if conflict}
    <h3>Changed on the other phone</h3>
    <p class="muted">
      This entry was edited in both places while you were offline. Pick the one to keep.
    </p>

    <button style="width: 100%" onclick={() => app.resolve(conflict, 'local')}>
      Keep this phone<br /><span class="muted">{describe(conflict.local)}</span>
    </button>
    <button style="width: 100%; margin-top: 8px" onclick={() => app.resolve(conflict, 'remote')}>
      Keep the other phone<br /><span class="muted">{describe(conflict.remote)}</span>
    </button>

    {#if app.conflicts.length > 1}
      <p class="muted">{app.conflicts.length - 1} more to settle after this one.</p>
    {/if}
  {/if}
</dialog>
