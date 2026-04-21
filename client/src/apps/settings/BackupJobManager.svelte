<script>
  import { onMount } from 'svelte';
  import { Plus, RefreshCw, Play, Trash2, History, Clock3 } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import {
    fetchBackupJobs,
    createBackupJob,
    deleteBackupJob,
    runBackupJob
  } from './api.js';

  let backupData = $state({ jobs: [], history: [] });
  let jobs = $derived(backupData.jobs);
  let loading = $state(true);
  let refreshing = $state(false);
  let creating = $state(false);
  let runningJobId = $state('');
  let deletingJobId = $state('');

  let form = $state({
    name: '',
    sourcePath: '',
    destinationRoot: '',
    includeTimestamp: true
  });

  function normalizeBackupData(payload) {
    if (Array.isArray(payload)) {
      return { jobs: payload, history: [] };
    }

    if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.jobs)) {
        return {
          jobs: payload.jobs,
          history: Array.isArray(payload.history) ? payload.history : []
        };
      }
      if (payload.data && typeof payload.data === 'object') {
        return {
          jobs: Array.isArray(payload.data.jobs) ? payload.data.jobs : [],
          history: Array.isArray(payload.data.history) ? payload.data.history : []
        };
      }
      if (Array.isArray(payload.data)) {
        return { jobs: payload.data, history: [] };
      }
    }

    return { jobs: [], history: [] };
  }

  function getJobId(job) {
    return String(job?.id || job?.name || '');
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function getLastStatus(job) {
    return job?.lastStatus || job?.status || 'unknown';
  }

  function getLastOutput(job) {
    return job?.lastOutputPath || job?.lastOutput || job?.output || '';
  }

  function getHistory(job, allHistory = []) {
    if (Array.isArray(job?.recentHistory)) return job.recentHistory;
    if (Array.isArray(job?.history)) return job.history.slice(-8).reverse();
    if (Array.isArray(allHistory)) {
      const jobId = getJobId(job);
      if (!jobId) return [];
      return allHistory
        .filter((item) => String(item?.jobId || '') === jobId)
        .slice(-8)
        .reverse();
    }
    return [];
  }

  let historyEntries = $derived(backupData.history || []);

  async function loadJobs(options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) loading = true;
    refreshing = silent;
    try {
      const result = await fetchBackupJobs();
      backupData = normalizeBackupData(result);
      if (silent) addToast('Backup jobs refreshed', 'success');
    } catch (err) {
      addToast(err?.message || 'Failed to load backup jobs', 'error');
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  async function handleCreateJob() {
    if (!form.name.trim() || !form.sourcePath.trim() || !form.destinationRoot.trim()) {
      addToast('Name, source path, and destination root are required', 'warning');
      return;
    }

    creating = true;
    try {
      const payload = {
        name: form.name.trim(),
        sourcePath: form.sourcePath.trim(),
        destinationRoot: form.destinationRoot.trim(),
        includeTimestamp: Boolean(form.includeTimestamp)
      };
      const result = await createBackupJob(payload);
      if (result?.success === false) {
        addToast(result.error || result.message || 'Failed to create backup job', 'error');
        return;
      }
      addToast('Backup job created', 'success');
      form = { name: '', sourcePath: '', destinationRoot: '', includeTimestamp: true };
      await loadJobs();
    } catch (err) {
      addToast(err?.message || 'Failed to create backup job', 'error');
    } finally {
      creating = false;
    }
  }

  async function handleRunJob(job) {
    const jobId = getJobId(job);
    if (!jobId) {
      addToast('Invalid backup job id', 'error');
      return;
    }

    runningJobId = jobId;
    try {
      const result = await runBackupJob(jobId);
      if (result?.success === false) {
        addToast(result.error || result.message || 'Backup job run failed', 'error');
      } else {
        addToast(`Backup job "${job.name || jobId}" started`, 'success');
      }
      await loadJobs();
    } catch (err) {
      addToast(err?.message || 'Backup job run failed', 'error');
    } finally {
      runningJobId = '';
    }
  }

  async function handleDeleteJob(job) {
    const jobId = getJobId(job);
    if (!jobId) {
      addToast('Invalid backup job id', 'error');
      return;
    }
    const ok = confirm(`Delete backup job "${job.name || jobId}"?`);
    if (!ok) return;

    deletingJobId = jobId;
    try {
      const result = await deleteBackupJob(jobId);
      if (result?.success === false) {
        addToast(result.error || result.message || 'Failed to delete backup job', 'error');
      } else {
        addToast(`Deleted backup job "${job.name || jobId}"`, 'success');
      }
      await loadJobs();
    } catch (err) {
      addToast(err?.message || 'Failed to delete backup job', 'error');
    } finally {
      deletingJobId = '';
    }
  }

  onMount(() => {
    loadJobs();
  });
</script>

<div class="backup-job-manager">
  <div class="section-header">
    <h3>Backup Jobs</h3>
    <button class="action-btn" onclick={() => loadJobs({ silent: true })} disabled={refreshing || loading}>
      <RefreshCw size={14} class={refreshing ? 'spin' : ''} />
      Refresh
    </button>
  </div>

  <div class="form-card glass-effect">
    <h4>Create Backup Job</h4>
    <div class="form-grid">
      <div class="field">
        <label for="jobName">Job Name</label>
        <input id="jobName" type="text" bind:value={form.name} placeholder="daily-docs-backup" />
      </div>
      <div class="field">
        <label for="sourcePath">Source Path</label>
        <input id="sourcePath" type="text" bind:value={form.sourcePath} placeholder="/home/user/Documents" />
      </div>
      <div class="field">
        <label for="destinationRoot">Destination Root</label>
        <input id="destinationRoot" type="text" bind:value={form.destinationRoot} placeholder="/home/user/Backups" />
      </div>
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={form.includeTimestamp} />
      <span>Include timestamp in backup output name</span>
    </label>
    <div class="form-actions">
      <button class="primary-btn" onclick={handleCreateJob} disabled={creating}>
        <Plus size={14} />
        {creating ? 'Creating...' : 'Create Job'}
      </button>
    </div>
  </div>

  <div class="job-list">
    {#if loading}
      <div class="empty glass-effect">Loading backup jobs...</div>
    {:else if jobs.length === 0}
      <div class="empty glass-effect">No backup jobs configured.</div>
    {:else}
      {#each jobs as job}
        {@const jobId = getJobId(job)}
        {@const history = getHistory(job, historyEntries)}
        <div class="job-card glass-effect">
          <div class="job-head">
            <div>
              <div class="job-name">{job.name || jobId}</div>
              <div class="job-paths">{job.sourcePath || '-'} -> {job.destinationRoot || '-'}</div>
            </div>
            <div class="job-actions">
              <button class="action-btn run" onclick={() => handleRunJob(job)} disabled={runningJobId === jobId || !jobId}>
                <Play size={14} />
                {runningJobId === jobId ? 'Running...' : 'Run now'}
              </button>
              <button class="action-btn danger" onclick={() => handleDeleteJob(job)} disabled={deletingJobId === jobId || !jobId}>
                <Trash2 size={14} />
                {deletingJobId === jobId ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          <div class="job-meta">
            <div class="meta-item"><Clock3 size={13} /> Last run: {formatDate(job.lastRun || job.lastRunAt)}</div>
            <div class="meta-item">
              Status:
              <span class="status {getLastStatus(job)}">{getLastStatus(job)}</span>
            </div>
            {#if getLastOutput(job)}
              <pre class="last-output">{getLastOutput(job)}</pre>
            {/if}
          </div>

          {#if history.length > 0}
            <div class="history">
              <div class="history-title"><History size={14} /> Recent History</div>
              <ul>
                {#each history as item}
                  <li>
                    <span>{formatDate(item?.finishedAt || item?.timestamp || item?.runAt || item?.createdAt)}</span>
                    <span class="status {item?.status || 'unknown'}">{item?.status || 'unknown'}</span>
                    <span class="history-output">{item?.outputPath || item?.output || item?.message || item?.error || ''}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .backup-job-manager { display: flex; flex-direction: column; gap: 14px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; }
  .section-header h3 { margin: 0; font-size: 15px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; }

  .form-card, .job-card, .empty { border: 1px solid var(--glass-border); border-radius: 12px; padding: 14px; }
  .form-card h4 { margin: 0 0 12px 0; font-size: 14px; color: white; }
  .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 12px; color: var(--text-dim); }
  .field input {
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--glass-border);
    color: white;
    padding: 9px 10px;
    border-radius: 8px;
    font-size: 13px;
  }
  .toggle { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--text-dim); }
  .form-actions { display: flex; justify-content: flex-end; margin-top: 12px; }

  .job-list { display: flex; flex-direction: column; gap: 10px; }
  .job-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .job-name { font-size: 14px; font-weight: 600; color: white; }
  .job-paths { margin-top: 4px; font-size: 12px; color: var(--text-dim); word-break: break-all; }
  .job-actions { display: flex; gap: 6px; }

  .job-meta { margin-top: 10px; display: grid; gap: 6px; }
  .meta-item { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
  .status {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 11px;
    color: var(--text-main);
    text-transform: lowercase;
  }
  .status.success, .status.done, .status.ok { color: #4ade80; border-color: rgba(74,222,128,0.4); }
  .status.running, .status.pending { color: #f2cc60; border-color: rgba(242,204,96,0.4); }
  .status.error, .status.failed { color: #fb7185; border-color: rgba(251,113,133,0.45); }
  .last-output {
    margin: 4px 0 0 0;
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    background: rgba(0,0,0,0.25);
    color: var(--text-main);
    font-size: 12px;
    white-space: pre-wrap;
    max-height: 140px;
    overflow: auto;
  }

  .history { margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; }
  .history-title { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
  .history ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .history li {
    display: grid;
    grid-template-columns: 180px 90px 1fr;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    color: var(--text-dim);
  }
  .history-output { color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .action-btn, .primary-btn {
    border: 1px solid var(--glass-border);
    background: rgba(255,255,255,0.06);
    color: var(--text-main);
    border-radius: 8px;
    padding: 7px 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  .action-btn:hover:not(:disabled), .primary-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
  .action-btn.run { border-color: rgba(88,166,255,0.45); color: #7ec3ff; background: rgba(88,166,255,0.12); }
  .action-btn.danger { border-color: rgba(251,113,133,0.4); color: #fb7185; background: rgba(251,113,133,0.1); }
  .primary-btn { border-color: rgba(88,166,255,0.45); color: #7ec3ff; background: rgba(88,166,255,0.12); }
  .action-btn:disabled, .primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  @media (max-width: 980px) {
    .form-grid { grid-template-columns: 1fr; }
    .history li { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
