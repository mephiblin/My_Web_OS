<script>
  import { onMount } from 'svelte';
  import './app.css';
  import Login from './core/Login.svelte';
  import Desktop from './core/Desktop.svelte';
  import Toast from './core/components/Toast.svelte';

  let loggedIn = $state(false);
  let checking = $state(true);

  onMount(async () => {
    const token = localStorage.getItem('web_os_token');
    if (!token) {
      checking = false;
      return;
    }
    try {
      const res = await fetch('/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(3000), // 3s timeout
      });
      if (res.ok) {
        loggedIn = true;
      } else {
        localStorage.removeItem('web_os_token');
      }
    } catch {
      localStorage.removeItem('web_os_token');
    }
    checking = false;
  });
</script>

{#if checking}
  <div class="loading-screen">
    <div class="spinner"></div>
  </div>
{:else if loggedIn}
  <Desktop />
{:else}
  <Login onLoginSuccess={() => loggedIn = true} />
{/if}

<Toast />

<style>
  .loading-screen {
    width: 100vw; height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: #0d1117;
  }
  @supports (height: 100dvh) {
    .loading-screen {
      width: 100dvw; height: 100dvh;
    }
  }
  .spinner {
    width: 40px; height: 40px;
    border: 3px solid rgba(255,255,255,0.1);
    border-top-color: var(--accent-blue, #58a6ff);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
