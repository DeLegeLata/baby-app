<script lang="ts">
  // Both phones edited the same sleep or date while offline. Show both versions
  // and let whoever is holding the phone settle it.
  import { app } from '../state.svelte';
  import { clockAt, dayLabel, dur, keyLabel } from '../format';
  import { KIND_LABEL, OFF_LABEL, type Bath, type DayRow, type Sleep } from '../model';
  import { netSleepMinutes } from '../engine';

  let dialog = $state<HTMLDialogElement | null>(null);
  const conflict = $derived(app.conflicts[0] ?? null);

  $effect(() => {
    if (conflict) dialog?.showModal();
    else dialog?.close();
  });

  function describe(row: Sleep | DayRow | Bath): string {
    const tz = app.settings.time_zone;
    if ('kind' in row) {
      const start = row.asleep_at ?? row.in_bed_at;
      const from = start ? clockAt(Date.parse(start), tz) : '?';
      const to = row.woke_at ? ` to ${clockAt(Date.parse(row.woke_at), tz)}` : '';
      const length = row.asleep_at ? `, ${dur(netSleepMinutes(row, app.now))}` : '';
      return `${KIND_LABEL[row.kind]} ${from}${to}${length}${row.deleted_at ? ' (deleted)' : ''}`;
    }
    if (!('date' in row)) {
      const at = Date.parse(row.at);
      return `Bath ${dayLabel(at, tz)}, ${clockAt(at, tz)}${row.deleted_at ? ' (removed)' : ''}`;
    }
    const bits = [keyLabel(row.date)];
    if (row.off_tag) bits.push(OFF_LABEL[row.off_tag]);
    if (Object.keys(row.override).length) bits.push('schedule changed');
    if (row.no_nap) bits.push('no nap at daycare');
    return bits.join(', ');
  }
</script>

<dialog bind:this={dialog}>
  {#if conflict}
    <h3>Changed on the other phone</h3>
    <p class="muted">
      This was edited in both places while one phone was offline. Pick the one to keep.
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
