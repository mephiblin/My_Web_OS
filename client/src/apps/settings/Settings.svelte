<script>
  import { onMount } from 'svelte';
  import { Save, AlertCircle, Settings as SettingsIcon, User, Folder, Cloud, ServerCog, RefreshCw, RotateCw, HardDriveDownload } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import * as settingsApi from './api.js';
  import CloudManager from './CloudManager.svelte';
  import BackupJobManager from './BackupJobManager.svelte';

  let settings = $state({
    PORT: '',
    JWT_SECRET: '',
    ALLOWED_ROOTS: '',
    NODE_ENV: '',
    ADMIN_USERNAME: '',
    ADMIN_PASSWORD: '',
    INITIAL_PATH: ''
  });
  let activeTab = $state('general');
  let loading = $state(true);
  let saving = $state(false);
  let services = $state({});
  let loadingServices = $state(false);
  let restartingService = $state('');

  async function loadSettings() {
    try {
      loading = true;
      const data = await settingsApi.fetchSettings();
      if (data.success && data.settings) {
        settings = { ...settings, ...data.settings };
      } else {
        addToast('Failed to load settings', 'error');
      }
    } catch (err) {
      addToast('Error loading settings', 'error');
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    try {
      saving = true;
      const data = await settingsApi.updateSettings(settings);
      if (data.success) {
        addToast('Settings saved successfully', 'success');
        addToast('Some changes may require server restart', 'info');
      } else {
        addToast(data.error || 'Failed to save', 'error');
      }
    } catch (err) {
      addToast('Error saving settings', 'error');
    } finally {
      saving = false;
    }
  }

  function statusLabel(status) {
    if (status === 'running') return 'Running';
    if (status === 'stopped') return 'Stopped';
    if (status === 'error') return 'Error';
    if (status === 'starting') return 'Starting';
    if (status === 'stopping') return 'Stopping';
    return 'Unknown';
  }

  function uptimeText(uptimeMs) {
    if (!uptimeMs || uptimeMs < 1000) return '0s';
    const totalSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  async function loadServices() {
    loadingServices = true;
    try {
      const data = await settingsApi.fetchServices();
      if (data.success && data.services) {
        services = data.services;
      } else {
        addToast('Failed to load service status', 'error');
      }
    } catch (_err) {
      addToast('Failed to load service status', 'error');
    } finally {
      loadingServices = false;
    }
  }

  async function handleRestartService(name) {
    restartingService = name;
    try {
      const data = await settingsApi.restartService(name);
      if (data.success) {
        addToast(`${name} restarted`, 'success');
        await loadServices();
      } else {
        addToast(data.message || 'Restart failed', 'error');
      }
    } catch (_err) {
      addToast('Restart failed', 'error');
    } finally {
      restartingService = '';
    }
  }

  onMount(() => {
    loadSettings();
    loadServices();
  });
</script>

<div class="settings-app">
  <div class="header">
    <h2>Settings</h2>
    <div class="header-actions">
      <button class="save-btn" onclick={saveSettings} disabled={saving || loading}>
        <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  </div>

  <div class="layout-body">
    <aside class="sidebar glass-effect">
      <button class="tab-btn {activeTab === 'general' ? 'active' : ''}" onclick={() => activeTab = 'general'}>
        <SettingsIcon size={18} /> <span>General</span>
      </button>
      <button class="tab-btn {activeTab === 'account' ? 'active' : ''}" onclick={() => activeTab = 'account'}>
        <User size={18} /> <span>Account</span>
      </button>
      <button class="tab-btn {activeTab === 'files' ? 'active' : ''}" onclick={() => activeTab = 'files'}>
        <Folder size={18} /> <span>File System</span>
      </button>
      <button class="tab-btn {activeTab === 'services' ? 'active' : ''}" onclick={() => activeTab = 'services'}>
        <ServerCog size={18} /> <span>Services</span>
      </button>
      <button class="tab-btn {activeTab === 'cloud' ? 'active' : ''}" onclick={() => activeTab = 'cloud'}>
        <Cloud size={18} /> <span>Cloud Storage</span>
      </button>
      <button class="tab-btn {activeTab === 'backup-jobs' ? 'active' : ''}" onclick={() => activeTab = 'backup-jobs'}>
        <HardDriveDownload size={18} /> <span>Backup Jobs</span>
      </button>
    </aside>

    <main class="content-area">
      {#if loading}
        <div class="center-msg">Loading configuration...</div>
      {:else}
        <div class="tab-content">
          {#if activeTab === 'general'}
            <div class="form-group glass-effect">
              <h3>Server & Environment</h3>
              <div class="input-row">
                <label for="port">Port</label>
                <input id="port" type="text" bind:value={settings.PORT} placeholder="e.g. 3000" />
              </div>
              <div class="input-row">
                <label for="env">Node Env</label>
                <input id="env" type="text" bind:value={settings.NODE_ENV} placeholder="development or production" />
              </div>
              <div class="input-row">
                <label for="jwt">JWT Secret</label>
                <input id="jwt" type="password" bind:value={settings.JWT_SECRET} placeholder="Secret key" />
              </div>
            </div>
          {:else if activeTab === 'account'}
            <div class="form-group glass-effect">
              <h3>Admin Account</h3>
              <div class="input-row">
                <label for="adminUser">Username</label>
                <input id="adminUser" type="text" bind:value={settings.ADMIN_USERNAME} />
              </div>
              <div class="input-row">
                <label for="adminPass">Password</label>
                <input id="adminPass" type="password" bind:value={settings.ADMIN_PASSWORD} />
              </div>
              <div class="warning-box">
                <AlertCircle size={14} />
                <span>If you change the password, you must use it on the next login.</span>
              </div>
            </div>
          {:else if activeTab === 'files'}
            <div class="form-group glass-effect">
              <h3>File System</h3>
              <div class="input-row">
                <label for="initPath">Initial Path</label>
                <input id="initPath" type="text" bind:value={settings.INITIAL_PATH} placeholder="/home/user" />
              </div>
              <div class="input-row">
                <label for="roots">Allowed Roots (JSON Array)</label>
                <input id="roots" type="text" bind:value={settings.ALLOWED_ROOTS} placeholder='["/home/user"]' />
              </div>
            </div>
          {:else if activeTab === 'services'}
            <div class="form-group glass-effect">
              <div class="service-head">
                <h3>Service Manager</h3>
                <button class="service-refresh" onclick={loadServices} disabled={loadingServices}>
                  <RefreshCw size={14} class={loadingServices ? 'is-spinning' : ''} />
                  Refresh
                </button>
              </div>
              <div class="service-grid">
                {#if Object.keys(services).length === 0 && !loadingServices}
                  <div class="service-empty">No services available</div>
                {/if}
                {#each Object.entries(services) as [name, svc]}
                  <div class="service-card">
                    <div class="service-top">
                      <div class="service-name">{name}</div>
                      <span class="service-status {svc.status || 'unknown'}">{statusLabel(svc.status)}</span>
                    </div>
                    <div class="service-meta">
                      <div>Uptime: {uptimeText(svc.uptimeMs)}</div>
                      {#if svc.lastError}
                        <div class="service-error">Error: {svc.lastError}</div>
                      {/if}
                    </div>
                    <button class="service-restart" onclick={() => handleRestartService(name)} disabled={restartingService === name}>
                      <RotateCw size={14} class={restartingService === name ? 'is-spinning' : ''} />
                      {restartingService === name ? 'Restarting...' : 'Restart'}
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {:else if activeTab === 'cloud'}
            <CloudManager />
          {:else if activeTab === 'backup-jobs'}
            <BackupJobManager />
          {/if}
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  .settings-app { display: flex; flex-direction: column; height: 100%; color: var(--text-main); background: rgba(0,0,0,0.2); overflow: hidden; }
  .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--glass-border); background: rgba(0,0,0,0.1); }
  .header h2 { font-size: 20px; font-weight: 600; margin: 0; color: var(--accent-blue); }
  .save-btn { background: var(--accent-blue); color: white; border: none; padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; box-shadow: 0 0 10px rgba(88, 166, 255, 0.3); }
  .save-btn:hover:not(:disabled) { background: #6cb3ff; box-shadow: 0 0 15px rgba(88, 166, 255, 0.5); transform: translateY(-1px); }
  .save-btn:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }
  
  .layout-body { display: flex; flex: 1; overflow: hidden; }
  
  .sidebar { width: 220px; background: rgba(0,0,0,0.15); border-right: 1px solid var(--glass-border); padding: 12px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
  .tab-btn { background: transparent; border: none; color: var(--text-dim); display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-radius: 8px; cursor: pointer; text-align: left; font-size: 14px; transition: all 0.2s; }
  .tab-btn:hover { background: rgba(255,255,255,0.08); color: white; }
  .tab-btn.active { background: rgba(255,255,255,0.1); color: var(--accent-blue); font-weight: 600; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }

  .content-area { flex: 1; padding: 32px; overflow-y: auto; }
  .center-msg { display: flex; justify-content: center; align-items: center; height: 100%; color: var(--text-dim); }
  
  .tab-content { max-width: 600px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 24px; }
  .form-group { padding: 24px; border-radius: 12px; display: flex; flex-direction: column; gap: 20px; border: 1px solid var(--glass-border); }
  .form-group h3 { font-size: 15px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin: 0 0 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; }
  
  .input-row { display: flex; flex-direction: column; gap: 8px; }
  label { font-size: 13px; font-weight: 500; color: var(--text-dim); }
  input { background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: white; padding: 10px 12px; border-radius: 8px; font-size: 14px; font-family: monospace; transition: border-color 0.2s; }
  input:focus { outline: none; border-color: var(--accent-blue); box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2); }
  
  .warning-box { display: flex; align-items: center; gap: 10px; background: rgba(240, 136, 62, 0.1); border: 1px solid rgba(240, 136, 62, 0.3); color: #f0883e; padding: 12px; border-radius: 8px; font-size: 12px; margin-top: 8px; line-height: 1.4; }
  .service-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .service-refresh { border: 1px solid var(--glass-border); background: rgba(255,255,255,0.06); color: var(--text-main); border-radius: 8px; padding: 6px 10px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .service-refresh:disabled { opacity: 0.6; cursor: not-allowed; }
  .service-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .service-card { border: 1px solid var(--glass-border); border-radius: 10px; padding: 10px; background: rgba(255,255,255,0.03); display: grid; gap: 8px; }
  .service-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .service-name { font-size: 13px; font-weight: 600; text-transform: capitalize; color: var(--text-main); }
  .service-status { font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 999px; border: 1px solid transparent; }
  .service-status.running { color: #5ee69e; border-color: rgba(94,230,158,0.5); background: rgba(94,230,158,0.12); }
  .service-status.stopped { color: #c8d1dc; border-color: rgba(200,209,220,0.4); background: rgba(200,209,220,0.12); }
  .service-status.error { color: #ff7b72; border-color: rgba(255,123,114,0.4); background: rgba(255,123,114,0.12); }
  .service-status.starting, .service-status.stopping { color: #f2cc60; border-color: rgba(242,204,96,0.4); background: rgba(242,204,96,0.12); }
  .service-meta { font-size: 12px; color: var(--text-dim); display: grid; gap: 2px; }
  .service-error { color: #ff7b72; }
  .service-restart { width: fit-content; border: 1px solid rgba(88,166,255,0.35); background: rgba(88,166,255,0.14); color: #7ec3ff; border-radius: 8px; padding: 6px 10px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .service-restart:disabled { opacity: 0.6; cursor: not-allowed; }
  .service-empty { border: 1px dashed var(--glass-border); border-radius: 10px; padding: 16px; color: var(--text-dim); text-align: center; grid-column: 1 / -1; }
  .is-spinning { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
