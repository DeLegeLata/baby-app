<script lang="ts">
  import { app } from '../state.svelte';
  import { settingsSchema, type AppSettings } from '../model';
  import { toLocalInput } from '../format';
  import { fromLocal } from '../rule';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let draft = $state<AppSettings>({ ...app.settings });
  let babyName = $state(app.baby.name);
  let birthInput = $state('');
  let error = $state('');
  let confirmWipe = $state(false);

  const NUMBERS: { key: keyof AppSettings; label: string }[] = [
    { key: 'target_min', label: 'Feed target (min)' },
    { key: 'max_gap_min', label: 'Wake-to-feed gap (min)' },
    { key: 'merge_gap_min', label: 'Merge gap (min)' },
    { key: 'max_session_min', label: 'Maximum session (min)' },
    { key: 'running_prompt_min', label: 'Still-feeding prompt (min)' },
    { key: 'emergency_retry_min', label: 'Alert retry (min)' },
    { key: 'emergency_max_min', label: 'Alert maximum (min)' },
    { key: 'vitamin_d_iu', label: 'Vitamin D (IU)' },
    { key: 'diaper_guide_days', label: 'Diaper guide window (days)' }
  ];

  $effect(() => {
    if (open) {
      draft = { ...app.settings };
      babyName = app.baby.name;
      birthInput = app.baby.birth_at ? toLocalInput(app.baby.birth_at, app.settings) : '';
      error = '';
      confirmWipe = false;
      dialog?.showModal();
    } else {
      dialog?.close();
    }
  });

  async function save() {
    const parsed = settingsSchema.safeParse({ ...draft, fever_c: Number(draft.fever_c) });
    if (!parsed.success) {
      error = parsed.error.issues[0]?.message ?? 'Something is out of range';
      return;
    }
    await app.saveSettings(parsed.data);

    let birth: string | null = null;
    if (birthInput) {
      const [date, time] = birthInput.split('T');
      const [y, m, d] = date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      birth = new Date(fromLocal(parsed.data.time_zone, y, m, d, hh, mm, 0)).toISOString();
    }
    await app.saveBaby({ name: babyName || 'Baby', birth_at: birth });
    open = false;
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
  <div class="row" style="justify-content: space-between">
    <h3>Settings</h3>
    <button class="ghost" onclick={() => (open = false)}>Close</button>
  </div>

  <label for="baby">Baby</label>
  <input id="baby" bind:value={babyName} />

  <label for="birth">Born</label>
  <input id="birth" type="datetime-local" bind:value={birthInput} />

  <div class="grid2">
    {#each NUMBERS as field}
      <div>
        <label for={field.key}>{field.label}</label>
        <input
          id={field.key}
          type="number"
          inputmode="numeric"
          min="1"
          value={draft[field.key] as number}
          oninput={(e) => ((draft as any)[field.key] = Number(e.currentTarget.value))}
        />
      </div>
    {/each}
    <div>
      <label for="fever">Fever (C)</label>
      <input id="fever" type="number" step="0.1" bind:value={draft.fever_c} />
    </div>
    <div>
      <label for="tz">Time zone</label>
      <input id="tz" bind:value={draft.time_zone} />
    </div>
  </div>

  <label class="row" style="margin-top: 12px">
    <input
      type="checkbox"
      style="width: auto; min-height: 0"
      bind:checked={draft.back_to_birth_weight}
    />
    <span>Back to birth weight (stops the wake-to-feed alert)</span>
  </label>

  {#if error}<p class="flag">{error}</p>{/if}

  <button class="primary" style="width: 100%; margin-top: 12px" onclick={save}>Save</button>

  <hr style="border: none; border-top: 1px solid var(--line); margin: 16px 0" />
  {#if confirmWipe}
    <button
      style="width: 100%; color: var(--alarm)"
      onclick={async () => {
        await app.wipePracticeData();
        confirmWipe = false;
        open = false;
      }}
    >
      Really wipe every entry on this phone
    </button>
  {:else}
    <button class="ghost" style="width: 100%" onclick={() => (confirmWipe = true)}>
      Wipe practice data (bump the epoch)
    </button>
  {/if}
</dialog>
