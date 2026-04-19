<script>
  import { onMount } from 'svelte';
  import { 
    Folder, File, FileText, ChevronLeft, ChevronRight, RotateCcw, 
    Plus, Trash2, LayoutGrid, List, Pencil, Home, Download, Image, Video, Clock, Package, Box, Lock, Unlock, ShieldAlert,
    Search, Undo, Cloud
  } from 'lucide-svelte';
  import { notifications } from '../../core/stores/notificationStore.js';
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
  let lockedFolders = $state(JSON.parse(localStorage.getItem('web_os_locked_folders') || '[]'));

  // Search & Trash State
  let searchQuery = $state('');
  let isSearchView = $state(false);
  let isTrashView = $state(false);
  let cloudRemotes = $state([]);

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

    // Always add Inventory and Trash
    if (inventoryPath) {
      links.push({ id: 'inventory', label: 'Inventory', icon: Package, path: inventoryPath });
    }
    
    // Add Cloud Remotes
    cloudRemotes.forEach(remote => {
      links.push({ id: `cloud-${remote.name}`, label: remote.name, icon: Cloud, path: `cloud://${remote.name}/` });
    });

    links.push({ id: 'trash', label: 'Trash', icon: Trash2, path: 'trash' });

    return links;
  }

  function handleContextMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    selectedItem = item;
    
    let itemsInfo = [];
    if (isTrashView && item) {
      itemsInfo = [
        { label: 'Restore', icon: Undo, action: () => handleRestore(item) },
        { label: 'Erase Permanently', icon: Trash2, action: () => notifications.add({ title: 'Safety', message: 'Use Empty Trash to clear all items permanently.', type: 'info' }), danger: true }
      ];
    } else if (item) {
      const isLocked = lockedFolders.includes(item.path);
      itemsInfo = [
        { label: 'Open', icon: Folder, action: () => handleDblClick(item) },
        { label: 'Rename', icon: Pencil, action: () => handleRename(item) },
        { 
          label: isLocked ? 'Unlock Folder' : 'Secure Folder', 
          icon: isLocked ? Unlock : Lock, 
          action: () => toggleLockFolder(item) 
        },
        { label: 'Move to Trash', icon: Trash2, action: handleDelete, danger: true }
      ];
    } else if (isTrashView) {
      itemsInfo = [
        { label: 'Empty Trash', icon: Trash2, action: handleEmptyTrash, danger: true },
        { label: 'Refresh', icon: RotateCcw, action: fetchTrash }
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
    isSearchView = false;
    isTrashView = false;
    try {
      if (path === 'trash') {
        return fetchTrash();
      }

      // Handle Cloud Paths (cloud://remote/path)
      if (path.startsWith('cloud://')) {
        const parts = path.replace('cloud://', '').split('/');
        const remote = parts[0];
        const remotePath = parts.slice(1).join('/');
        const data = await fsApi.listCloudDir(remote, remotePath);
        items = data.map(item => ({
          ...item,
          path: `cloud://${remote}/${item.path}` // Keep virtual path consistency
        }));
        currentPath = path;
        return;
      }

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

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    loading = true;
    isSearchView = true;
    isTrashView = false;
    try {
      const data = await fsApi.searchFiles(searchQuery);
      items = data;
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function fetchTrash() {
    loading = true;
    isTrashView = true;
    isSearchView = false;
    currentPath = 'trash';
    try {
      const data = await fsApi.fetchTrash();
      items = data.map(item => ({
        ...item,
        name: item.fileName,
        path: item.id, // Use ID for trash operations
        isDirectory: false // Simplification: display as files
      }));
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  async function handleRestore(item) {
    try {
      await fsApi.restoreItem(item.id);
      notifications.add({ title: 'Trash', message: `Restored ${item.name}`, type: 'success' });
      fetchTrash();
    } catch (err) {
      notifications.add({ title: 'Error', message: 'Failed to restore item.', type: 'error' });
    }
  }

  async function handleEmptyTrash() {
    if (!confirm('Are you sure you want to permanently delete all items in trash?')) return;
    try {
      await fsApi.emptyTrash();
      notifications.add({ title: 'Trash', message: 'Trash emptied.', type: 'success' });
      fetchTrash();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDblClick(item) {
    if (isTrashView) return;

    // Cloud support for dblclick
    if (currentPath.startsWith('cloud://')) {
      if (item.isDirectory) {
        fetchItems(item.path);
      } else {
        notifications.add({ title: 'Cloud', message: 'Fetching cloud file...', type: 'info' });
        const remote = currentPath.replace('cloud://', '').split('/')[0];
        const remotePath = item.path.replace(`cloud://${remote}/`, '');
        try {
          const res = await fsApi.readCloudFile(remote, remotePath);
          openWindow({ id: 'editor', title: `Cloud Edit - ${item.name}`, icon: FileText }, { content: res.content, readonly: true });
        } catch (e) {
          notifications.add({ title: 'Error', message: 'Could not fetch cloud content.', type: 'error' });
        }
      }
      return;
    }

    if (item.isDirectory) {
      if (lockedFolders.includes(item.path)) {
        const password = prompt(`'${item.name}' is a Secure Folder. Enter Password:`);
        if (password === '1234') { // Mock password
          notifications.add({ title: 'Security', message: `Authorized access to ${item.name}`, type: 'success' });
          fetchItems(item.path);
        } else {
          notifications.add({ title: 'Security', message: `Unauthorized access attempt! Incorrect password.`, type: 'error' });
        }
        return;
      }
      fetchItems(item.path);
    } else {
      const ext = item.name.split('.').pop()?.toLowerCase();
      const isMedia = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext);
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      const is3D = ['gltf', 'glb', 'fbx', 'obj'].includes(ext);
      
      if (isMedia || isImage) {
        openWindow({ id: 'player', title: `Viewer - ${item.name}`, icon: isImage ? Image : Video }, { path: item.path });
      } else if (ext === 'pdf') {
        openWindow({ id: 'doc-viewer', title: `PDF Reader - ${item.name}`, icon: FileText }, { path: item.path });
      } else if (is3D) {
        openWindow({ id: 'model-viewer', title: `3D Viewer - ${item.name}`, icon: Box }, { path: item.path });
      } else {
        openWindow({ id: 'editor', title: `Editor - ${item.name}`, icon: FileText }, { path: item.path });
      }
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

  function toggleLockFolder(item) {
    if (lockedFolders.includes(item.path)) {
      lockedFolders = lockedFolders.filter(p => p !== item.path);
    } else {
      lockedFolders = [...lockedFolders, item.path];
    }
    localStorage.setItem('web_os_locked_folders', JSON.stringify(lockedFolders));
  }

  function handlePathKeydown(e) {
    if (e.key === 'Enter') fetchItems(currentPath);
  }

  onMount(async () => {
    try {
      const [config, userDirs, remotes] = await Promise.all([
        fsApi.fetchConfig(),
        fsApi.fetchUserDirs(),
        fsApi.fetchCloudRemotes(),
      ]);

      if (config.initialPath) {
        initialPath = config.initialPath;
        currentPath = initialPath;
      }

      cloudRemotes = remotes || [];
      inventoryPath = userDirs._inventoryPath || '';
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
      {#if isSearchView}
        <div class="search-indicator">
          <Search size={14} />
          <span>Searching for "{searchQuery}"</span>
          <button class="clear-search" onclick={() => fetchItems(currentPath)}>X</button>
        </div>
      {:else if isTrashView}
        <div class="trash-indicator">
          <Trash2 size={14} />
          <span>Trash Bin</span>
          <button class="empty-trash-btn" onclick={handleEmptyTrash}>Empty Trash</button>
        </div>
      {:else}
        <input type="text" bind:value={currentPath} onkeydown={handlePathKeydown} />
      {/if}
    </div>
    <div class="search-box">
      <input 
        type="text" 
        placeholder="Search files..." 
        bind:value={searchQuery} 
        onkeydown={(e) => e.key === 'Enter' && handleSearch()}
      />
      <button onclick={handleSearch}><Search size={16} /></button>
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
                  <div class="folder-wrapper">
                    <Folder size={viewMode === 'list' ? 32 : 48} color="var(--accent-blue)" fill="var(--accent-blue)" fill-opacity="0.2" />
                    {#if lockedFolders.includes(item.path)}
                      <div class="lock-overlay" title="Secure Folder">
                        <Lock size={viewMode === 'list' ? 10 : 14} color="white" />
                      </div>
                    {/if}
                  </div>
                {:else if isTrashView}
                  <Trash2 size={viewMode === 'list' ? 32 : 48} color="var(--accent-red)" />
                {:else}
                  <File size={viewMode === 'list' ? 32 : 48} color="var(--text-dim)" />
                {/if}
              </div>
              <div class="item-info">
                <span class="name">{item.name}</span>
                {#if isSearchView}
                  <span class="original-path">{item.path}</span>
                {:else if isTrashView && item.deletedAt}
                  <span class="delete-date">Deleted: {new Date(item.deletedAt).toLocaleDateString()}</span>
                {/if}
              </div>
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
  
  .path-bar { flex: 1; min-width: 0; }
  .path-bar input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 4px; color: white; padding: 4px 12px; font-size: 13px; }
  
  .search-box { display: flex; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 4px; padding: 2px 4px; gap: 4px; }
  .search-box input { background: transparent; border: none; color: white; padding: 2px 8px; font-size: 12px; width: 150px; outline: none; }
  
  .search-indicator, .trash-indicator { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 4px; font-size: 12px; }
  .search-indicator span, .trash-indicator span { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .clear-search, .empty-trash-btn { background: rgba(255,255,255,0.1) !important; padding: 2px 8px !important; width: auto !important; height: auto !important; font-size: 10px !important; }

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
  .item:hover { background: rgba(255,255,255,0.05); }
  .item.selected { background: rgba(88, 166, 255, 0.2); border: 1px solid var(--accent-blue); }
  
  .item-info { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; min-width: 0; }
  .view-container.list .item-info { align-items: flex-start; }
  .original-path, .delete-date { font-size: 10px; color: var(--text-dim); opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
  
  .icon { display: flex; align-items: center; justify-content: center; }
  .folder-wrapper { position: relative; display: flex; align-items: center; justify-content: center; }
  .lock-overlay { 
    position: absolute; 
    bottom: 2px; 
    right: 2px; 
    background: var(--accent-red); 
    border-radius: 50%; 
    padding: 3px; 
    display: flex; 
    align-items: center; 
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    border: 1.5px solid #000;
  }
  .name { font-size: 12px; text-align: center; word-break: break-all; max-width: 100%; border: none; background: transparent; color: inherit; outline: none; }
  .loading { display: flex; justify-content: center; align-items: center; height: 100%; color: var(--text-dim); }
</style>
