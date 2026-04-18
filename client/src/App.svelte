<script>
  import { onMount } from 'svelte';
  import './app.css';
  import Desktop from './lib/Desktop.svelte';
  import Login from './lib/Login.svelte';

  let authenticated = $state(false);

  async function checkAuth() {
    const token = localStorage.getItem('web_os_token');
    if (!token) return;

    try {
      const res = await fetch('http://localhost:3000/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) authenticated = true;
    } catch (err) {
      console.error(err);
    }
  }

  function handleLoginSuccess() {
    authenticated = true;
  }

  onMount(checkAuth);
</script>

<main>
  {#if authenticated}
    <Desktop />
  {:else}
    <Login onLoginSuccess={handleLoginSuccess} />
  {/if}
</main>
