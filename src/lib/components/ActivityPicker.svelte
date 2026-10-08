<script lang="ts">
  // What he did before a sleep: a drop-down adds an activity, a chip takes one off.
  import { ACTIVITIES, ACTIVITY_LABEL, type Activity } from '../model';

  let {
    selected,
    onchange,
    id = 'activities'
  }: { selected: Activity[]; onchange: (next: Activity[]) => void; id?: string } = $props();

  const chosen = $derived(ACTIVITIES.filter((a) => selected.includes(a)));
  const remaining = $derived(ACTIVITIES.filter((a) => !selected.includes(a)));

  function add(event: Event & { currentTarget: HTMLSelectElement }) {
    const value = event.currentTarget.value as Activity | '';
    event.currentTarget.value = '';
    if (value) onchange([...chosen, value]);
  }
</script>

{#if chosen.length}
  <div class="chips" role="group" aria-label="Chosen activities">
    {#each chosen as activity}
      <button
        aria-pressed="true"
        aria-label="Remove {ACTIVITY_LABEL[activity]}"
        onclick={() => onchange(chosen.filter((a) => a !== activity))}
      >
        {ACTIVITY_LABEL[activity]} &times;
      </button>
    {/each}
  </div>
{/if}
{#if remaining.length}
  <select {id} onchange={add} style={chosen.length ? 'margin-top: 6px' : ''}>
    <option value="">{chosen.length ? 'Add another...' : 'Choose what he did...'}</option>
    {#each remaining as activity}
      <option value={activity}>{ACTIVITY_LABEL[activity]}</option>
    {/each}
  </select>
{/if}
