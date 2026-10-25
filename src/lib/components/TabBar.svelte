<script lang="ts">
  // The four screens, at the foot where a thumb reaches them. A dot marks a tab
  // that needs a look: a screen on or the soother in, or a bath due.
  import { app } from '../state.svelte';
  import { ui, type Tab } from '../ui.svelte';

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'sleep', label: 'Sleep', icon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' },
    { id: 'habits', label: 'Habits', icon: 'M3 5h18v11H3z M8 20h8 M12 16v4' },
    { id: 'bath', label: 'Bath', icon: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z' },
    { id: 'history', label: 'History', icon: 'M4 20V11 M10 20V5 M16 20v-6 M21 20H3' }
  ];

  const dot = $derived<Record<Tab, boolean>>({
    sleep: false,
    habits: Boolean(app.screen.running || app.soother.running),
    bath: app.bath.due,
    history: false
  });

  function open(tab: Tab) {
    ui.tab = tab;
    window.scrollTo(0, 0);
  }
</script>

<nav class="tabbar" aria-label="Screens">
  {#each tabs as tab (tab.id)}
    <button aria-current={ui.tab === tab.id ? 'page' : undefined} onclick={() => open(tab.id)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={tab.icon} />
      </svg>
      <span>{tab.label}</span>
      {#if dot[tab.id]}<i class="dot" aria-label="needs a look"></i>{/if}
    </button>
  {/each}
</nav>
