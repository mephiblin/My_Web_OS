<script>
  import { onMount } from 'svelte';
  import { 
    Folder, File, FileText, ChevronLeft, ChevronRight, RotateCcw, 
    Plus, Trash2, LayoutGrid, List, Pencil, Home, Download, Image, Video, Clock, Package 
  } from 'lucide-svelte';
  import { openWindow } from '../../core/stores/windowStore.js';
  import { openContextMenu } from '../../core/stores/contextMenuStore.js';
  import * as fsApi from './api.js';

  let currentPath = $state('/');
  let initialPath = $state('/');
  let items = $state([]);
  let loading = $state(false);
  let selectedItem = $state(null);
  let viewMode = $state('grid');
  let inventoryPath = $state('');

  let sidebarLinks = $state([
    { id: 'home', label: 'Home', icon: Home, path: '/' },
  ]);

  function buildSidebarLinks(homePath, dirs) {
    const links = [
      { id: 'home', label: 'Home', icon: Home, path: homePath },
    ];

    if (dirs.documents?.path) links.push({ id: 'documents', label: 'Documents', icon: FileText, path: dirs.documents.path });
    if (dirs.downloads?.path) links.push({ id: 'downloads', label: 'Downloads', icon: Download, path: dirs.downloads.path });
    if (dirs.pictures?.path) links.push({ id: 'pictures', label: 'Pictures', icon: Image, path: dirs.pictures.path });
    if (dirs.videos?.path) links.push({ id: 'videos', label: 'Videos', icon: Video, path: dirs.videos.path });
    if (dirs.music?.path) links.push({ id: 'music', label: 'Music', icon: Clock, path: dirs.music.path });

    // Always add Inventory at the end
    if (inventoryPath) {
      links.push({ id: 'inventory', label: 'Inventory', icon: Package, path: inventoryPath });
    }

    return links;
  }

  function handleContextMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    selectedItem = item;
    
    let itemsInfo = [];
    if (item) {
      itemsInfo = [
        { label: 'Open', icon: Folder, action: () => handleDblClick(item) },
        { label: 'Rename', icon: Pencil, action: () => handleRename(item) },
        { label: 'Delete', icon: Trash2, action: handleDelete, danger: true }
      ];
    } else {
      itemsInfo = [
        { label: 'New File', icon: FileText, action: createFile },
        { label: 'New Folder', icon: Plus, action: createFolder },
        { label: 'Refresh', icon: RotateCcw, action: () => fetchItems(currentPath) }
      ];
    }

    openContextMenu(e.clientX, e.clientY, itemsInfo);
  }

  async function fetchItems(path) {
    loading = true;
    try {
      const data = await fsApi.listDir(path);
      if (!data.error) {
        items = data.items;
        currentPath = data.path;
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

    } else {
      const ext = item.name.split('.').pop()?.toLowerCase();
      const isMedia = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext);
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      
      if (isMedia || isImage) {
        openWindow({ id: 'player', title: `Viewer - ${item.name}`, icon: isImage ? Image : Video }, { path: item.path });
      } else {
        openWindow({ id: 'editor', title: `Editor - ${item.name}`, icon: FileText }, { path: item.path });
      }
    }

  function goBack() {
    const parts = currentPath.split('/');
    parts.pop();
    const parentPath = parts.join('/') || '/';
    fetchItems(parentPath);
  }

  async function createFile() {
    const name = prompt('Enter file name:');
    if (!name) return;
    try {
      await fsApi.writeFile(`${currentPath}/${name}`, '');
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  async function createFolder() {
    const name = prompt('Enter folder name:');
    if (!name) return;
    try {
      await fsApi.createDir(`${currentPath}/${name}`);
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete() {
    if (!selectedItem) return;
    if (!confirm(`Delete ${selectedItem.name}?`)) return;
    try {
      await fsApi.deleteItem(selectedItem.path);
      selectedItem = null;
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRename(item) {
    const target = item || selectedItem;
    if (!target) return;
    const newName = prompt('Enter new name:', target.name);
    if (!newName || newName === target.name) return;
    try {
      await fsApi.renameItem(target.path, newName);
      selectedItem = null;
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  function handlePathKeydown(e) {
    if (e.key === 'Enter') fetchItems(currentPath);
  }

  onMount(async () => {
    try {
      const [config, userDirs] = await Promise.all([
        fsApi.fetchConfig(),
        fsApi.fetchUserDirs(),
      ]);

      if (config.initialPath) {
        initialPath = config.initialPath;
        currentPath = initialPath;
      }

      // Compute inventory path relative to server
      inventoryPath = userDirs._inventoryPath || '';

      // Build sidebar from detected directories
      sidebarLinks = buildSidebarLinks(userDirs.home || initialPath, userDirs);
    } catch (e) {
      console.error('Failed to load dirs:', e);
    }
    fetchItems(currentPath);
  });
</script>

<div class="file-explorer" oncontextmenu={(e) => handleContextMenu(e, null)} onclick={() => selectedItem = null}>
  <div class="toolbar">
    <div class="nav-controls">
      <button onclick={goBack} disabled={currentPath === '/'}><ChevronLeft size={16} /></button>
      <button disabled><ChevronRight size={16} /></button>
      <button onclick={() => fetchItems(currentPath)}><RotateCcw size={16} /></button>
    </div>
    <div class="path-bar">
      <input type="text" bind:value={currentPath} onkeydown={handlePathKeydown} />
    </div>
    <div class="actions">
      <button class={viewMode === 'grid' ? 'active' : ''} onclick={() => viewMode = 'grid'}><LayoutGrid size={16} /></button>
      <button class={viewMode === 'list' ? 'active' : ''} onclick={() => viewMode = 'list'}><List size={16} /></button>
      <div class="separator"></div>
      <button title="New File" onclick={createFile}><FileText size={16} /></button>
      <button title="New Folder" onclick={createFolder}><Plus size={16} /></button>
      <button title="Delete" class="delete" onclick={handleDelete} disabled={!selectedItem}><Trash2 size={16} /></button>
    </div>
  </div>

  <div class="layout-body">
    <aside class="sidebar glass-effect">
      <div class="sidebar-section">
        <h3>Places</h3>
        {#each sidebarLinks as link}
          <button 
            class="sidebar-item {currentPath === link.path ? 'active' : ''}" 
            onclick={() => fetchItems(link.path)}
          >
            <svelte:component this={link.icon} size={16} />
            <span>{link.label}</span>
          </button>
        {/each}
      </div>
    </aside>

    <div class="content-area">
      {#if loading}
        <div class="loading">Loading...</div>
      {:else}
        <div class="view-container {viewMode}">
          {#each items as item}
            <div
              class="item {selectedItem?.path === item.path ? 'selected' : ''}"
              onclick={(e) => { e.stopPropagation(); selectedItem = item; }}
              ondblclick={() => handleDblClick(item)}
              oncontextmenu={(e) => handleContextMenu(e, item)}
            >
              <div class="icon">
                {#if item.isDirectory}
                  <Folder size={48} color="var(--accent-blue)" fill="var(--accent-blue)" fill-opacity="0.2" />
                {:else}
                  <File size={48} color="var(--text-dim)" />
                {/if}
              </div>
              <span class="name">{item.name}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .file-explorer { display: flex; flex-direction: column; height: 100%; color: var(--text-main); }
  .toolbar { height: 48px; background: rgba(0,0,0,0.2); display: flex; align-items: center; padding: 0 12px; gap: 12px; border-bottom: 1px solid var(--glass-border); }
  .nav-controls, .actions { display: flex; gap: 4px; }
  .toolbar button { background: transparent; border: none; color: var(--text-dim); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px; cursor: pointer; }
  .toolbar button:hover { background: rgba(255,255,255,0.1); color: white; }
  .toolbar button.active { background: rgba(255,255,255,0.15); color: var(--accent-blue); }
  .toolbar button:disabled { opacity: 0.3; cursor: not-allowed; }
  .separator { width: 1px; background: var(--glass-border); margin: 0 4px; height: 24px; align-self: center; }
  .path-bar { flex: 1; }
  .path-bar input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 4px; color: white; padding: 4px 12px; font-size: 13px; }
  
  .layout-body { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 180px; background: rgba(0,0,0,0.15); border-right: 1px solid var(--glass-border); display: flex; flex-direction: column; padding: 12px 8px; flex-shrink: 0; }
  .sidebar-section h3 { font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin: 0 0 8px 8px; letter-spacing: 0.5px; }
  .sidebar-item { background: transparent; border: none; color: var(--text-main); display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; cursor: pointer; width: 100%; text-align: left; font-size: 13px; transition: all 0.2s; }
  .sidebar-item:hover { background: rgba(255,255,255,0.08); }
  .sidebar-item.active { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); font-weight: 500; }

  .content-area { flex: 1; overflow: auto; padding: 20px; }
  .view-container.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 20px; }
  .view-container.list { display: flex; flex-direction: column; gap: 4px; }
  .item { display: flex; border-radius: 8px; cursor: pointer; transition: background 0.2s; border: 1px solid transparent; }
  .view-container.grid .item { flex-direction: column; align-items: center; gap: 8px; padding: 10px; }
  .view-container.list .item { flex-direction: row; align-items: center; gap: 12px; padding: 6px 12px; }
  .view-container.list .icon { transform: scale(0.6); transform-origin: center; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
  .item:hover { background: rgba(255,255,255,0.05); }
  .item.selected { background: rgba(88, 166, 255, 0.2); border: 1px solid var(--accent-blue); }
  .icon { display: flex; align-items: center; justify-content: center; }
  .name { font-size: 12px; text-align: center; word-break: break-all; max-width: 100%; border: none; background: transparent; color: inherit; outline: none; }
  .loading { display: flex; justify-content: center; align-items: center; height: 100%; color: var(--text-dim); }
</style>
