<script>
  import { onDestroy } from 'svelte';
  import { Download, Copy, Loader2, RefreshCw, CircleX, AlertTriangle, ArrowDownToLine, FolderInput, Clock3 } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import { notifications } from '../../core/stores/notificationStore.js';
  import { cancelTransferJob, createLocalCopyJob, createUrlDownloadJob, isRunningStatus, listTransferJobs } from './api.js';

  const POLL_INTERVAL_MS = 2000;

  let createMode = $state('url-download');
  let creating = $state(false);
  let refreshing = $state(false);
  let jobs = $state([]);
  let cancelingIds = $state(new Set());
  let operationError = $state('');
  let lastSyncAt = $state(null);
  let pollTimer = null;

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

  const runningJobs = $derived(jobs.filter((job) => isRunningStatus(job.status)));
  const failedJobs = $derived(jobs.filter((job) => job.status === 'error' || job.status === 'failed'));

  function showError(message, code = 'TRANSFER_UI_ERROR') {
    const text = message || 'Transfer operation failed.';
    operationError = text;
    addToast(text, 'error');
    notifications.add({
      title: `Transfer (${code})`,
      message: text,
      type: 'error'
    });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function statusClass(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'completed' || value === 'success') return 'completed';
    if (value === 'error' || value === 'failed') return 'error';
    if (value === 'cancelled' || value === 'canceled') return 'cancelled';
    if (isRunningStatus(value)) return 'running';
    return 'unknown';
  }

  async function refreshJobs(silent = false) {
    if (!silent) refreshing = true;
    try {
      const result = await listTransferJobs();
      jobs = Array.isArray(result.jobs) ? result.jobs : [];
      lastSyncAt = Date.now();
      if (!silent) addToast('Transfer jobs refreshed', 'success');
    } catch (err) {
      showError(err?.message, err?.code);
    } finally {
      refreshing = false;
    }
  }

  function resetCurrentForm() {
    if (createMode === 'url-download') {
      urlForm = { url: '', destinationDir: '', fileName: '' };
      return;
    }
    copyForm = { sourcePath: '', destinationDir: '', fileName: '' };
  }

  async function handleCreateJob() {
    operationError = '';
    creating = true;

    try {
      if (createMode === 'url-download') {
        if (!urlForm.url.trim() || !urlForm.destinationDir.trim()) {
          showError('URL and destination directory are required.', 'TRANSFER_CREATE_URL_INVALID_INPUT');
          return;
        }
        await createUrlDownloadJob(urlForm);
        addToast('URL download job created', 'success');
        notifications.add({ title: 'Transfer', message: 'URL download job queued.', type: 'success' });
      } else {
        if (!copyForm.sourcePath.trim() || !copyForm.destinationDir.trim()) {
          showError('Source path and destination directory are required.', 'TRANSFER_CREATE_COPY_INVALID_INPUT');
          return;
        }
        await createLocalCopyJob(copyForm);
        addToast('Local copy job created', 'success');
        notifications.add({ title: 'Transfer', message: 'Local copy job queued.', type: 'success' });
      }

      resetCurrentForm();
      await refreshJobs(true);
    } catch (err) {
      showError(err?.message, err?.code);
    } finally {
      creating = false;
    }
  }

  async function handleCancelJob(job) {
    if (!job?.id) {
      showError('Invalid transfer job id.', 'TRANSFER_CANCEL_INVALID_ID');
      return;
    }
    const nextSet = new Set(cancelingIds);
    nextSet.add(job.id);
    cancelingIds = nextSet;
    operationError = '';

    try {
      await cancelTransferJob(job.id);
      addToast(`Cancelled job ${job.id}`, 'success');
      notifications.add({
        title: 'Transfer',
        message: `Cancel requested for job ${job.id}.`,
        type: 'info'
      });
      await refreshJobs(true);
    } catch (err) {
      showError(err?.message, err?.code);
    } finally {
      const doneSet = new Set(cancelingIds);
      doneSet.delete(job.id);
      cancelingIds = doneSet;
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      refreshJobs(true);
    }, POLL_INTERVAL_MS);
  }

  refreshJobs(true);
  startPolling();

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<div class="transfer-app">
  <section class="console-head glass-effect">
    <div class="title-wrap">
      <ArrowDownToLine size={17} />
      <h2>Transfer Manager</h2>
      <span class="meta">Running {runningJobs.length} / Failed {failedJobs.length}</span>
    </div>

    <div class="head-actions">
      <button class="ghost-btn" onclick={() => refreshJobs(false)} disabled={refreshing}>
        {#if refreshing}
          <Loader2 size={14} class="spin" />
          Refreshing
        {:else}
          <RefreshCw size={14} />
          Refresh
        {/if}
      </button>
      <span class="sync-time">
        <Clock3 size={13} />
        Last sync: {formatDateTime(lastSyncAt)}
      </span>
    </div>
  </section>

  {#if operationError}
    <div class="error-banner">
      <AlertTriangle size={14} />
      <span>{operationError}</span>
    </div>
  {/if}

  <section class="create-panel glass-effect">
    <div class="mode-switch">
      <button class:active={createMode === 'url-download'} onclick={() => (createMode = 'url-download')}>
        <Download size={14} />
        URL Download
      </button>
      <button class:active={createMode === 'local-copy'} onclick={() => (createMode = 'local-copy')}>
        <Copy size={14} />
        Local Copy
      </button>
    </div>

    {#if createMode === 'url-download'}
      <div class="form-grid">
        <label>
          URL
          <input type="text" bind:value={urlForm.url} placeholder="https://example.com/archive.zip" />
        </label>
        <label>
          Destination Directory
          <input type="text" bind:value={urlForm.destinationDir} placeholder="/home/user/Downloads" />
        </label>
        <label>
          Optional File Name
          <input type="text" bind:value={urlForm.fileName} placeholder="archive.zip" />
        </label>
      </div>
    {:else}
      <div class="form-grid">
        <label>
          Source Path
          <input type="text" bind:value={copyForm.sourcePath} placeholder="/home/user/source/file.iso" />
        </label>
        <label>
          Destination Directory
          <input type="text" bind:value={copyForm.destinationDir} placeholder="/home/user/target" />
        </label>
        <label>
          Optional File Name
          <input type="text" bind:value={copyForm.fileName} placeholder="file-copy.iso" />
        </label>
      </div>
    {/if}

    <div class="submit-row">
      <button class="create-btn" onclick={handleCreateJob} disabled={creating}>
        {#if creating}
          <Loader2 size={14} class="spin" />
          Creating...
        {:else}
          <FolderInput size={14} />
          Create Job
        {/if}
      </button>
    </div>
  </section>

  <section class="jobs-panel glass-effect">
    <div class="jobs-title">Jobs</div>

    {#if jobs.length === 0}
      <div class="empty">No transfer jobs found.</div>
    {:else}
      <div class="job-list">
        {#each jobs as job}
          <article class="job-card">
            <div class="job-top">
              <div class="job-main">
                <div class="job-line">
                  <span class="job-id">{job.id}</span>
                  <span class="job-type">{job.type}</span>
                  <span class="status {statusClass(job.status)}">{job.status || 'unknown'}</span>
                </div>
                <div class="job-path">{job.sourcePath || job.url || '-'}</div>
                <div class="job-path">to {job.destinationDir || '-'}</div>
                {#if job.fileName}
                  <div class="job-path">as {job.fileName}</div>
                {/if}
              </div>

              {#if isRunningStatus(job.status)}
                <button
                  class="cancel-btn"
                  onclick={() => handleCancelJob(job)}
                  disabled={cancelingIds.has(job.id)}
                >
                  {#if cancelingIds.has(job.id)}
                    <Loader2 size={13} class="spin" />
                    Canceling...
                  {:else}
                    <CircleX size={13} />
                    Cancel
                  {/if}
                </button>
              {/if}
            </div>

            <div class="progress-wrap">
              <div class="progress-bar">
                <span style="width: {job.progress}%"></span>
              </div>
              <span class="progress-text">{job.progress}%</span>
            </div>

            {#if job.error}
              <div class="job-error">
                <AlertTriangle size={12} />
                <span>{job.error}</span>
              </div>
            {/if}

            <div class="job-time">Updated: {formatDateTime(job.updatedAt || job.createdAt)}</div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .transfer-app {
    height: 100%;
    display: grid;
    grid-template-rows: auto auto auto 1fr;
    gap: 10px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .console-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--glass-border);
    border-radius: 12px;
  }

  .title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent-blue);
  }

  .title-wrap h2 {
    margin: 0;
    font-size: 14px;
    color: white;
  }

  .meta {
    color: var(--text-dim);
    font-size: 12px;
    margin-left: 4px;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--glass-border);
    color: var(--text-primary);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .ghost-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .sync-time {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font-size: 11px;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid rgba(239, 68, 68, 0.45);
    background: rgba(239, 68, 68, 0.12);
    color: #fecaca;
    border-radius: 10px;
    padding: 9px 11px;
    font-size: 12px;
  }

  .create-panel,
  .jobs-panel {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 10px;
  }

  .mode-switch {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }

  .mode-switch button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
  }

  .mode-switch button.active {
    color: white;
    border-color: rgba(88, 166, 255, 0.6);
    background: rgba(88, 166, 255, 0.16);
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  label {
    display: grid;
    gap: 4px;
    color: var(--text-dim);
    font-size: 11px;
  }

  input {
    border: 1px solid var(--glass-border);
    background: rgba(255, 255, 255, 0.04);
    color: white;
    border-radius: 8px;
    padding: 7px 9px;
    font-size: 12px;
    outline: none;
  }

  input:focus {
    border-color: rgba(88, 166, 255, 0.6);
    box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.35);
  }

  .submit-row {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }

  .create-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 8px;
    padding: 7px 12px;
    background: var(--accent-blue);
    color: white;
    font-size: 12px;
    cursor: pointer;
    font-weight: 600;
  }

  .create-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .jobs-panel {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .jobs-title {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
  }

  .empty {
    border: 1px dashed var(--glass-border);
    border-radius: 10px;
    padding: 18px;
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
  }

  .job-list {
    overflow: auto;
    min-height: 0;
    display: grid;
    gap: 8px;
    padding-right: 2px;
  }

  .job-card {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 9px;
    background: rgba(255, 255, 255, 0.03);
    display: grid;
    gap: 7px;
  }

  .job-top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: flex-start;
  }

  .job-main {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 3px;
  }

  .job-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .job-id {
    font-size: 11px;
    color: white;
    font-weight: 600;
  }

  .job-type {
    font-size: 10px;
    color: var(--text-dim);
    border: 1px solid var(--glass-border);
    border-radius: 99px;
    padding: 1px 7px;
  }

  .status {
    font-size: 10px;
    border-radius: 99px;
    padding: 1px 7px;
    border: 1px solid transparent;
  }

  .status.running {
    color: #93c5fd;
    border-color: rgba(147, 197, 253, 0.45);
    background: rgba(59, 130, 246, 0.14);
  }

  .status.completed {
    color: #86efac;
    border-color: rgba(134, 239, 172, 0.35);
    background: rgba(34, 197, 94, 0.12);
  }

  .status.error {
    color: #fca5a5;
    border-color: rgba(252, 165, 165, 0.4);
    background: rgba(239, 68, 68, 0.12);
  }

  .status.cancelled {
    color: #d1d5db;
    border-color: rgba(209, 213, 219, 0.35);
    background: rgba(156, 163, 175, 0.12);
  }

  .status.unknown {
    color: var(--text-dim);
    border-color: var(--glass-border);
    background: rgba(255, 255, 255, 0.05);
  }

  .job-path {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cancel-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.14);
    color: #fecaca;
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .cancel-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .progress-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .progress-bar {
    flex: 1;
    height: 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .progress-bar span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #60a5fa, #38bdf8);
    transition: width 0.2s ease;
  }

  .progress-text {
    font-size: 11px;
    color: var(--text-dim);
    min-width: 36px;
    text-align: right;
  }

  .job-error {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    color: #fca5a5;
    font-size: 11px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 8px;
    padding: 5px 7px;
  }

  .job-time {
    font-size: 10px;
    color: var(--text-dim);
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 980px) {
    .form-grid {
      grid-template-columns: 1fr;
    }

    .console-head {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
