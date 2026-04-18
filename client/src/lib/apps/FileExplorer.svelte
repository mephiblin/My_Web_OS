<script>
  import { onMount } from 'svelte';
  import { Folder, File, FileText, ChevronLeft, ChevronRight, RotateCcw, Plus, Trash2 } from 'lucide-svelte';
  import { openWindow } from '../windowStore.js';

  let currentPath = $state('/home/inri');
  let items = $state([]);
  let loading = $state(false);
  let selectedItem = $state(null);

  async function fetchItems(path) {
    loading = true;
    try {
      const res = await fetch(`http://localhost:3000/api/fs/list?path=${encodeURIComponent(path)}`);
      const data = await res.json();
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

  function handleDblClick(item) {
    if (item.isDirectory) {
      fetchItems(item.path);
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
      await fetch('http://localhost:3000/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${currentPath}/${name}`, content: '' })
      });
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  async function createFolder() {
    const name = prompt('Enter folder name:');
    if (!name) return;
    try {
      await fetch('http://localhost:3000/api/fs/create-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${currentPath}/${name}` })
      });
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteItem() {
    if (!selectedItem) return;
    if (!confirm(`Delete ${selectedItem.name}?`)) return;
    try {
      await fetch('http://localhost:3000/api/fs/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedItem.path })
      });
      selectedItem = null;
      fetchItems(currentPath);
    } catch (err) {
      console.error(err);
    }
  }

  function handlePathKeydown(e) {
    if (e.key === 'Enter') fetchItems(currentPath);
  }

  onMount(() => {
    fetchItems(currentPath);
  });
</script>

<div class="file-explorer">
  <div class="toolbar">
    <div class="nav-controls">
      <button onclick={goBack}><ChevronLeft size={16} /></button>
      <button><ChevronRight size={16} /></button>
      <button onclick={() => fetchItems(currentPath)}><RotateCcw size={16} /></button>
    </div>
    <div class="path-bar">
      <input type="text" bind:value={currentPath} onkeydown={handlePathKeydown} />
    </div>
    <div class="actions">
      <button title="New File" onclick={createFile}><FileText size={16} /></button>
      <button title="New Folder" onclick={createFolder}><Plus size={16} /></button>
      <button title="Delete" class="delete" onclick={deleteItem} disabled={!selectedItem}><Trash2 size={16} /></button>
    </div>
  </div>

  <div class="content-area">
    {#if loading}
      <div class="loading">Loading...</div>
    {:else}
      <div class="grid">
        {#each items as item}
          <div
            class="item {selectedItem?.path === item.path ? 'selected' : ''}"
            onclick={() => selectedItem = item}
            ondblclick={() => handleDblClick(item)}
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

<style>
  .file-explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    color: var(--text-main);
  }

  .toolbar {
    height: 48px;
    background: rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 12px;
    border-bottom: 1px solid var(--glass-border);
  }

  .nav-controls, .actions {
    display: flex;
    gap: 4px;
  }

  .toolbar button {
    background: transparent;
    border: none;
    color: var(--text-dim);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    cursor: pointer;
  }

  .toolbar button:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }

  .toolbar button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .path-bar {
    flex: 1;
  }

  .path-bar input {
    width: 100%;
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--glass-border);
    border-radius: 4px;
    color: white;
    padding: 4px 12px;
    font-size: 13px;
  }

  .content-area {
    flex: 1;
    overflow: auto;
    padding: 20px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 20px;
  }

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s;
    border: 1px solid transparent;
  }

  .item:hover {
    background: rgba(255,255,255,0.05);
  }

  .item.selected {
    background: rgba(88, 166, 255, 0.2);
    border: 1px solid var(--accent-blue);
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .name {
    font-size: 12px;
    text-align: center;
    word-break: break-all;
    max-width: 100%;
  }

  .loading {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    color: var(--text-dim);
  }
</style>
