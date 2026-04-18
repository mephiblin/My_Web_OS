<script>
  import { onMount, onDestroy } from 'svelte';
  import { Play, Square, RotateCcw, Trash2, Container, AlertCircle } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import * as dockerApi from './api.js';

  let containers = $state([]);
  let loading = $state(true);
  let error = $state('');
  let interval;

  async function fetchContainers() {
    try {
      const data = await dockerApi.listContainers();
      if (data.error) {
        error = data.error;
        containers = [];
      } else {
        containers = data.containers || [];
        error = '';
      }
    } catch (err) {
      error = 'Failed to connect to Docker';
      containers = [];
    } finally {
      loading = false;
    }
  }

  async function handleAction(action, container) {
    const id = container.ID;
    try {
      let result;
      if (action === 'start') result = await dockerApi.startContainer(id);
      else if (action === 'stop') result = await dockerApi.stopContainer(id);
      else if (action === 'restart') result = await dockerApi.restartContainer(id);
      else if (action === 'remove') {
        if (!confirm(`Remove container ${container.Names}?`)) return;
        result = await dockerApi.removeContainer(id);
      }
      if (result?.success) {
        addToast(result.message, 'success');
        await fetchContainers();
      } else {
        addToast(result?.message || 'Action failed', 'error');
      }
    } catch (err) {
      addToast('Action failed: ' + err.message, 'error');
    }
  }

  function getStatusColor(status) {
    if (status?.includes('Up')) return 'var(--accent-green)';
    if (status?.includes('Exited')) return 'var(--accent-red)';
    return 'var(--text-dim)';
  }

  onMount(() => {
    fetchContainers();
    interval = setInterval(fetchContainers, 5000);
  });

  onDestroy(() => clearInterval(interval));
</script>

<div class="docker-manager">
  <div class="header">
    <h2><Container size={20} /> Docker Containers</h2>
    <button class="refresh-btn" onclick={fetchContainers}><RotateCcw size={14} /> Refresh</button>
  </div>

  {#if loading}
    <div class="center-msg">Loading...</div>
  {:else if error}
    <div class="center-msg error-msg">
      <AlertCircle size={32} />
      <p>{error}</p>
      <span class="hint">Is Docker installed and running?</span>
    </div>
  {:else if containers.length === 0}
    <div class="center-msg">No containers found.</div>
  {:else}
    <div class="container-list">
      {#each containers as c}
        <div class="container-row glass-effect">
          <div class="info">
            <div class="name">{c.Names}</div>
            <div class="image-port">
              <span class="image">{c.Image}</span>
              {#if c.Ports}
                <span class="ports">({c.Ports})</span>
              {/if}
            </div>
            <div class="status" style="color: {getStatusColor(c.Status)}">● {c.Status}</div>
          </div>
          <div class="actions">
            {#if c.State === 'running'}
              <button title="Stop" class="stop" onclick={() => handleAction('stop', c)}><Square size={14} /></button>
              <button title="Restart" class="restart" onclick={() => handleAction('restart', c)}><RotateCcw size={14} /></button>
            {:else}
              <button title="Start" class="start" onclick={() => handleAction('start', c)}><Play size={14} /></button>
              <button title="Remove" class="danger" onclick={() => handleAction('remove', c)}><Trash2 size={14} /></button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .docker-manager { display: flex; flex-direction: column; height: 100%; padding: 20px; gap: 16px; color: var(--text-main); overflow: auto; }
  .header { display: flex; justify-content: space-between; align-items: center; }
  .header h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }
  .refresh-btn { background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); color: var(--text-dim); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .refresh-btn:hover { background: rgba(255,255,255,0.15); color: white; }
  .center-msg { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: var(--text-dim); gap: 8px; }
  .error-msg { color: var(--accent-red); }
  .hint { font-size: 12px; color: var(--text-dim); }
  .container-list { display: flex; flex-direction: column; gap: 12px; }
  .container-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--glass-border); }
  .info { display: flex; flex-direction: column; gap: 4px; }
  .name { font-weight: 600; font-size: 14px; color: var(--text-main); }
  .image-port { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .image { font-size: 11px; opacity: 0.6; padding: 2px 6px; background: rgba(0,0,0,0.2); border-radius: 4px; }
  .ports { font-size: 11px; color: var(--accent-blue); opacity: 0.8; font-family: monospace; }
  .status { font-size: 11px; font-weight: 500; }
  .actions { display: flex; gap: 8px; }
  .actions button { background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: var(--text-dim); width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
  
  /* Action button colors */
  .actions button.start:hover { color: var(--accent-green); border-color: rgba(63, 185, 80, 0.4); background: rgba(63, 185, 80, 0.1); box-shadow: 0 0 10px rgba(63, 185, 80, 0.2); }
  .actions button.stop:hover { color: var(--accent-red); border-color: rgba(248, 81, 73, 0.4); background: rgba(248, 81, 73, 0.1); box-shadow: 0 0 10px rgba(248, 81, 73, 0.2); }
  .actions button.restart:hover { color: var(--accent-blue); border-color: rgba(88, 166, 255, 0.4); background: rgba(88, 166, 255, 0.1); box-shadow: 0 0 10px rgba(88, 166, 255, 0.2); }
  .actions button.danger:hover { color: #ff5555; border-color: rgba(255, 85, 85, 0.5); background: rgba(255, 85, 85, 0.15); box-shadow: 0 0 12px rgba(255, 85, 85, 0.3); }
  
  .actions button:active { transform: scale(0.92); }
</style>
