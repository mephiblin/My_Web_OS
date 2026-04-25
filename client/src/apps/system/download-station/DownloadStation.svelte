<script>
  import { onMount, onDestroy } from 'svelte';
  import { ArrowDownToLine, CircleX, Copy, Download, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-svelte';
  import { addToast } from '../../../core/stores/toastStore.js';
  import { notifications } from '../../../core/stores/notificationStore.js';
  import {
    cancelTransferJob,
    clearTransferJobs,
    createLocalCopyJob,
    createUrlDownloadJob,
    isRunningStatus,
    listTransferJobs,
    retryTransferJob
  } from '../transfer/api.js';
  import { normalizeOpsStatus } from '../../../utils/opsStatus.js';

  const POLL_MS = 2500;

  let jobs = $state([]);
  let summary = $state({
    total: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    canceled: 0
  });
  let loading = $state(false);
  let creating = $state(false);
  let clearing = $state(false);
  let searchQuery = $state('');
  let activeFilter = $state('all');
  let activeCategory = $state('all');
  let mode = $state('url-download');
  let error = $state('');
  let cancelingIds = $state(new Set());
  let retryingIds = $state(new Set());
  let pollHandle = null;

  let urlForm = $state({
    url: '',
    destinationDir: '',
    fileName: ''
  });

  let copyForm = $state({
    sourcePath: '',
    destinationDir: '',
    fileName: ''
  });

  const CATEGORY_ORDER = ['all', 'video', 'audio', 'image', 'document', 'archive', 'copy', 'other'];

  function extname(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const idx = raw.lastIndexOf('.');
    if (idx < 0 || idx === raw.length - 1) return '';
    return raw.slice(idx + 1).toLowerCase();
  }

  function extFromJob(job) {
    const fromFile = extname(job?.fileName);
    if (fromFile) return fromFile;
    const fromSource = extname(job?.sourcePath);
    if (fromSource) return fromSource;
    const url = String(job?.url || '').trim();
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return extname(decodeURIComponent(parsed.pathname || ''));
    } catch (_err) {
      return extname(url);
    }
  }

  function inferJobCategory(job) {
    const type = String(job?.type || '').toLowerCase();
    if (type.includes('copy')) return 'copy';
    const ext = extFromJob(job);
    if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'].includes(ext)) return 'audio';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif'].includes(ext)) return 'image';
    if (['pdf', 'txt', 'md', 'markdown', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'json', 'log'].includes(ext)) return 'document';
    if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return 'archive';
    return 'other';
  }

  function classifyFailure(job) {
    const code = String(job?.errorCode || '').trim().toUpperCase();
    if (code === 'TRANSFER_PATH_NOT_ALLOWED' || code === 'TRANSFER_ACCESS_DENIED' || code === 'TRANSFER_PROTECTED_PATH') {
      return {
        cause: 'permission/path-policy',
        recovery: 'Verify ALLOWED_ROOTS and destination permissions, then retry.'
      };
    }
    if (code === 'TRANSFER_SOURCE_NOT_FOUND' || code === 'TRANSFER_PATH_NOT_FOUND') {
      return {
        cause: 'missing-source-or-target',
        recovery: 'Check source path and destination folder existence.'
      };
    }
    if (code === 'TRANSFER_TARGET_EXISTS') {
      return {
        cause: 'target-already-exists',
        recovery: 'Use another filename or remove existing target file before retry.'
      };
    }
    if (code === 'TRANSFER_INVALID_URL' || code === 'TRANSFER_DOWNLOAD_FAILED' || code === 'TRANSFER_DOWNLOAD_REDIRECT_LIMIT') {
      return {
        cause: 'network-or-remote',
        recovery: 'Check URL reachability/redirect and retry with a valid direct URL.'
      };
    }
    if (code === 'TRANSFER_INVALID_FILENAME') {
      return {
        cause: 'invalid-filename',
        recovery: 'Use a safe filename (no traversal/special path segments).'
      };
    }
    if (code === 'TRANSFER_JOB_CANCELED') {
      return {
        cause: 'canceled',
        recovery: 'Retry when ready. Cancellation was applied successfully.'
      };
    }
    return {
      cause: 'unknown',
      recovery: 'Inspect logs and retry. If repeated, validate path and network assumptions.'
    };
  }

  const filteredJobs = $derived(
    jobs.filter((job) => {
      const normalized = normalizeOpsStatus(job?.status);
      const matchesFilter = activeFilter === 'all'
        ? true
        : (activeFilter === 'running' ? isRunningStatus(normalized) : normalized === activeFilter);
      if (!matchesFilter) return false;
      const category = inferJobCategory(job);
      if (activeCategory !== 'all' && category !== activeCategory) return false;

      const q = String(searchQuery || '').trim().toLowerCase();
      if (!q) return true;
      return [
        job?.id,
        job?.fileName,
        job?.destinationDir,
        job?.url,
        job?.sourcePath
      ].some((value) => String(value || '').toLowerCase().includes(q));
    })
  );

  const categoryStats = $derived(() => {
    const counts = {
      all: jobs.length,
      video: 0,
      audio: 0,
      image: 0,
      document: 0,
      archive: 0,
      copy: 0,
      other: 0
    };
    for (const job of jobs) {
      const category = inferJobCategory(job);
      if (Object.prototype.hasOwnProperty.call(counts, category)) {
        counts[category] += 1;
      }
    }
    return counts;
  });

  const recentJobs = $derived(filteredJobs.slice(0, 20));
  const failedJobs = $derived(filteredJobs.filter((job) => normalizeOpsStatus(job?.status) === 'failed'));
  const failedCauseGroups = $derived(() => {
    const map = new Map();
    for (const job of failedJobs) {
      const reason = classifyFailure(job);
      const key = reason.cause;
      if (!map.has(key)) {
        map.set(key, { cause: key, recovery: reason.recovery, jobs: [] });
      }
      map.get(key).jobs.push(job);
    }
    return [...map.values()].sort((a, b) => b.jobs.length - a.jobs.length);
  });

  function formatDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function statusClass(status) {
    const normalized = normalizeOpsStatus(status);
    if (normalized === 'failed') return 'failed';
    if (normalized === 'completed') return 'completed';
    if (normalized === 'canceled') return 'canceled';
    if (isRunningStatus(normalized)) return 'running';
    return 'unknown';
  }

  function setError(message, code = 'DOWNLOAD_STATION_ERROR') {
    const text = String(message || '').trim() || 'Operation failed.';
    error = text;
    addToast(text, 'error');
    notifications.add({
      title: `Download Station (${code})`,
      message: text,
      type: 'error'
    });
  }

  async function refreshJobs(silent = false) {
    if (!silent) loading = true;
    try {
      const payload = await listTransferJobs();
      jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : summary;
      if (!silent) addToast('Download Station refreshed', 'success');
    } catch (err) {
      setError(err?.message, err?.code);
    } finally {
      loading = false;
    }
  }

  async function createJob() {
    creating = true;
    error = '';
    try {
      if (mode === 'url-download') {
        if (!urlForm.url.trim() || !urlForm.destinationDir.trim()) {
          setError('URL and destination directory are required.', 'DOWNLOAD_STATION_URL_REQUIRED');
          return;
        }
        await createUrlDownloadJob(urlForm);
        urlForm = { url: '', destinationDir: '', fileName: '' };
      } else {
        if (!copyForm.sourcePath.trim() || !copyForm.destinationDir.trim()) {
          setError('Source path and destination directory are required.', 'DOWNLOAD_STATION_COPY_REQUIRED');
          return;
        }
        await createLocalCopyJob(copyForm);
        copyForm = { sourcePath: '', destinationDir: '', fileName: '' };
      }
      addToast('Transfer job queued', 'success');
      await refreshJobs(true);
    } catch (err) {
      setError(err?.message, err?.code);
    } finally {
      creating = false;
    }
  }

  async function retryJob(job) {
    if (!job?.id) return;
    const next = new Set(retryingIds);
    next.add(job.id);
    retryingIds = next;
    try {
      await retryTransferJob(job.id);
      addToast(`Retry queued: ${job.fileName || job.id}`, 'success');
      await refreshJobs(true);
    } catch (err) {
      setError(err?.message, err?.code);
    } finally {
      const done = new Set(retryingIds);
      done.delete(job.id);
      retryingIds = done;
    }
  }

  async function cancelJob(job) {
    if (!job?.id) return;
    const next = new Set(cancelingIds);
    next.add(job.id);
    cancelingIds = next;
    try {
      await cancelTransferJob(job.id);
      addToast(`Cancel requested: ${job.fileName || job.id}`, 'info');
      await refreshJobs(true);
    } catch (err) {
      setError(err?.message, err?.code);
    } finally {
      const done = new Set(cancelingIds);
      done.delete(job.id);
      cancelingIds = done;
    }
  }

  async function clearFinished() {
    clearing = true;
    try {
      await clearTransferJobs(['completed', 'failed', 'canceled']);
      await refreshJobs(true);
      addToast('Finished history cleared', 'success');
    } catch (err) {
      setError(err?.message, err?.code);
    } finally {
      clearing = false;
    }
  }

  onMount(() => {
    refreshJobs(true);
    pollHandle = setInterval(() => {
      refreshJobs(true);
    }, POLL_MS);
  });

  onDestroy(() => {
    if (pollHandle) clearInterval(pollHandle);
  });
</script>

<div class="station">
  <div class="toolbar">
    <div class="left">
      <button class="icon-btn" title="Refresh" onclick={() => refreshJobs(false)} disabled={loading}>
        <RefreshCw size={14} class={loading ? 'spin' : ''} />
      </button>
      <button class="btn" onclick={clearFinished} disabled={clearing}>
        <Trash2 size={14} />
        {clearing ? 'Clearing...' : 'Clear Finished'}
      </button>
    </div>
    <div class="search">
      <Search size={14} />
      <input
        type="text"
        placeholder="Search downloads"
        value={searchQuery}
        oninput={(event) => searchQuery = event.currentTarget.value}
      />
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card"><span>Total</span><strong>{summary.total}</strong></div>
    <div class="summary-card"><span>Running</span><strong>{summary.running + summary.queued}</strong></div>
    <div class="summary-card"><span>Failed</span><strong>{summary.failed}</strong></div>
    <div class="summary-card"><span>Completed</span><strong>{summary.completed}</strong></div>
  </div>

  <div class="composer">
    <div class="mode-row">
      <button class:active={mode === 'url-download'} onclick={() => mode = 'url-download'}>
        <Download size={14} /> URL Download
      </button>
      <button class:active={mode === 'local-copy'} onclick={() => mode = 'local-copy'}>
        <Copy size={14} /> Local Copy
      </button>
    </div>

    {#if mode === 'url-download'}
      <div class="fields">
        <input type="text" placeholder="https://example.com/file.zip" bind:value={urlForm.url} />
        <input type="text" placeholder="/allowed/root/downloads" bind:value={urlForm.destinationDir} />
        <input type="text" placeholder="optional filename" bind:value={urlForm.fileName} />
      </div>
    {:else}
      <div class="fields">
        <input type="text" placeholder="/allowed/root/source/file.zip" bind:value={copyForm.sourcePath} />
        <input type="text" placeholder="/allowed/root/target" bind:value={copyForm.destinationDir} />
        <input type="text" placeholder="optional filename" bind:value={copyForm.fileName} />
      </div>
    {/if}

    <button class="btn primary" onclick={createJob} disabled={creating}>
      <ArrowDownToLine size={14} />
      {creating ? 'Queueing...' : 'Queue Job'}
    </button>
  </div>

  <div class="filters">
    <button class:active={activeFilter === 'all'} onclick={() => activeFilter = 'all'}>All</button>
    <button class:active={activeFilter === 'running'} onclick={() => activeFilter = 'running'}>Running</button>
    <button class:active={activeFilter === 'failed'} onclick={() => activeFilter = 'failed'}>Failed</button>
    <button class:active={activeFilter === 'completed'} onclick={() => activeFilter = 'completed'}>Completed</button>
    <button class:active={activeFilter === 'canceled'} onclick={() => activeFilter = 'canceled'}>Canceled</button>
  </div>

  <div class="filters categories">
    {#each CATEGORY_ORDER as category}
      <button class:active={activeCategory === category} onclick={() => activeCategory = category}>
        {category} ({categoryStats()[category] || 0})
      </button>
    {/each}
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="panes">
    <section class="pane">
      <h3>Recent</h3>
      {#if recentJobs.length === 0}
        <div class="empty">No jobs.</div>
      {:else}
        <div class="job-list">
          {#each recentJobs as job}
            <article class="job-card">
              <div class="job-head">
                <strong>{job.fileName || job.id}</strong>
                <span class="status {statusClass(job.status)}">{job.status}</span>
              </div>
              <div class="meta">{job.type} · {inferJobCategory(job)} · {job.destinationDir || '-'}</div>
              <div class="meta">{formatDate(job.updatedAt || job.createdAt)}</div>
              <div class="actions">
                {#if isRunningStatus(job.status)}
                  <button class="btn tiny danger" disabled={cancelingIds.has(job.id)} onclick={() => cancelJob(job)}>
                    <CircleX size={12} />
                    {cancelingIds.has(job.id) ? 'Canceling...' : 'Cancel'}
                  </button>
                {/if}
                {#if normalizeOpsStatus(job.status) === 'failed'}
                  <button class="btn tiny" disabled={retryingIds.has(job.id)} onclick={() => retryJob(job)}>
                    <RotateCcw size={12} />
                    {retryingIds.has(job.id) ? 'Retrying...' : 'Retry'}
                  </button>
                {/if}
              </div>
              {#if job.error}
                <div class="job-error">{job.error}</div>
                <div class="meta">cause: {classifyFailure(job).cause}</div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="pane">
      <h3>Failed Queue</h3>
      {#if failedJobs.length === 0}
        <div class="empty">No failed jobs.</div>
      {:else}
        <div class="job-list">
          {#each failedCauseGroups() as group}
            <article class="job-card">
              <div class="job-head">
                <strong>{group.cause}</strong>
                <span class="status failed">{group.jobs.length}</span>
              </div>
              <div class="meta">{group.recovery}</div>
              {#each group.jobs as job}
                <div class="failed-row">
                  <div class="meta">
                    <strong>{job.fileName || job.id}</strong>
                    <span>{job.errorCode || 'TRANSFER_JOB_FAILED'} · {job.error || 'Unknown error'}</span>
                  </div>
                  <button class="btn tiny" disabled={retryingIds.has(job.id)} onclick={() => retryJob(job)}>
                    <RotateCcw size={12} />
                    {retryingIds.has(job.id) ? 'Retrying...' : 'Retry'}
                  </button>
                </div>
              {/each}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .station { height: 100%; padding: 14px; display: grid; gap: 10px; overflow: auto; color: var(--text-main); }
  .toolbar { display: flex; justify-content: space-between; gap: 10px; }
  .left { display: inline-flex; gap: 8px; }
  .search { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--glass-border); border-radius: 8px; padding: 0 8px; background: rgba(0,0,0,0.2); min-width: 280px; }
  .search input { border: 0; outline: 0; background: transparent; color: var(--text-main); width: 100%; padding: 7px 0; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .summary-card { border: 1px solid var(--glass-border); border-radius: 8px; padding: 9px; background: rgba(0,0,0,0.2); display: grid; gap: 2px; }
  .summary-card span { font-size: 11px; color: var(--text-dim); text-transform: uppercase; }
  .summary-card strong { font-size: 18px; }
  .composer { border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px; display: grid; gap: 8px; background: rgba(0,0,0,0.2); }
  .mode-row { display: inline-flex; gap: 8px; }
  .mode-row button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--glass-border); background: transparent; color: var(--text-main); border-radius: 7px; padding: 6px 9px; cursor: pointer; }
  .mode-row button.active { background: rgba(88,166,255,0.18); color: #dbeafe; }
  .fields { display: grid; grid-template-columns: 1.2fr 1fr 0.8fr; gap: 8px; }
  .fields input { border: 1px solid var(--glass-border); border-radius: 7px; background: rgba(0,0,0,0.28); color: var(--text-main); padding: 8px; }
  .filters { display: inline-flex; gap: 8px; flex-wrap: wrap; }
  .filters button { border: 1px solid var(--glass-border); background: transparent; color: var(--text-main); border-radius: 999px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .filters button.active { background: rgba(88,166,255,0.18); }
  .filters.categories button { text-transform: lowercase; }
  .panes { display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px; min-height: 260px; }
  .pane { border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.2); padding: 10px; display: grid; gap: 8px; }
  .pane h3 { margin: 0; font-size: 13px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .job-list { display: grid; gap: 8px; max-height: 360px; overflow: auto; }
  .job-card { border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px; background: rgba(0,0,0,0.3); display: grid; gap: 6px; }
  .job-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .meta { font-size: 12px; color: var(--text-dim); }
  .actions { display: inline-flex; gap: 6px; }
  .failed-row { border: 1px solid var(--glass-border); border-radius: 7px; padding: 7px; display: flex; justify-content: space-between; gap: 8px; align-items: center; background: rgba(0,0,0,0.2); }
  .failed-row .meta { display: grid; gap: 2px; min-width: 0; }
  .failed-row .meta strong { font-size: 12px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .failed-row .meta span { font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px; }
  .status { font-size: 10px; text-transform: uppercase; border: 1px solid var(--glass-border); border-radius: 999px; padding: 2px 7px; }
  .status.running { color: #93c5fd; border-color: rgba(96,165,250,0.6); }
  .status.completed { color: #86efac; border-color: rgba(34,197,94,0.6); }
  .status.failed { color: #fca5a5; border-color: rgba(239,68,68,0.6); }
  .status.canceled { color: #fcd34d; border-color: rgba(245,158,11,0.6); }
  .job-error { font-size: 12px; color: #fca5a5; }
  .empty { font-size: 12px; color: var(--text-dim); }
  .btn { border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: var(--text-main); border-radius: 8px; padding: 7px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .btn.primary { background: rgba(88,166,255,0.22); color: #dbeafe; }
  .btn.tiny { font-size: 12px; padding: 5px 7px; border-radius: 6px; }
  .btn.danger { color: #fca5a5; border-color: rgba(239,68,68,0.5); }
  .icon-btn { border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: var(--text-main); border-radius: 8px; width: 32px; height: 32px; display: inline-flex; justify-content: center; align-items: center; cursor: pointer; }
  .error { border: 1px solid rgba(239,68,68,0.5); color: #fecaca; background: rgba(127,29,29,0.2); padding: 8px 10px; border-radius: 8px; font-size: 12px; }
  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  @media (max-width: 960px) {
    .summary-grid { grid-template-columns: 1fr 1fr; }
    .panes { grid-template-columns: 1fr; }
    .fields { grid-template-columns: 1fr; }
    .search { min-width: 0; flex: 1; }
  }
</style>
