<script>
  import { Shield, Lock, User } from 'lucide-svelte';
  import { login } from '../core/stores/authStore.js';
  import { apiFetch } from '../utils/api.js';

  let { onLoginSuccess } = $props();

  let username = $state('admin');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e) {
    e.preventDefault();
    loading = true;
    error = '';
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      if (data.success) {
        login(data.token);
        onLoginSuccess();
      } else {
        error = data.message || 'Login failed';
      }
    } catch (err) {
      error = 'Server connection failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-screen">
  <div class="login-card glass-effect window-shadow">
    <div class="logo">
      <Shield size={48} color="var(--accent-blue)" />
      <h1>Web OS</h1>
      <p>Enter your credentials to continue</p>
    </div>
    <form onsubmit={handleLogin}>
      <div class="input-group"><User size={18} /><input type="text" placeholder="Username" bind:value={username} required /></div>
      <div class="input-group"><Lock size={18} /><input type="password" placeholder="Password" bind:value={password} required /></div>
      {#if error}<div class="error">{error}</div>{/if}
      <button type="submit" disabled={loading}>{loading ? 'Authenticating...' : 'Login'}</button>
    </form>
  </div>
</div>

<style>
  .login-screen { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0d1117 0%, #161b22 100%); }
  .login-card { width: 360px; padding: 40px; border-radius: 20px; text-align: center; }
  .logo { margin-bottom: 30px; }
  .logo h1 { margin-top: 10px; font-size: 24px; font-weight: 700; }
  .logo p { font-size: 14px; color: var(--text-dim); }
  form { display: flex; flex-direction: column; gap: 16px; }
  .input-group { background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 8px; display: flex; align-items: center; padding: 0 12px; gap: 10px; }
  .input-group input { background: transparent; border: none; color: white; flex: 1; padding: 12px 0; outline: none; font-size: 14px; }
  button { background: var(--accent-blue); color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 10px; font-size: 14px; }
  button:disabled { opacity: 0.5; }
  .error { color: var(--accent-red); font-size: 13px; }
</style>
