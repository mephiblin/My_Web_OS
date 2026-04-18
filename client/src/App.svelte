<script>
  import './app.css';
  import Login from './core/Login.svelte';
  import Desktop from './core/Desktop.svelte';
  import Toast from './core/components/Toast.svelte';

  let loggedIn = $state(!!localStorage.getItem('web_os_token'));
</script>

{#if loggedIn}
  <Desktop />
{:else}
  <Login onLoginSuccess={() => loggedIn = true} />
{/if}

<Toast />
