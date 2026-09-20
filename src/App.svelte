<script lang="ts">
  import './app.css';
  import { app } from './lib/state.svelte';
  import TimerCard from './lib/components/TimerCard.svelte';
  import FeedSheet from './lib/components/FeedSheet.svelte';
  import DiaperSheet from './lib/components/DiaperSheet.svelte';
  import Timeline from './lib/components/Timeline.svelte';
  import SettingsSheet from './lib/components/SettingsSheet.svelte';

  let feedOpen = $state(false);
  let colourEntryId = $state<string | null>(null);
  let settingsOpen = $state(false);

  app.init();

  /** One tap logs it now. The sheet then offers the colour and the time. */
  async function logDiaper(wet: boolean, dirty: boolean) {
    const entry = await app.logDiaper({ wet, dirty });
    if (dirty) colourEntryId = entry.id;
  }
</script>

<main>
  <div class="row" style="justify-content: space-between; margin-bottom: 12px">
    <h1>{app.baby.name}</h1>
    <button class="ghost" onclick={() => (settingsOpen = true)}>Settings</button>
  </div>

  {#if app.unsent > 0}
    <p class="banner">{app.unsent} entries not sent yet. They upload once sync is switched on.</p>
  {/if}

  <TimerCard />

  <section class="card counts">
    <div>
      <b>{app.counts.feeds}</b>
      <span class="muted">feeds / 24 h</span>
    </div>
    <div>
      <b>{app.counts.wet}</b>
      <span class="muted">wet{app.expected ? ` / ${app.expected.wet}` : ''}</span>
    </div>
    <div>
      <b>{app.counts.dirty}</b>
      <span class="muted">dirty{app.expected ? ` / ${app.expected.dirty}` : ''}</span>
    </div>
    {#if app.dayOfLife !== null}
      <p class="muted" style="grid-column: 1 / -1; margin: 6px 0 0">
        Day {app.dayOfLife}.
        {#if app.expected}
          Expect at least {app.expected.wet} wet and {app.expected.dirty} dirty today.
        {:else}
          The diaper guide runs for the first {app.settings.diaper_guide_days} days.
        {/if}
      </p>
    {:else}
      <p class="muted" style="grid-column: 1 / -1; margin: 6px 0 0">
        Set the birth time in Settings for the diaper guide.
      </p>
    {/if}
  </section>

  <Timeline />
</main>

<nav class="actions">
  <button class="primary" onclick={() => (feedOpen = true)}>
    {app.runningFeed ? 'Feeding' : 'Feed'}
  </button>
  <button onclick={() => logDiaper(true, false)}>Wet</button>
  <button onclick={() => logDiaper(false, true)}>Dirty</button>
  <button onclick={() => logDiaper(true, true)}>Both</button>
</nav>

<FeedSheet bind:open={feedOpen} />
<DiaperSheet bind:entryId={colourEntryId} />
<SettingsSheet bind:open={settingsOpen} />
