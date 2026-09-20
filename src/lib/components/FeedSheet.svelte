<script lang="ts">
  import { app } from '../state.svelte';
  import { mmss, since } from '../format';
  import type { Side } from '../model';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let tab = $state<'nursing' | 'bottle'>('nursing');
  let ml = $state(60);
  let milk = $state<'breast' | 'formula'>('formula');
  let backdate = $state(0);

  // Side timers. They accumulate from the stored seconds, so closing the sheet
  // mid-feed does not lose them.
  let activeSide = $state<Side | null>(null);
  let sideStartedAt = $state<number | null>(null);
  let leftSec = $state(0);
  let rightSec = $state(0);

  const running = $derived(app.runningFeed);
  const liveExtra = $derived(sideStartedAt === null ? 0 : Math.floor((app.now - sideStartedAt) / 1000));
  const shownLeft = $derived(leftSec + (activeSide === 'left' ? liveExtra : 0));
  const shownRight = $derived(rightSec + (activeSide === 'right' ? liveExtra : 0));

  $effect(() => {
    if (open) dialog?.showModal();
    else dialog?.close();
  });

  $effect(() => {
    // Pick up a feed started on this phone or the other one.
    if (open && running) {
      leftSec = running.left_sec ?? 0;
      rightSec = running.right_sec ?? 0;
    }
  });

  function switchSide(side: Side) {
    if (activeSide && sideStartedAt !== null) {
      const extra = Math.floor((Date.now() - sideStartedAt) / 1000);
      if (activeSide === 'left') leftSec += extra;
      else rightSec += extra;
    }
    activeSide = side;
    sideStartedAt = Date.now();
  }

  async function startNursing(side: Side) {
    if (!running) await app.startFeed('nursing', backdate);
    switchSide(side);
    await persist();
  }

  async function persist() {
    if (!app.runningFeed) return;
    await app.editEntry(app.runningFeed.id, {
      left_sec: leftSec + (activeSide === 'left' ? Math.floor((Date.now() - (sideStartedAt ?? Date.now())) / 1000) : 0),
      right_sec: rightSec + (activeSide === 'right' ? Math.floor((Date.now() - (sideStartedAt ?? Date.now())) / 1000) : 0),
      last_side: activeSide
    });
  }

  async function stop() {
    const feed = app.runningFeed;
    if (!feed) return;
    if (activeSide && sideStartedAt !== null) {
      const extra = Math.floor((Date.now() - sideStartedAt) / 1000);
      if (activeSide === 'left') leftSec += extra;
      else rightSec += extra;
    }
    await app.stopFeed(feed.id, { left_sec: leftSec, right_sec: rightSec, last_side: activeSide });
    reset();
    open = false;
  }

  async function saveBottle() {
    await app.logBottle(ml, milk, backdate);
    reset();
    open = false;
  }

  function reset() {
    activeSide = null;
    sideStartedAt = null;
    leftSec = 0;
    rightSec = 0;
    backdate = 0;
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)}>
  <div class="row" style="justify-content: space-between">
    <h3>{running ? 'Feeding' : 'Start a feed'}</h3>
    <button class="ghost" onclick={() => (open = false)}>Close</button>
  </div>

  {#if running}
    {#if running.logged_by !== app.who?.user_id}
      <p class="banner">
        A feed is already running from the other phone, started {since(
          app.now - Date.parse(running.started_at)
        )} ago. Carry on with it rather than starting a second one.
      </p>
    {/if}
    <p class="muted">
      Running since {since(app.now - Date.parse(running.started_at))} ago.
      {#if app.timer.stillFeeding}<span class="flag">Still feeding?</span>{/if}
    </p>
  {:else}
    <div class="row">
      <button class:primary={tab === 'nursing'} onclick={() => (tab = 'nursing')}>Nursing</button>
      <button class:primary={tab === 'bottle'} onclick={() => (tab = 'bottle')}>Bottle</button>
    </div>

    <label for="backdate">Started</label>
    <div class="row" id="backdate">
      {#each [0, 5, 10, 15, 30] as mins}
        <button class:primary={backdate === mins} onclick={() => (backdate = mins)}>
          {mins === 0 ? 'now' : `${mins} min ago`}
        </button>
      {/each}
    </div>
  {/if}

  {#if tab === 'nursing' || running}
    <div class="grid2" style="margin-top: 12px">
      <button
        class:primary={activeSide === 'left'}
        style="min-height: 72px"
        onclick={() => startNursing('left')}
      >
        Left<br /><b>{mmss(shownLeft)}</b>
      </button>
      <button
        class:primary={activeSide === 'right'}
        style="min-height: 72px"
        onclick={() => startNursing('right')}
      >
        Right<br /><b>{mmss(shownRight)}</b>
      </button>
    </div>
    {#if running}
      <button class="primary" style="width: 100%; margin-top: 12px" onclick={stop}>Stop feed</button>
      {#if running.feed_method === 'nursing'}
        <p class="muted">Tapping the other side switches; the times keep counting.</p>
      {/if}
    {/if}
  {:else}
    <label for="ml">Bottle (ml)</label>
    <input id="ml" type="number" inputmode="numeric" min="0" step="5" bind:value={ml} />
    <label for="milk">Milk</label>
    <select id="milk" bind:value={milk}>
      <option value="formula">Formula</option>
      <option value="breast">Expressed breast milk</option>
    </select>
    <button class="primary" style="width: 100%; margin-top: 12px" onclick={saveBottle}>
      Log {ml} ml
    </button>
  {/if}
</dialog>
