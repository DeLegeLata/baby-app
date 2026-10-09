<script lang="ts">
  import './app.css';
  import { tick } from 'svelte';
  import { app } from './lib/state.svelte';
  import { ui } from './lib/ui.svelte';
  import StatusCard from './lib/components/StatusCard.svelte';
  import TodayCard from './lib/components/TodayCard.svelte';
  import BathCard from './lib/components/BathCard.svelte';
  import DaycareCard from './lib/components/DaycareCard.svelte';
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

  /** Chrome on Android offers this when the app can be installed. */
  type InstallPrompt = Event & { prompt: () => Promise<void> };
  let installEvent = $state<InstallPrompt | null>(null);

  $effect(() => {
    const onPrompt = ((e: Event) => {
      e.preventDefault();
      installEvent = e as InstallPrompt;
    }) as EventListener;
    const onInstalled = () => (installEvent = null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  });

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    installEvent = null;
  }

  let errorBanner = $state<HTMLElement | null>(null);

  /** Sync now sits at the foot of the page and the reason a sync failed is near the top, so show it. */
  async function syncNow() {
    await app.sync();
    await tick();
    errorBanner?.scrollIntoView({ block: 'center' });
  }
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

  {#if installEvent}
    <p class="banner">
      Add Sleep to this phone's home screen so it opens like an app.
      <button class="primary" onclick={install}>Install app</button>
    </p>
  {/if}

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
    <p class="banner" bind:this={errorBanner}>{app.syncError}</p>
  {/if}

  {#if app.syncNeedsSignIn}
    <SignIn />
  {/if}

  {#if ui.tab === 'today'}
    <StatusCard />
    <DaycareCard />
    <TodayCard />
    <BathCard />
  {:else}
    <HistoryView />
  {/if}

  {#if app.signedIn}
    <div class="spread sync-line">
      <p class="muted">
        Synced {app.lastSyncAt ? since(app.now - app.lastSyncAt) : 'not yet'}{app.lastSyncAt &&
        app.now - app.lastSyncAt >= 60_000
          ? ' ago'
          : ''}.
        {#if app.partnerSeenAt}
          The other phone last synced {since(app.now - Date.parse(app.partnerSeenAt))} ago.
        {/if}
      </p>
      <button class="ghost" disabled={app.syncing} onclick={syncNow}>
        {app.syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
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
