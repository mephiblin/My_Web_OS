<script>
  import { onMount } from 'svelte';
  import { FileText, Download, Maximize, ZoomIn, ZoomOut, RotateCcw } from 'lucide-svelte';
  import { API_BASE } from '../../utils/constants.js';

  let { data = {} } = $props();
  let docPath = $derived(data.path || '');
  let fileName = $derived(docPath.split('/').pop() || 'Document');
  
  // Use /api/fs/raw with token for authenticated viewing
  let docUrl = $derived(docPath ? `${API_BASE}/api/fs/raw?path=${encodeURIComponent(docPath)}&token=${localStorage.getItem('web_os_token')}` : '');

  function handleDownload() {
    if (!docUrl) return;
    const a = document.createElement('a');
    a.href = docUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
</script>

<div class="document-viewer-app">
  <div class="viewer-toolbar glass-effect">
    <div class="file-info">
      <FileText size={18} class="doc-icon" />
      <span class="file-name">{fileName}</span>
    </div>
    
    <div class="actions">
      <button class="action-btn" onclick={handleDownload} title="Download">
        <Download size={18} />
      </button>
      <button class="action-btn" onclick={() => {}} title="Zoom In (Built-in)">
        <ZoomIn size={18} />
      </button>
      <button class="action-btn" onclick={() => {}} title="Zoom Out (Built-in)">
        <ZoomOut size={18} />
      </button>
    </div>
  </div>

  <div class="viewer-content">
    {#if docUrl}
      <iframe 
        src={docUrl} 
        title={fileName}
        frameborder="0"
        width="100%"
        height="100%"
      ></iframe>
    {:else}
      <div class="empty-state">
        <FileText size={48} />
        <p>No document selected or unsupported format.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .document-viewer-app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    color: white;
    overflow: hidden;
  }

  .viewer-toolbar {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .doc-icon {
    color: #ff4b4b; /* PDF Red icon color */
  }

  .file-name {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .viewer-content {
    flex: 1;
    position: relative;
    background: #333;
  }

  iframe {
    border: none;
    background: white;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: rgba(255, 255, 255, 0.3);
    gap: 16px;
  }
</style>
