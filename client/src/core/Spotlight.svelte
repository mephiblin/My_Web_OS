<script>
  import { onMount } from 'svelte';
  import { Search, Command, AppWindow, File, Folder, Settings, LogOut, Power, RefreshCw } from 'lucide-svelte';
  import { spotlightVisible, spotlightQuery, closeSpotlight } from './stores/spotlightStore.js';
  import { openWindow } from './stores/windowStore.js';
  import { addToast } from './stores/toastStore.js';
  import * as fsApi from '../apps/file-explorer/api.js';

  let inputEl;
  let results = $state([]);
  let selectedIndex = $state(0);

  // Mock apps list (in a real app, this should be a global store of apps)
  const apps = [
    { id: 'files', title: 'File Station', icon: File },
    { id: 'terminal', title: 'Terminal', icon: Command },
    { id: 'monitor', title: 'Resource Monitor', icon: Settings },
    { id: 'docker', title: 'Docker', icon: AppWindow },
    { id: 'settings', title: 'Settings', icon: Settings }
  ];

  const actions = [
    { id: 'logout', title: 'Log Out', icon: LogOut, type: 'action' },
    { id: 'reboot', title: 'Reboot', icon: RefreshCw, type: 'action' },
    { id: 'shutdown', title: 'Shut Down', icon: Power, type: 'action' }
  ];

  $effect(() => {
    if ($spotlightVisible && inputEl) {
      inputEl.focus();
    }
  });

  let debounceTimer;

  $effect(() => {
    const q = $spotlightQuery.trim().toLowerCase();
    if (!q) {
      results = [];
      if (debounceTimer) clearTimeout(debounceTimer);
      return;
    }

    const appResults = apps.filter(a => a.title.toLowerCase().includes(q));
    const actionResults = actions.filter(a => a.title.toLowerCase().includes(q));
    
    results = [...appResults, ...actionResults];
    selectedIndex = 0;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const fileResults = await fsApi.searchFiles(q);
        const mappedFiles = fileResults.map(f => ({
          id: f.path,
          title: f.name,
          type: f.type === 'dir' ? 'Folder' : 'File',
          icon: f.type === 'dir' ? Folder : File,
          path: f.path
        }));
        
        results = [...appResults, ...actionResults, ...mappedFiles];
      } catch (err) {
        console.error('Search error', err);
      }
    }, 300);
  });

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      closeSpotlight();
    } else if (e.key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % results.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (results[selectedIndex]) {
        executeResult(results[selectedIndex]);
      }
    }
  }

  function executeResult(item) {
    if (item.type === 'action') {
      addToast(`${item.title} action triggered (Mock)`, 'info');
    } else if (item.type === 'File') {
      openWindow({ id: 'editor', title: `Editor - ${item.title}`, icon: File }, { path: item.path });
    } else if (item.type === 'Folder') {
      openWindow({ id: 'files', title: 'File Station', icon: Folder }); // Opening folder directly may require state passing. Usually ok to just open File Station.
    } else {
      openWindow(item);
    }
    closeSpotlight();
  }
</script>

{#if $spotlightVisible}
  <div class="spotlight-overlay" onclick={closeSpotlight} onkeydown={handleKeydown} role="button" tabindex="-1">
    <div class="spotlight-box glass-effect" onclick={(e) => e.stopPropagation()}>
      <div class="search-input">
        <Search size={24} class="search-icon" />
        <input 
          bind:this={inputEl}
          bind:value={$spotlightQuery}
          placeholder="Spotlight Search..."
          spellcheck="false"
        />
        <div class="shortcut">
          <Command size={14} /> <span>SPACE</span>
        </div>
      </div>

      {#if results.length > 0}
        <div class="results">
          {#each results as result, i}
            <button 
              class="result-item {i === selectedIndex ? 'selected' : ''}"
              onclick={() => executeResult(result)}
              onmouseenter={() => selectedIndex = i}
            >
              <div class="icon-box">
                <svelte:component this={result.icon} size={20} />
              </div>
              <span class="title">{result.title}</span>
              <span class="type">{result.type || 'App'}</span>
            </button>
          {/each}
        </div>
      {:else if $spotlightQuery}
        <div class="no-results">
          <p>No results for "{$spotlightQuery}"</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .spotlight-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    z-index: 10000;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .spotlight-box {
    width: 600px;
    height: fit-content;
    max-height: 500px;
    background: rgba(25, 25, 25, 0.85);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    box-shadow: 0 32px 64px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .search-input {
    display: flex;
    align-items: center;
    padding: 20px;
    gap: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .search-icon { color: var(--accent-blue); }

  input {
    flex: 1;
    background: transparent;
    border: none;
    color: white;
    font-size: 20px;
    font-weight: 500;
    outline: none;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.1);
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 700;
  }

  .results {
    padding: 8px;
    overflow-y: auto;
  }

  .result-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    background: transparent;
    border: none;
    color: white;
    cursor: pointer;
    transition: all 0.1s;
  }

  .result-item.selected {
    background: var(--accent-blue);
    box-shadow: 0 4px 12px rgba(88, 166, 255, 0.3);
  }

  .icon-box {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
  }

  .result-item.selected .icon-box {
    background: rgba(255, 255, 255, 0.2);
  }

  .title { flex: 1; text-align: left; font-size: 15px; font-weight: 500; }
  .type { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .result-item.selected .type { color: rgba(255, 255, 255, 0.7); }

  .no-results { padding: 40px; text-align: center; color: var(--text-dim); }
</style>
