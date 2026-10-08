<script lang="ts">
  import './app.css';
  import { app } from './lib/state.svelte';
  import { ui } from './lib/ui.svelte';
  import StatusCard from './lib/components/StatusCard.svelte';
  import TodayCard from './lib/components/TodayCard.svelte';
  import BathCard from './lib/components/BathCard.svelte';
  import BathSheet from './lib/components/BathSheet.svelte';
  import HistoryView from './lib/components/HistoryView.svelte';
  import ActionBar from './lib/components/ActionBar.svelte';
  import AsleepSheet from './lib/components/AsleepSheet.svelte';
  import SleepSheet from './lib/components/SleepSheet.svelte';
  import DaySheet from './lib/components/DaySheet.svelte';
  import SettingsSheet from './lib/components/SettingsSheet.svelte';
  import ReportView from './lib/components/ReportView.svelte';
  import SignIn from './lib/components/SignIn.svelte';
  import ConflictDialog from './lib/components/ConflictDialog.svelte';
  import { since } from './lib/format';

  app.init();

  // Dim red from the routine until morning, for a dark bedroom.
  $effect(() => {
    if (app.nightLook) document.documentElement.dataset.look = 'night';
    else delete document.documentElement.dataset.look;
  });
</script>

<main>
  <div class="spread">
    <h1>{app.child.name}</h1>
    <button class="ghost" onclick={() => (ui.settings = true)}>Settings</button>
  </div>

  <div class="tabs" role="group" aria-label="Screens">
    <button aria-pressed={ui.tab === 'today'} onclick={() => (ui.tab = 'today')}>Today</button>
    <button aria-pressed={ui.tab === 'history'} onclick={() => (ui.tab = 'history')}>History</button>
  </div>

  {#if app.unsent > 0}
    <p class="banner">
      {app.unsent}
      {app.unsent === 1 ? 'change' : 'changes'} not sent yet.
      {#if !app.syncConfigured}
        This build has no Supabase keys, so nothing leaves this phone.
      {:else if app.syncNeedsSignIn}
        Sign in below to upload them.
      {:else}
        They upload as soon as this phone can.
      {/if}
    </p>
  {/if}

  {#if app.syncError}
    <p class="banner">{app.syncError}</p>
  {/if}

  {#if app.syncNeedsSignIn}
    <SignIn />
  {/if}

  {#if ui.tab === 'today'}
    <StatusCard />
    <TodayCard />
    <BathCard />
  {:else}
    <HistoryView />
  {/if}

  {#if app.signedIn}
    <p class="muted">
      Synced {app.lastSyncAt ? since(app.now - app.lastSyncAt) : 'not yet'}{app.lastSyncAt &&
      app.now - app.lastSyncAt >= 60_000
        ? ' ago'
        : ''}.
      {#if app.partnerSeenAt}
        The other phone last synced {since(app.now - Date.parse(app.partnerSeenAt))} ago.
      {/if}
    </p>
  {/if}
</main>

<ActionBar />

<AsleepSheet />
<SleepSheet />
<DaySheet />
<SettingsSheet />
<BathSheet />
<ConflictDialog />
<ReportView />
