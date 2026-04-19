<script>
  import { onMount, onDestroy } from 'svelte';
  import { RotateCcw, Search, Shield, Files, Monitor, AlertCircle, Info, Filter } from 'lucide-svelte';
  import { fetchLogs } from './api.js';

  let logs = $state([]);
  let loading = $state(true);
  let filterType = $state('ALL');
  let interval;

  const categories = [
    { id: 'ALL', label: 'All Logs', icon: Filter },
    { id: 'SYSTEM', label: 'System', icon: Monitor },
    { id: 'FS', label: 'Files', icon: Files },
    { id: 'AUTH', label: 'Security', icon: Shield },
  ];

  async function loadLogs() {
    try {
      const data = await fetchLogs(filterType);
      logs = data;
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      loading = false;
    }
  }

  function getLogIcon(type) {
    if (type === 'AUTH') return Shield;
    if (type === 'FS') return Files;
    return Info;
  }

  function getLogColor(type) {
    if (type === 'AUTH') return '#ff6b6b';
    if (type === 'FS') return '#58a6ff';
    return '#8b949e';
  }

  onMount(() => {
    loadLogs();
    interval = setInterval(loadLogs, 3000); // Polling every 3s
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  // Re-fetch when filter changes
  $effect(() => {
    loadLogs();
  });
</script>

<div class="log-viewer glass-effect">
  <div class="sidebar">
    {#each categories as cat}
      <button 
        class="cat-item {filterType === cat.id ? 'active' : ''}" 
        onclick={() => filterType = cat.id}
      >
        <svelte:component this={cat.icon} size={16} />
        <span>{cat.label}</span>
      </button>
    {/each}
  </div>

  <div class="main-content">
    <div class="toolbar">
      <div class="title">System Audit Logs</div>
      <button class="refresh-btn" onclick={loadLogs} disabled={loading}>
        <RotateCcw size={14} class={loading ? 'spin' : ''} />
      </button>
    </div>

    <div class="log-list">
      {#if loading && logs.length === 0}
        <div class="status-msg">Loading logs...</div>
      {:else if logs.length === 0}
        <div class="status-msg">No logs found for this category.</div>
      {:else}
        {#each logs as log}
          <div class="log-entry" style="border-left-color: {getLogColor(log.type)}">
            <div class="log-header">
              <span class="type-badge" style="background: {getLogColor(log.type)}1a; color: {getLogColor(log.type)}">
                {log.type}
              </span>
              <span class="timestamp">{new Date(log.timestamp).toLocaleString()}</span>
            </div>
            <div class="action">{log.action}</div>
            {#if log.path || log.fileName || log.user}
              <div class="details">
                {#if log.path}<span>Path: {log.path}</span>{/if}
                {#if log.fileName}<span>File: {log.fileName}</span>{/if}
                {#if log.user}<span>User: {log.user}</span>{/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .log-viewer { display: flex; height: 100%; color: var(--text-main); font-family: 'Inter', sans-serif; }
  .sidebar { width: 140px; background: rgba(0,0,0,0.2); border-right: 1px solid var(--glass-border); display: flex; flex-direction: column; padding: 12px; gap: 4px; }
  .cat-item { background: transparent; border: none; color: var(--text-dim); display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; text-align: left; }
  .cat-item:hover { background: rgba(255,255,255,0.05); color: white; }
  .cat-item.active { background: rgba(88,166,255,0.15); color: var(--accent-blue); font-weight: 600; }

  .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { height: 48px; border-bottom: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: rgba(0,0,0,0.1); }
  .title { font-size: 14px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .refresh-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 6px; border-radius: 4px; display: flex; align-items: center; }
  .refresh-btn:hover { color: white; background: rgba(255,255,255,0.1); }

  .log-list { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .log-entry { background: rgba(255,255,255,0.03); border-radius: 6px; padding: 12px; border-left: 3px solid transparent; transition: all 0.2s; }
  .log-entry:hover { background: rgba(255,255,255,0.06); transform: translateX(2px); }
  
  .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .type-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
  .timestamp { font-size: 11px; color: var(--text-dim); opacity: 0.7; }
  .action { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
  .details { font-size: 11px; color: var(--text-dim); display: flex; flex-wrap: wrap; gap: 12px; opacity: 0.8; font-family: monospace; }
  
  .status-msg { display: flex; justify-content: center; align-items: center; height: 100%; color: var(--text-dim); font-size: 13px; font-style: italic; }

  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  :global(.spin) { animation: spin 1s linear infinite; }
</style>
