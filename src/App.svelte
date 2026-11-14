<script lang="ts">
  import './app.css';
  import { tick, untrack } from 'svelte';
  import { app } from './lib/state.svelte';
  import { ui } from './lib/ui.svelte';
  import StatusCard from './lib/components/StatusCard.svelte';
  import TodayCard from './lib/components/TodayCard.svelte';
  import BathCard from './lib/components/BathCard.svelte';
  import NapCard from './lib/components/NapCard.svelte';
  import BathSheet from './lib/components/BathSheet.svelte';
  import ScreenCard from './lib/components/ScreenCard.svelte';
  import SootherCard from './lib/components/SootherCard.svelte';
  import HabitSheet from './lib/components/HabitSheet.svelte';
  import GrowthView from './lib/components/GrowthView.svelte';
  import GrowthSheet from './lib/components/GrowthSheet.svelte';
  import HistoryView from './lib/components/HistoryView.svelte';
  import ActionBar from './lib/components/ActionBar.svelte';
  import TabBar from './lib/components/TabBar.svelte';
  import AsleepSheet from './lib/components/AsleepSheet.svelte';
  import SleepSheet from './lib/components/SleepSheet.svelte';
  import DaySheet from './lib/components/DaySheet.svelte';
  import SettingsSheet from './lib/components/SettingsSheet.svelte';
  import ReportView from './lib/components/ReportView.svelte';
  import SignIn from './lib/components/SignIn.svelte';
  import ConflictDialog from './lib/components/ConflictDialog.svelte';
  import { since } from './lib/format';
  import { addDays, atMinutes } from './lib/time';

  app.init();

  // A tapped nudge ("When did he wake up?", "Log his nap") opens where that is
  // entered. It comes in the address when the app was closed, or as a message
  // from the service worker when it was already open (public/push-sw.js).
  type Nudge = { kind: 'log_wake' | 'log_nap'; date: string };

  function asNudge(kind: unknown, date: unknown): Nudge | null {
    return (kind === 'log_wake' || kind === 'log_nap') && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? { kind, date }
      : null;
  }

  function nudgeFromAddress(): Nudge | null {
    const params = new URLSearchParams(location.search);
    const found = asNudge(params.get('open'), params.get('date'));
    if (found) window.history.replaceState(null, '', location.pathname + location.hash);
    return found;
  }

  let nudge = $state<Nudge | null>(nudgeFromAddress());

  $effect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      const found = asNudge(e.data?.open?.kind, e.data?.open?.date);
      if (found) nudge = found;
    };
    sw.addEventListener('message', onMessage);
    sw.startMessages();
    return () => sw.removeEventListener('message', onMessage);
  });

  $effect(() => {
    const found = nudge;
    if (!found || !app.ready) return;
    nudge = null;
    untrack(() => void openNudge(found));
  });

  async function openNudge({ kind, date }: Nudge) {
    ui.tab = 'sleep';
    if (kind === 'log_wake') {
      // Last night, to fill in "Up for the day"; a new night if it was never logged.
      const night = app.sleepsOn(addDays(date, -1)).find((s) => s.kind === 'night');
      if (night) ui.editSleep(night.id);
      else ui.newSleep({ kind: 'night' });
      return;
    }
    if (date === app.today) {
      // The Nap card takes today's nap, already filled with the usual times.
      await tick();
      document.getElementById('nap-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Tapped on a later day: that day's nap, or a new one in its usual window.
    const nap = app.napOn(date);
    if (nap) return ui.editSleep(nap.id);
    const sched = app.history.schedule(date);
    const tz = app.settings.time_zone;
    const times =
      sched.napStart !== null && sched.napEnd !== null
        ? {
            asleep_at: new Date(atMinutes(date, sched.napStart, tz)).toISOString(),
            woke_at: new Date(atMinutes(date, sched.napEnd, tz)).toISOString()
          }
        : {};
    ui.newSleep({ kind: 'nap', place: sched.daycare ? 'daycare' : 'bed', ...times });
  }

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

  {#if ui.tab === 'sleep'}
    <StatusCard />
    <NapCard />
    <TodayCard />
  {:else if ui.tab === 'habits'}
    <ScreenCard />
    <SootherCard />
  {:else if ui.tab === 'bath'}
    <BathCard />
  {:else if ui.tab === 'growth'}
    <GrowthView />
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

<!-- The sleep buttons on every tab, so bedtime is one tap from anywhere; the tabs under them. -->
<div class="dock no-print">
  <ActionBar />
  <TabBar />
</div>

<AsleepSheet />
<SleepSheet />
<DaySheet />
<SettingsSheet />
<BathSheet />
<HabitSheet />
<GrowthSheet />
<ConflictDialog />
<ReportView />
