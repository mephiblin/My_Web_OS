<script>
  import { onMount } from 'svelte';
  import { Folder, File, ChevronRight, X, Search, Grid, List, HardDrive, Image as ImageIcon, Video, Home, ArrowLeft } from 'lucide-svelte';
  import { apiFetch } from '../../utils/api.js';

  let { onSelect, onCancel, filter = [] } = $props();

  let currentPath = $state('');
  let items = $state([]);
  let userDirs = $state([]);
  let searchQuery = $state('');
  let isLoading = $state(false);
  let selectedItem = $state(null);

  async function loadPath(path = '') {
    isLoading = true;
    try {
      const data = await apiFetch(`/fs/list?path=${encodeURIComponent(path)}`);
      currentPath = data.path;
      items = data.items;
      selectedItem = null;
    } catch (e) {
      console.error(e);
    } finally {
      isLoading = false;
    }
  }

  async function loadUserDirs() {
    try {
      userDirs = await apiFetch('/fs/user-dirs');
    } catch (e) { console.error(e); }
  }

  onMount(async () => {
    const config = await apiFetch('/fs/config');
    await loadUserDirs();
    await loadPath(config.initialPath);
  });

  function handleItemClick(item) {
    if (item.isDirectory) {
      loadPath(item.path);
    } else {
      selectedItem = item;
    }
  }

  function goBack() {
    const parts = currentPath.split('/');
    parts.pop();
    const parentPath = parts.join('/') || '/';
    loadPath(parentPath);
  }

  function isAllowed(item) {
    if (item.isDirectory) return true;
    if (filter.length === 0) return true;
    const ext = item.name.split('.').pop().toLowerCase();
    return filter.includes(ext);
  }

  function getBreadcrumbs(p) {
    if (!p) return [];
    const INVENTORY_PATH = '/home/inri/문서/web_os/server/storage/inventory';
    const HOME_PATH = '/home/inri';
    if (p.startsWith(INVENTORY_PATH)) {
      return ['Inventory', ...p.slice(INVENTORY_PATH.length).split('/').filter(Boolean)];
    }
    if (p.startsWith(HOME_PATH)) {
      return ['Home', ...p.slice(HOME_PATH.length).split('/').filter(Boolean)];
    }
    return ['Root', ...p.split('/').filter(Boolean)];
  }

  const filteredItems = $derived(
    items.filter(i => isAllowed(i) && i.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getIcon = (item) => {
    if (item.isDirectory) return Folder;
    const ext = item.name.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ImageIcon;
    if (['mp4', 'webm', 'mov'].includes(ext)) return Video;
    return File;
  };
</script>

<div class="file-picker-overlay" onclick={onCancel}>
  <div class="file-picker-modal glass-effect" onclick={e => e.stopPropagation()}>
    <header>
      <div class="title-area">
        <ImageIcon size={18} />
        <span>Select Media</span>
      </div>
      <button class="close-btn" onclick={onCancel}><X size={18} /></button>
    </header>

    <div class="path-bar">
      <button class="nav-btn" onclick={goBack} disabled={currentPath === '/'}><ArrowLeft size={16} /></button>
      <div class="breadcrumbs">
        {#each getBreadcrumbs(currentPath) as part}
          <span class="sep">/</span>
          <span class="part">{part}</span>
        {/each}
      </div>
      <div class="search-box">
        <Search size={14} />
        <input type="text" bind:value={searchQuery} placeholder="Search files..." />
      </div>
    </div>

    <div class="body">
      <aside class="sidebar">
        <div class="section">
          <label>Inventory</label>
          <button class="side-item {currentPath.includes('wallpapers') ? 'active' : ''}" onclick={() => loadPath('/home/inri/문서/web_os/server/storage/inventory/wallpapers')}>
            <ImageIcon size={16} /> <span>Wallpapers</span>
          </button>
        </div>

        <div class="section">
          <label>Locations</label>
          <button class="side-item {currentPath === '/home/inri' ? 'active' : ''}" onclick={() => loadPath('/home/inri')}>
            <Home size={16} /> <span>Home</span>
          </button>
        </div>
        
        {#if userDirs.length > 0}
          <div class="section">
            <label>Shortcuts</label>
            {#each userDirs as dir}
              <button class="side-item" onclick={() => loadPath(dir.path)}>
                <svelte:component this={getIcon({isDirectory: true})} size={16} />
                <span>{dir.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </aside>

      <main class="grid-area">
        {#if isLoading}
          <div class="loading">Loading...</div>
        {:else}
          <div class="file-grid">
            {#each filteredItems as item}
              <button 
                class="file-item {selectedItem?.path === item.path ? 'selected' : ''}" 
                onclick={() => handleItemClick(item)}
                ondblclick={() => !item.isDirectory && onSelect(item.path)}
              >
                <div class="icon-preview {item.isDirectory ? 'dir' : ''}">
                  {#if !item.isDirectory && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(item.name.split('.').pop().toLowerCase())}
                    <img src="/api/fs/raw?path={encodeURIComponent(item.path)}" alt={item.name} loading="lazy" />
                  {:else}
                    <svelte:component this={getIcon(item)} size={item.isDirectory ? 32 : 24} />
                  {/if}
                </div>
                <span class="name">{item.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      </main>
    </div>

    <footer>
      <div class="selected-path">
        {selectedItem ? selectedItem.path : 'No file selected'}
      </div>
      <div class="actions">
        <button class="btn cancel" onclick={onCancel}>Cancel</button>
        <button class="btn select" disabled={!selectedItem} onclick={() => onSelect(selectedItem.path)}>Select</button>
      </div>
    </footer>
  </div>
</div>

<style>
  .file-picker-overlay {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    width: 100%; height: 100%;
    background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
    z-index: 10000; backdrop-filter: blur(4px);
  }
  .file-picker-modal {
    width: 800px; height: 600px; background: #1a1b1e; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px; display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  }

  header { 
    display: flex; justify-content: space-between; align-items: center; padding: 12px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2);
  }
  .title-area { display: flex; align-items: center; gap: 10px; font-weight: 600; color: #ddd; }
  .close-btn { background: none; border: none; color: #888; cursor: pointer; }
  .close-btn:hover { color: white; }

  .path-bar {
    display: flex; align-items: center; gap: 10px; padding: 10px 20px;
    background: rgba(0,0,0,0.1); border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .breadcrumbs { flex: 1; display: flex; align-items: center; font-size: 13px; color: #888; overflow: hidden; }
  .breadcrumbs .part { color: #ccc; }
  .search-box { 
    display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05);
    padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);
  }
  .search-box input { background: none; border: none; color: white; font-size: 13px; outline: none; width: 150px; }

  .body { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 180px; border-right: 1px solid rgba(255,255,255,0.05); padding: 15px 10px; display: flex; flex-direction: column; gap: 20px; }
  .section { display: flex; flex-direction: column; gap: 5px; }
  .section label { font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase; padding-left: 10px; }
  .side-item { 
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: none;
    background: transparent; color: #aaa; border-radius: 6px; cursor: pointer; text-align: left;
    font-size: 13px;
  }
  .side-item:hover { background: rgba(255,255,255,0.05); color: white; }
  .side-item.active { background: rgba(88, 166, 255, 0.2); color: #58a6ff; }

  .grid-area { flex: 1; padding: 20px; overflow-y: auto; background: rgba(0,0,0,0.1); }
  .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 15px; }
  .file-item { 
    display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px;
    border: none; background: transparent; color: #ccc; cursor: pointer; border-radius: 8px;
    transition: all 0.2s;
  }
  .file-item:hover { background: rgba(255,255,255,0.05); transform: translateY(-2px); }
  .file-item.selected { background: rgba(88, 166, 255, 0.2); color: #58a6ff; }

  .icon-preview { 
    width: 80px; height: 60px; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.3); border-radius: 6px; overflow: hidden;
  }
  .icon-preview img { width: 100%; height: 100%; object-fit: cover; }
  .icon-preview.dir { color: #58a6ff; }
  
  .name { font-size: 11px; text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  footer { 
    display: flex; justify-content: space-between; align-items: center; padding: 15px 20px;
    border-top: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2);
  }
  .selected-path { font-size: 12px; color: #666; font-family: monospace; overflow: hidden; text-overflow: ellipsis; max-width: 500px; }
  .actions { display: flex; gap: 10px; }
  .btn { padding: 8px 20px; border-radius: 6px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; }
  .btn.cancel { background: rgba(255,255,255,0.1); color: white; }
  .btn.cancel:hover { background: rgba(255,255,255,0.2); }
  .btn.select { background: #58a6ff; color: white; }
  .btn.select:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.select:hover:not(:disabled) { filter: brightness(1.1); }

  .nav-btn { background: none; border: none; color: #888; cursor: pointer; padding: 4px; border-radius: 4px; }
  .nav-btn:hover:not(:disabled) { color: white; background: rgba(255,255,255,0.1); }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }

  .loading { text-align: center; color: #666; padding-top: 50px; }
</style>
