<script>
  import { onMount } from 'svelte';
  import { Cloud, Plus, Trash2, ExternalLink, RefreshCw, AlertCircle } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';

  let providers = $state([]);
  let remotes = $state([]);
  let loading = $state(true);
  let showAddModal = $state(false);
  let selectedProvider = $state('');
  let newRemoteName = $state('');
  let settingUp = $state(false);

  async function fetchCloudData() {
    try {
      loading = true;
      const [provRes, remRes] = await Promise.all([
        fetch('/api/cloud/providers').then(r => r.json()),
        fetch('/api/cloud/remotes').then(r => r.json())
      ]);
      providers = provRes;
      remotes = remRes;
    } catch (err) {
      addToast('Failed to fetch cloud data', 'error');
    } finally {
      loading = false;
    }
  }

  async function handleAddCloud() {
    if (!selectedProvider || !newRemoteName) {
      addToast('Please select a provider and enter a name', 'warning');
      return;
    }

    try {
      settingUp = true;
      const res = await fetch('/api/cloud/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRemoteName, provider: selectedProvider })
      }).then(r => r.json());

      if (res.success) {
        addToast(res.message || 'Cloud storage added successfully', 'success');
        showAddModal = false;
        newRemoteName = '';
        selectedProvider = '';
        await fetchCloudData();
      } else {
        addToast(res.error || 'Setup failed', 'error');
      }
    } catch (err) {
      addToast('Error during setup', 'error');
    } finally {
      settingUp = false;
    }
  }

  async function handleMount(name) {
    try {
      const res = await fetch('/api/cloud/mount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      }).then(r => r.json());

      if (res.success) {
        addToast(`Mounted ${name} at ${res.url}`, 'success');
      } else {
        addToast(res.error || 'Mount failed', 'error');
      }
    } catch (err) {
      addToast('Error during mount', 'error');
    }
  }

  onMount(fetchCloudData);
</script>

<div class="cloud-manager">
  <div class="section-header">
    <h3>Cloud Storage</h3>
    <button class="add-btn" onclick={() => showAddModal = true}>
      <Plus size={16} /> Add Cloud
    </button>
  </div>

  {#if loading}
    <div class="loading-state">
      <RefreshCw size={24} class="spin" />
      <span>Fetching connections...</span>
    </div>
  {:else if remotes.length === 0}
    <div class="empty-state glass-effect">
      <Cloud size={48} />
      <p>No cloud storage connected yet.</p>
      <button class="primary-btn" onclick={() => showAddModal = true}>Connect your first cloud</button>
    </div>
  {:else}
    <div class="remote-list">
      {#each remotes as remote}
        <div class="remote-item glass-effect">
          <div class="remote-info">
            <Cloud size={24} />
            <div class="text">
              <span class="name">{remote.name}</span>
              <span class="status {remote.connected ? 'active' : ''}">
                {remote.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          <div class="actions">
            <button class="action-btn" onclick={() => handleMount(remote.name)}>
              <ExternalLink size={16} /> Mount
            </button>
            <button class="action-btn danger">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if showAddModal}
    <div class="modal-overlay" onclick={() => showAddModal = false}>
      <div class="modal glass-effect" onclick={(e) => e.stopPropagation()}>
        <h3>Add Cloud Storage</h3>
        <p>Select a provider and give it a name to start the connection.</p>
        
        <div class="form-group-inc">
          <label for="provider">Provider</label>
          <select id="provider" bind:value={selectedProvider}>
            <option value="">Select a provider...</option>
            {#each providers as provider}
              <option value={provider.id}>{provider.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-group-inc">
          <label for="remoteName">Remote Name</label>
          <input id="remoteName" type="text" bind:value={newRemoteName} placeholder="e.g. WorkDrive" />
        </div>

        <div class="info-box">
          <AlertCircle size={14} />
          <span>Rclone will be used to manage this connection securely.</span>
        </div>

        <div class="modal-actions">
          <button class="cancel-btn" onclick={() => showAddModal = false}>Cancel</button>
          <button class="primary-btn" onclick={handleAddCloud} disabled={settingUp}>
            {settingUp ? 'Setting up...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .cloud-manager { display: flex; flex-direction: column; gap: 20px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .section-header h3 { font-size: 15px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; margin: 0; }
  
  .add-btn { background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); color: white; padding: 6px 12px; border-radius: 6px; font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s; }
  .add-btn:hover { background: var(--accent-blue); border-color: var(--accent-blue); }

  .loading-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px; color: var(--text-dim); }
  .spin { animation: spin 2s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 60px; border-radius: 12px; color: var(--text-dim); text-align: center; }
  .empty-state p { margin: 0; font-size: 15px; }

  .remote-list { display: flex; flex-direction: column; gap: 12px; }
  .remote-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-radius: 12px; border: 1px solid var(--glass-border); }
  .remote-info { display: flex; align-items: center; gap: 16px; }
  .remote-info .text { display: flex; flex-direction: column; }
  .remote-info .name { font-weight: 600; font-size: 15px; color: white; }
  .remote-info .status { font-size: 12px; color: var(--text-dim); }
  .remote-info .status.active { color: #4ade80; }

  .actions { display: flex; gap: 8px; }
  .action-btn { background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: var(--text-dim); padding: 6px 10px; border-radius: 6px; font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s; }
  .action-btn:hover { background: rgba(255,255,255,0.1); color: white; }
  .action-btn.danger:hover { background: var(--accent-red); color: white; border-color: var(--accent-red); }

  .primary-btn { background: var(--accent-blue); color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
  .primary-btn:hover:not(:disabled) { background: #6cb3ff; transform: translateY(-1px); }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; justify-content: center; align-items: center; z-index: 1000; }
  .modal { background: rgba(30, 30, 30, 0.9); width: 400px; padding: 32px; border-radius: 16px; border: 1px solid var(--glass-border); display: flex; flex-direction: column; gap: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
  .modal h3 { margin: 0; font-size: 18px; color: white; }
  .modal p { margin: 0; font-size: 14px; color: var(--text-dim); line-height: 1.5; }

  .form-group-inc { display: flex; flex-direction: column; gap: 8px; }
  .form-group-inc label { font-size: 13px; font-weight: 500; color: var(--text-dim); }
  .form-group-inc select, .form-group-inc input { background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: white; padding: 10px; border-radius: 8px; font-size: 14px; }

  .info-box { display: flex; align-items: center; gap: 8px; background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.3); color: var(--accent-blue); padding: 10px; border-radius: 8px; font-size: 12px; }

  .modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px; }
  .cancel-btn { background: transparent; border: 1px solid var(--glass-border); color: var(--text-dim); padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .cancel-btn:hover { background: rgba(255,255,255,0.05); color: white; }
</style>
