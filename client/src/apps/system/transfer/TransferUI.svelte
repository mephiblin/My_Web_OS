<script>
  import { onDestroy } from 'svelte';
  import {
    Download,
    Copy,
    Loader2,
    RefreshCw,
    CircleX,
    AlertTriangle,
    ArrowDownToLine,
    FolderInput,
    Clock3,
    RotateCcw,
    Trash2
  } from 'lucide-svelte';
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
  } from './api.js';
  import { normalizeOpsStatus } from '../../../utils/opsStatus.js';

  const POLL_INTERVAL_MS = 2000;

  let createMode = $state('url-download');
  let creating = $state(false);
  let refreshing = $state(false);
  let jobs = $state([]);
  let summary = $state({
    total: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    canceled: 0
  });
  let activeFilter = $state('all');
  let cancelingIds = $state(new Set());
  let retryingIds = $state(new Set());
  let clearing = $state(false);
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
  const failedJobs = $derived(jobs.filter((job) => normalizeOpsStatus(job.status) === 'failed'));
  const filteredJobs = $derived(jobs.filter((job) => {
    if (activeFilter === 'all') return true;
    const status = normalizeOpsStatus(job.status);
    if (activeFilter === 'running') return isRunningStatus(status);
    return status === activeFilter;
  }));

  function showError(message, code = 'TRANSFER_UI_ERROR') {
    const text = message || '전송 작업에 실패했습니다.';
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

  function statusLabel(status) {
    const value = normalizeOpsStatus(status);
    if (value === 'queued' || value === 'pending') return '대기중';
    if (value === 'running') return '진행중';
    if (value === 'completed') return '완료';
    if (value === 'failed') return '실패';
    if (value === 'canceled') return '취소됨';
    return '알 수 없음';
  }

  function typeLabel(type) {
    const value = String(type || '').trim().toLowerCase();
    if (value === 'url-download') return 'URL 다운로드';
    if (value === 'local-copy') return '로컬 복사';
    return '기타';
  }

  function statusClass(status) {
    const value = normalizeOpsStatus(status);
    if (value === 'completed') return 'completed';
    if (value === 'failed') return 'error';
    if (value === 'canceled') return 'cancelled';
    if (isRunningStatus(value)) return 'running';
    return 'unknown';
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let current = bytes / 1024;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
      current /= 1024;
      unitIndex += 1;
    }
    return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[unitIndex]}`;
  }

  function progressBytesLabel(job) {
    const transferred = Number(job?.raw?.progress?.transferredBytes);
    const total = Number(job?.raw?.progress?.totalBytes);
    if (Number.isFinite(transferred) && Number.isFinite(total) && total > 0) {
      return `${formatBytes(transferred)} / ${formatBytes(total)}`;
    }
    if (Number.isFinite(transferred) && transferred > 0) {
      return formatBytes(transferred);
    }
    return '-';
  }

  async function refreshJobs(silent = false) {
    if (!silent) refreshing = true;
    try {
      const result = await listTransferJobs();
      jobs = Array.isArray(result.jobs) ? result.jobs : [];
      summary = result?.summary || summary;
      lastSyncAt = Date.now();
      if (!silent) addToast('전송 작업 목록을 새로고침했습니다.', 'success');
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
          showError('URL과 대상 디렉터리는 필수입니다.', 'TRANSFER_CREATE_URL_INVALID_INPUT');
          return;
        }
        await createUrlDownloadJob(urlForm);
        addToast('URL 다운로드 작업을 생성했습니다.', 'success');
        notifications.add({ title: 'Transfer', message: 'URL 다운로드 작업이 큐에 등록되었습니다.', type: 'success' });
      } else {
        if (!copyForm.sourcePath.trim() || !copyForm.destinationDir.trim()) {
          showError('원본 경로와 대상 디렉터리는 필수입니다.', 'TRANSFER_CREATE_COPY_INVALID_INPUT');
          return;
        }
        await createLocalCopyJob(copyForm);
        addToast('로컬 복사 작업을 생성했습니다.', 'success');
        notifications.add({ title: 'Transfer', message: '로컬 복사 작업이 큐에 등록되었습니다.', type: 'success' });
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
      showError('유효하지 않은 전송 작업 ID입니다.', 'TRANSFER_CANCEL_INVALID_ID');
      return;
    }
    const nextSet = new Set(cancelingIds);
    nextSet.add(job.id);
    cancelingIds = nextSet;
    operationError = '';

    try {
      await cancelTransferJob(job.id);
      addToast(`작업 ${job.id} 취소 요청을 보냈습니다.`, 'success');
      notifications.add({
        title: 'Transfer',
        message: `작업 ${job.id} 취소를 요청했습니다.`,
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

  async function handleRetryJob(job) {
    if (!job?.id) {
      showError('유효하지 않은 전송 작업 ID입니다.', 'TRANSFER_RETRY_INVALID_ID');
      return;
    }
    const nextSet = new Set(retryingIds);
    nextSet.add(job.id);
    retryingIds = nextSet;
    operationError = '';

    try {
      await retryTransferJob(job.id);
      addToast(`작업 ${job.id} 재시도를 큐에 등록했습니다.`, 'success');
      notifications.add({
        title: 'Transfer',
        message: `작업 ${job.id} 재시도를 등록했습니다.`,
        type: 'success'
      });
      await refreshJobs(true);
    } catch (err) {
      showError(err?.message, err?.code);
    } finally {
      const doneSet = new Set(retryingIds);
      doneSet.delete(job.id);
      retryingIds = doneSet;
    }
  }

  async function handleClearHistory() {
    clearing = true;
    operationError = '';
    try {
      const result = await clearTransferJobs(['completed', 'failed', 'canceled']);
      addToast(`완료된 전송 작업 ${Number(result?.removed || 0)}개를 정리했습니다.`, 'success');
      await refreshJobs(true);
    } catch (err) {
      showError(err?.message, err?.code);
    } finally {
      clearing = false;
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
      <span class="meta">대기 {summary.queued} / 진행 {runningJobs.length} / 실패 {failedJobs.length}</span>
    </div>

    <div class="head-actions">
      <button class="ghost-btn" onclick={() => refreshJobs(false)} disabled={refreshing}>
        {#if refreshing}
          <Loader2 size={14} class="spin" />
          새로고침 중
        {:else}
          <RefreshCw size={14} />
          새로고침
        {/if}
      </button>
      <span class="sync-time">
        <Clock3 size={13} />
        마지막 동기화: {formatDateTime(lastSyncAt)}
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
        URL 다운로드
      </button>
      <button class:active={createMode === 'local-copy'} onclick={() => (createMode = 'local-copy')}>
        <Copy size={14} />
        로컬 복사
      </button>
    </div>

    {#if createMode === 'url-download'}
      <div class="form-grid">
        <label>
          URL
          <input type="text" bind:value={urlForm.url} placeholder="https://example.com/archive.zip" />
        </label>
        <label>
          대상 디렉터리
          <input type="text" bind:value={urlForm.destinationDir} placeholder="/home/user/Downloads" />
        </label>
        <label>
          파일명 (선택)
          <input type="text" bind:value={urlForm.fileName} placeholder="archive.zip" />
        </label>
      </div>
    {:else}
      <div class="form-grid">
        <label>
          원본 경로
          <input type="text" bind:value={copyForm.sourcePath} placeholder="/home/user/source/file.iso" />
        </label>
        <label>
          대상 디렉터리
          <input type="text" bind:value={copyForm.destinationDir} placeholder="/home/user/target" />
        </label>
        <label>
          파일명 (선택)
          <input type="text" bind:value={copyForm.fileName} placeholder="file-copy.iso" />
        </label>
      </div>
    {/if}

    <div class="submit-row">
      <button class="create-btn" onclick={handleCreateJob} disabled={creating}>
        {#if creating}
          <Loader2 size={14} class="spin" />
          생성 중...
        {:else}
          <FolderInput size={14} />
          작업 생성
        {/if}
      </button>
    </div>
  </section>

  <section class="jobs-panel glass-effect">
    <div class="jobs-head">
      <div class="jobs-title">작업 목록</div>
      <div class="jobs-tools">
        <div class="status-filter">
          <button class:active={activeFilter === 'all'} onclick={() => (activeFilter = 'all')}>전체</button>
          <button class:active={activeFilter === 'running'} onclick={() => (activeFilter = 'running')}>진행중</button>
          <button class:active={activeFilter === 'failed'} onclick={() => (activeFilter = 'failed')}>실패</button>
          <button class:active={activeFilter === 'completed'} onclick={() => (activeFilter = 'completed')}>완료</button>
          <button class:active={activeFilter === 'canceled'} onclick={() => (activeFilter = 'canceled')}>취소됨</button>
        </div>
        <button class="ghost-btn clear-btn" onclick={handleClearHistory} disabled={clearing}>
          {#if clearing}
            <Loader2 size={13} class="spin" />
            정리 중...
          {:else}
            <Trash2 size={13} />
            완료 작업 정리
          {/if}
        </button>
      </div>
    </div>

    {#if filteredJobs.length === 0}
      <div class="empty">전송 작업이 없습니다.</div>
    {:else}
      <div class="job-list">
        {#each filteredJobs as job}
          <article class="job-card">
            <div class="job-top">
              <div class="job-main">
                <div class="job-line">
                  <span class="job-id">{job.id}</span>
                  <span class="job-type">{typeLabel(job.type)}</span>
                  <span class="status {statusClass(job.status)}">{statusLabel(job.status)}</span>
                </div>
                <div class="job-path">{job.sourcePath || job.url || '-'}</div>
                <div class="job-path">대상: {job.destinationDir || '-'}</div>
                {#if job.fileName}
                  <div class="job-path">파일명: {job.fileName}</div>
                {/if}
              </div>

              <div class="job-actions">
                {#if isRunningStatus(job.status)}
                  <button
                    class="cancel-btn"
                    onclick={() => handleCancelJob(job)}
                    disabled={cancelingIds.has(job.id)}
                  >
                    {#if cancelingIds.has(job.id)}
                      <Loader2 size={13} class="spin" />
                      취소 중...
                    {:else}
                      <CircleX size={13} />
                      취소
                    {/if}
                  </button>
                {/if}
                {#if job.status === 'failed' || job.status === 'canceled'}
                  <button
                    class="retry-btn"
                    onclick={() => handleRetryJob(job)}
                    disabled={retryingIds.has(job.id)}
                  >
                    {#if retryingIds.has(job.id)}
                      <Loader2 size={13} class="spin" />
                      재시도 중...
                    {:else}
                      <RotateCcw size={13} />
                      재시도
                    {/if}
                  </button>
                {/if}
              </div>
            </div>

            <div class="progress-wrap">
              <div class="progress-bar">
                <span style="width: {job.progress}%"></span>
              </div>
              <span class="progress-text">{job.progress}%</span>
              <span class="progress-bytes">{progressBytesLabel(job)}</span>
            </div>

            {#if job.error}
              <div class="job-error">
                <AlertTriangle size={12} />
                <span>{job.error}</span>
              </div>
            {/if}

            <div class="job-time">갱신 시각: {formatDateTime(job.updatedAt || job.createdAt)}</div>
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

  .jobs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .jobs-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-filter {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .status-filter button {
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-dim);
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
  }

  .status-filter button.active {
    color: white;
    border-color: rgba(88, 166, 255, 0.6);
    background: rgba(88, 166, 255, 0.16);
  }

  .clear-btn {
    padding: 5px 8px;
    font-size: 11px;
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

  .retry-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid rgba(96, 165, 250, 0.4);
    border-radius: 8px;
    background: rgba(59, 130, 246, 0.14);
    color: #bfdbfe;
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .retry-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .job-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
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

  .progress-bytes {
    font-size: 10px;
    color: var(--text-dim);
    min-width: 90px;
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

    .jobs-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .jobs-tools {
      width: 100%;
      flex-direction: column;
      align-items: flex-start;
    }

    .status-filter {
      flex-wrap: wrap;
    }
  }
</style>
