<script>
  import { FileText, Download, Maximize, ZoomIn, ZoomOut, RotateCcw, Search, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { API_BASE } from '../../../../utils/constants.js';
  import { fetchDocumentText } from '../services/documentApi.js';
  import { collectMatchOffsets, renderHighlightedText } from '../services/textSearch.js';

  let { data = {} } = $props();

  let docPath = $derived(data?.path || '');
  let fileName = $derived(docPath.split('/').pop() || '문서');
  let extension = $derived(fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '');
  let isPdf = $derived(extension === 'pdf');
  let isTextDoc = $derived(new Set(['txt', 'md', 'markdown', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yml', 'yaml', 'csv', 'log']).has(extension));

  let zoomLevel = $state(100);
  let page = $state(1);
  let searchQuery = $state('');
  let currentMatchIndex = $state(0);
  let textContent = $state('');
  let loadingText = $state(false);
  let textError = $state('');
  let contentContainer = $state(null);

  let rawDocUrl = $derived(
    docPath
      ? `${API_BASE}/api/fs/raw?path=${encodeURIComponent(docPath)}&token=${localStorage.getItem('web_os_token')}`
      : ''
  );

  let iframeDocUrl = $derived.by(() => {
    if (!rawDocUrl || !isPdf) return rawDocUrl;
    const fragments = [`zoom=${Math.max(50, Math.min(300, zoomLevel))}`];
    if (page > 1) {
      fragments.push(`page=${page}`);
    }
    if (searchQuery.trim()) {
      fragments.push(`search=${encodeURIComponent(searchQuery.trim())}`);
    }
    return `${rawDocUrl}#${fragments.join('&')}`;
  });

  function handleDownload() {
    if (!rawDocUrl) return;
    const a = document.createElement('a');
    a.href = rawDocUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  let matchOffsets = $derived(collectMatchOffsets(textContent, searchQuery.trim()));
  let renderedTextHtml = $derived(renderHighlightedText(textContent, searchQuery.trim(), currentMatchIndex));

  function syncActiveMatchIntoView() {
    if (!contentContainer || !searchQuery.trim()) return;
    const activeMark = contentContainer.querySelector(`mark[data-match-index="${currentMatchIndex}"]`);
    if (activeMark) {
      activeMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  async function loadTextContent() {
    if (!docPath || !isTextDoc) {
      textContent = '';
      return;
    }
    loadingText = true;
    textError = '';
    try {
      const response = await fetchDocumentText(docPath);
      textContent = String(response?.content || '');
      currentMatchIndex = 0;
    } catch (err) {
      textContent = '';
      textError = err?.message || '텍스트 문서를 불러오지 못했습니다.';
    } finally {
      loadingText = false;
    }
  }

  function zoomIn() {
    zoomLevel = Math.min(300, zoomLevel + 10);
  }

  function zoomOut() {
    zoomLevel = Math.max(50, zoomLevel - 10);
  }

  function resetView() {
    zoomLevel = 100;
    page = 1;
    currentMatchIndex = 0;
  }

  function goToNextMatch() {
    if (!matchOffsets.length) return;
    currentMatchIndex = (currentMatchIndex + 1) % matchOffsets.length;
    syncActiveMatchIntoView();
  }

  function goToPreviousMatch() {
    if (!matchOffsets.length) return;
    currentMatchIndex = (currentMatchIndex - 1 + matchOffsets.length) % matchOffsets.length;
    syncActiveMatchIntoView();
  }

  function toggleFullscreen() {
    if (!contentContainer) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    contentContainer.requestFullscreen?.();
  }

  $effect(() => {
    if (docPath) {
      loadTextContent();
      resetView();
    }
  });

  $effect(() => {
    if (currentMatchIndex >= matchOffsets.length) {
      currentMatchIndex = 0;
    }
  });

  $effect(() => {
    syncActiveMatchIntoView();
  });
</script>

<div class="document-viewer-app">
  <div class="viewer-toolbar glass-effect">
    <div class="file-info">
      <FileText size={18} />
      <span class="file-name">{fileName}</span>
      <span class="file-ext">{extension || '파일'}</span>
    </div>

    <div class="toolbar-center">
      <div class="search-box">
        <Search size={14} />
        <input type="text" placeholder="문서에서 검색..." bind:value={searchQuery} disabled={!isPdf && !isTextDoc} />
      </div>
      <div class="search-nav">
        <button class="action-btn" onclick={goToPreviousMatch} disabled={!searchQuery.trim() || !matchOffsets.length} title="이전 결과">
          <ChevronLeft size={16} />
        </button>
        <span class="search-count">
          {#if searchQuery.trim()}
            {matchOffsets.length === 0 ? '0/0' : `${currentMatchIndex + 1}/${matchOffsets.length}`}
          {:else}
            -
          {/if}
        </span>
        <button class="action-btn" onclick={goToNextMatch} disabled={!searchQuery.trim() || !matchOffsets.length} title="다음 결과">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>

    <div class="actions">
      <button class="action-btn" onclick={() => page = Math.max(1, page - 1)} disabled={!isPdf} title="이전 페이지">
        <ChevronLeft size={18} />
      </button>
      <span class="page-indicator">{isPdf ? `${page}페이지` : '-'}</span>
      <button class="action-btn" onclick={() => page += 1} disabled={!isPdf} title="다음 페이지">
        <ChevronRight size={18} />
      </button>
      <button class="action-btn" onclick={zoomOut} disabled={!isPdf} title="축소">
        <ZoomOut size={18} />
      </button>
      <span class="zoom-indicator">{zoomLevel}%</span>
      <button class="action-btn" onclick={zoomIn} disabled={!isPdf} title="확대">
        <ZoomIn size={18} />
      </button>
      <button class="action-btn" onclick={resetView} title="뷰 초기화">
        <RotateCcw size={18} />
      </button>
      <button class="action-btn" onclick={toggleFullscreen} title="전체 화면">
        <Maximize size={18} />
      </button>
      <button class="action-btn" onclick={handleDownload} title="다운로드">
        <Download size={18} />
      </button>
    </div>
  </div>

  <div class="viewer-content" bind:this={contentContainer}>
    {#if !docPath}
      <div class="empty-state">
        <FileText size={48} />
        <p>선택된 문서가 없습니다.</p>
      </div>
    {:else if isTextDoc}
      {#if loadingText}
        <div class="empty-state"><p>텍스트 내용을 불러오는 중...</p></div>
      {:else if textError}
        <div class="empty-state error"><p>{textError}</p></div>
      {:else}
        <pre class="text-viewer" style:font-size={`${Math.max(12, Math.round(zoomLevel / 10))}px`}>
          {@html renderedTextHtml}
        </pre>
      {/if}
    {:else}
      <iframe src={iframeDocUrl} title={fileName} frameborder="0" width="100%" height="100%"></iframe>
    {/if}
  </div>
</div>

<style>
  .document-viewer-app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #14171d;
    color: #e8edf8;
    overflow: hidden;
  }
  .viewer-toolbar {
    min-height: 52px;
    display: grid;
    grid-template-columns: 1fr minmax(260px, 420px) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .file-name {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-ext {
    font-size: 11px;
    opacity: 0.72;
    text-transform: uppercase;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .toolbar-center {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    padding: 0 8px;
    height: 32px;
    flex: 1;
  }
  .search-box input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: #e8edf8;
    outline: none;
    font-size: 12px;
  }
  .search-nav {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .search-count {
    min-width: 42px;
    text-align: center;
    font-family: monospace;
    font-size: 12px;
    opacity: 0.8;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .action-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #dce6fb;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .action-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .action-btn:not(:disabled):hover {
    border-color: rgba(88, 166, 255, 0.7);
    background: rgba(88, 166, 255, 0.15);
  }
  .zoom-indicator, .page-indicator {
    min-width: 56px;
    text-align: center;
    font-size: 11px;
    font-family: monospace;
    opacity: 0.85;
  }
  .viewer-content {
    flex: 1;
    min-height: 0;
    background: #0f1217;
    overflow: auto;
  }
  iframe {
    border: none;
    background: #fff;
  }
  .text-viewer {
    margin: 0;
    padding: 18px;
    color: #e8edf8;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
  }
  .text-viewer :global(mark) {
    background: rgba(243, 184, 80, 0.38);
    color: #fff;
    border-radius: 4px;
    padding: 0 2px;
  }
  .text-viewer :global(mark.active) {
    background: rgba(88, 166, 255, 0.62);
  }
  .empty-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(232, 237, 248, 0.65);
    text-align: center;
    padding: 20px;
  }
  .empty-state.error {
    color: #ff8585;
  }
  @media (max-width: 1100px) {
    .viewer-toolbar {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .toolbar-center {
      width: 100%;
    }
    .actions {
      flex-wrap: wrap;
    }
  }
</style>
