<script lang="ts">
  // Email and password only: magic links and OAuth redirects both break inside
  // an installed iPhone web app. The password autofills from the keychain.
  import { app } from '../state.svelte';
  import { signIn } from '../supabase';

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card">
  <h3>Sign in to sync</h3>
  <p class="muted">Until you sign in, everything you log stays on this phone.</p>
  <form onsubmit={submit}>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" bind:value={email} required />
    <label for="password">Password</label>
    <input
      id="password"
      type="password"
      autocomplete="current-password"
      bind:value={password}
      required
    />
    {#if error}<p class="flag">{error}</p>{/if}
    <button class="primary" style="width: 100%; margin-top: 12px" disabled={busy} type="submit">
      {busy ? 'Signing in...' : 'Sign in'}
    </button>
  </form>
</section>
