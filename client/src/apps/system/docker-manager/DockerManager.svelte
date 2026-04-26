<script>
  import { onMount, onDestroy } from 'svelte';
  import { Play, Square, RotateCcw, Trash2, Container, AlertCircle, FileText, HardDrive, Layers, Boxes } from 'lucide-svelte';
  import { addToast } from '../../../core/stores/toastStore.js';
  import { apiFetch } from '../../../utils/api.js';
  import * as dockerApi from './api.js';
  import { normalizeOpsStatus } from '../../../utils/opsStatus.js';

  let containers = $state([]);
  let volumes = $state([]);
  let images = $state([]);
  let composeProjects = $state([]);
  let selectedLogContainerId = $state('');
  let logLines = $state([]);
  let logsLoading = $state(false);
  let loading = $state(true);
  let error = $state('');
  let approvalDialog = $state(null);
  let approvalInput = $state('');
  let approvalLoading = $state(false);
  let interval;

  async function fetchContainers() {
    try {
      const data = await dockerApi.listContainers();
      if (data.error) {
        error = data.error;
        containers = [];
      } else {
        containers = data.containers || [];
        error = '';
      }
    } catch (err) {
      error = 'Failed to connect to Docker';
      containers = [];
    } finally {
      loading = false;
    }
  }

  async function fetchVolumes() {
    try {
      const data = await dockerApi.listVolumes();
      volumes = Array.isArray(data?.volumes) ? data.volumes : [];
    } catch (_err) {
      volumes = [];
    }
  }

  async function fetchComposeProjects() {
    try {
      const data = await dockerApi.listComposeProjects();
      composeProjects = Array.isArray(data?.projects) ? data.projects : [];
    } catch (_err) {
      composeProjects = [];
    }
  }

  async function fetchImages() {
    try {
      const data = await dockerApi.listImages();
      images = Array.isArray(data?.images) ? data.images : [];
    } catch (_err) {
      images = [];
    }
  }

  async function openLogs(container) {
    selectedLogContainerId = container.ID;
    logsLoading = true;
    try {
      const data = await dockerApi.fetchContainerLogs(container.ID, 300);
      logLines = Array.isArray(data?.lines) ? data.lines : [];
    } catch (err) {
      logLines = [`Failed to load logs: ${err.message}`];
    } finally {
      logsLoading = false;
    }
  }

  function getContainerLabel(container) {
    return String(container?.Names || container?.ID || '').trim();
  }

  function getDockerActionCopy(action) {
    if (action === 'stop') {
      return {
        title: 'Stop Container',
        button: 'Approve & Stop',
        impact: 'Stops the running container. Services inside it will become unavailable until started again.',
        recoverability: 'Reversible by starting the container again.'
      };
    }
    if (action === 'restart') {
      return {
        title: 'Restart Container',
        button: 'Approve & Restart',
        impact: 'Stops and starts the container. Active connections and in-memory work can be interrupted.',
        recoverability: 'Usually reversible, but running work inside the container may be interrupted.'
      };
    }
    return {
      title: 'Remove Container',
      button: 'Approve & Remove',
      impact: 'Removes the container from Docker. Uncommitted container filesystem changes can be lost.',
      recoverability: 'Recoverable only if the image, compose project, or backup can recreate it.'
    };
  }

  async function openDockerApproval(action, container) {
    const id = container?.ID;
    if (!id) {
      addToast('Invalid container ID', 'error');
      return;
    }
    approvalLoading = true;
    approvalInput = '';
    const copy = getDockerActionCopy(action);
    approvalDialog = {
      action,
      container,
      copy,
      preflight: null,
      error: '',
      typedConfirmation: id
    };

    try {
      const response = await apiFetch(`/api/docker/${action}/preflight`, {
        method: 'POST',
        body: JSON.stringify({ id })
      });
      const preflight = response?.preflight || response || {};
      approvalDialog = {
        ...approvalDialog,
        preflight,
        typedConfirmation: String(preflight?.approval?.typedConfirmation || id)
      };
    } catch (err) {
      approvalDialog = {
        ...approvalDialog,
        error: err?.message || `${copy.title} preflight failed.`
      };
    } finally {
      approvalLoading = false;
    }
  }

  function closeDockerApproval() {
    if (approvalLoading) return;
    approvalDialog = null;
    approvalInput = '';
  }

  async function executeApprovedDockerAction() {
    if (!approvalDialog?.container?.ID || !approvalDialog?.action || approvalLoading) return;
    const { action, container, preflight } = approvalDialog;
    const id = container.ID;
    const typedConfirmation = String(preflight?.approval?.typedConfirmation || approvalDialog.typedConfirmation || id);
    if (approvalInput.trim() !== typedConfirmation) {
      approvalDialog = {
        ...approvalDialog,
        error: `Type ${typedConfirmation} to approve this Docker operation.`
      };
      return;
    }

    approvalLoading = true;
    try {
      const approvalResponse = await apiFetch(`/api/docker/${action}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          id,
          operationId: preflight?.operationId,
          typedConfirmation
        })
      });
      const approval = approvalResponse?.approval || {};
      if (!approval?.nonce) {
        throw new Error('Docker approval response did not include a nonce.');
      }

      let result;
      if (action === 'stop') {
        result = await apiFetch('/api/docker/stop', {
          method: 'POST',
          body: JSON.stringify({
            id,
            approval: {
              ...approval,
              targetHash: preflight?.targetHash
            }
          })
        });
      } else if (action === 'restart') {
        result = await apiFetch('/api/docker/restart', {
          method: 'POST',
          body: JSON.stringify({
            id,
            approval: {
              ...approval,
              targetHash: preflight?.targetHash
            }
          })
        });
      } else {
        result = await apiFetch('/api/docker/remove', {
          method: 'DELETE',
          body: JSON.stringify({
            id,
            approval: {
              ...approval,
              targetHash: preflight?.targetHash
            }
          })
        });
      }

      if (result?.success) {
        addToast(result.message, 'success');
        approvalDialog = null;
        approvalInput = '';
        await Promise.all([fetchContainers(), fetchVolumes(), fetchImages(), fetchComposeProjects()]);
        if (selectedLogContainerId === id && action !== 'remove') {
          await openLogs(container);
        }
      } else {
        approvalDialog = {
          ...approvalDialog,
          error: result?.message || 'Docker operation failed.'
        };
      }
    } catch (err) {
      approvalDialog = {
        ...approvalDialog,
        error: err?.message || 'Docker operation failed.'
      };
    } finally {
      approvalLoading = false;
    }
  }

  async function handleAction(action, container) {
    const id = container.ID;
    try {
      let result;
      if (action === 'start') result = await dockerApi.startContainer(id);
      else if (action === 'stop' || action === 'restart' || action === 'remove') {
        await openDockerApproval(action, container);
        return;
      }
      if (result?.success) {
        addToast(result.message, 'success');
        await Promise.all([fetchContainers(), fetchVolumes(), fetchImages(), fetchComposeProjects()]);
        if (selectedLogContainerId === id) {
          await openLogs(container);
        }
      } else {
        addToast(result?.message || 'Action failed', 'error');
      }
    } catch (err) {
      addToast('Action failed: ' + err.message, 'error');
    }
  }

  function getStatusColor(status) {
    const raw = String(status || '').toLowerCase();
    const normalized = normalizeOpsStatus(raw.includes('up') ? 'running' : raw.includes('exited') ? 'stopped' : raw);
    if (normalized === 'running') return 'var(--accent-green)';
    if (normalized === 'failed' || normalized === 'stopped') return 'var(--accent-red)';
    return 'var(--text-dim)';
  }

  function parseHealth(statusText) {
    const raw = String(statusText || '').toLowerCase();
    const normalized = normalizeOpsStatus(
      raw.includes('healthy') ? 'healthy' :
      raw.includes('unhealthy') ? 'unhealthy' :
      raw.includes('starting') ? 'starting' : raw
    );
    if (normalized === 'completed') return 'healthy';
    if (normalized === 'failed') return 'unhealthy';
    if (normalized === 'running') return 'starting';
    return 'none';
  }

  onMount(() => {
    Promise.all([fetchContainers(), fetchVolumes(), fetchImages(), fetchComposeProjects()]);
    interval = setInterval(() => {
      fetchContainers();
      fetchVolumes();
      fetchImages();
      fetchComposeProjects();
    }, 5000);
  });

  onDestroy(() => clearInterval(interval));
</script>

<div class="docker-manager">
  <div class="header">
    <h2><Container size={20} /> Docker Containers</h2>
    <button class="refresh-btn" onclick={() => Promise.all([fetchContainers(), fetchVolumes(), fetchImages(), fetchComposeProjects()])}><RotateCcw size={14} /> Refresh</button>
  </div>

  {#if loading}
    <div class="center-msg">Loading...</div>
  {:else if error}
    <div class="center-msg error-msg">
      <AlertCircle size={32} />
      <p>{error}</p>
      <span class="hint">Is Docker installed and running?</span>
    </div>
  {:else if containers.length === 0}
    <div class="center-msg">No containers found.</div>
  {:else}
    <div class="container-list">
      {#each containers as c}
        <div class="container-row glass-effect">
          <div class="info">
            <div class="name">{c.Names}</div>
            <div class="image-port">
              <span class="image">{c.Image}</span>
              {#if c.Ports}
                <span class="ports">({c.Ports})</span>
              {/if}
            </div>
            <div class="status" style="color: {getStatusColor(c.Status)}">Status: {c.Status}</div>
            {#if parseHealth(c.Status) !== 'none'}
              <div class="status health {parseHealth(c.Status)}">health: {parseHealth(c.Status)}</div>
            {/if}
          </div>
          <div class="actions">
            <button title="Logs" onclick={() => openLogs(c)}><FileText size={14} /></button>
            {#if c.State === 'running'}
              <button title="Stop" class="stop" onclick={() => handleAction('stop', c)}><Square size={14} /></button>
              <button title="Restart" class="restart" onclick={() => handleAction('restart', c)}><RotateCcw size={14} /></button>
            {:else}
              <button title="Start" class="start" onclick={() => handleAction('start', c)}><Play size={14} /></button>
              <button title="Remove" class="danger" onclick={() => handleAction('remove', c)}><Trash2 size={14} /></button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <div class="info-panels">
      <div class="info-panel glass-effect">
        <div class="panel-head">
          <h3><HardDrive size={15} /> Volumes</h3>
        </div>
        {#if volumes.length === 0}
          <div class="runtime-empty">No volumes found.</div>
        {:else}
          <div class="simple-list">
            {#each volumes as volume}
              <div class="simple-row">
                <span>{volume.Name || volume.Driver || 'volume'}</span>
                <span>{volume.Driver || '-'}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="info-panel glass-effect">
        <div class="panel-head">
          <h3><Layers size={15} /> Compose Projects</h3>
        </div>
        {#if composeProjects.length === 0}
          <div class="runtime-empty">No compose projects.</div>
        {:else}
          <div class="simple-list">
            {#each composeProjects as project}
              <div class="simple-row">
                <span>{project.Name || project.Project || '-'}</span>
                <span>{project.Status || '-'}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="info-panel glass-effect">
        <div class="panel-head">
          <h3><Boxes size={15} /> Images</h3>
        </div>
        {#if images.length === 0}
          <div class="runtime-empty">No images found.</div>
        {:else}
          <div class="simple-list">
            {#each images as image}
              <div class="simple-row">
                <span>{image.Repository}:{image.Tag}</span>
                <span>{image.Size || '-'}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="log-panel glass-effect">
      <div class="panel-head">
        <h3><FileText size={15} /> Logs {selectedLogContainerId ? `(${selectedLogContainerId})` : ''}</h3>
      </div>
      {#if !selectedLogContainerId}
        <div class="runtime-empty">Select a container and click Logs.</div>
      {:else if logsLoading}
        <div class="runtime-empty">Loading logs...</div>
      {:else if logLines.length === 0}
        <div class="runtime-empty">No log lines.</div>
      {:else}
        <div class="log-lines">
          {#each logLines as line}
            <div class="log-line">{line}</div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if approvalDialog}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="dockerApprovalTitle">
        <div class="approval-head">
          <h3 id="dockerApprovalTitle">{approvalDialog.copy.title}</h3>
          <span class="risk-chip">HIGH IMPACT</span>
        </div>
        <div class="approval-body">
          <div class="approval-row">
            <span>Container</span>
            <strong>{getContainerLabel(approvalDialog.container)}</strong>
          </div>
          <div class="approval-row">
            <span>Target ID</span>
            <code>{approvalDialog.container.ID}</code>
          </div>
          <div class="approval-section">
            <span>Impact</span>
            <p>{approvalDialog.preflight?.impact || approvalDialog.copy.impact}</p>
          </div>
          <div class="approval-section">
            <span>Recoverability</span>
            <p>{approvalDialog.preflight?.recoverability || approvalDialog.copy.recoverability}</p>
          </div>
          {#if approvalDialog.preflight?.expiresAt}
            <div class="approval-row">
              <span>Approval expires</span>
              <code>{approvalDialog.preflight.expiresAt}</code>
            </div>
          {/if}
          {#if approvalDialog.error}
            <div class="approval-error">{approvalDialog.error}</div>
          {/if}
          <label class="typed-confirm">
            <span>Type <code>{approvalDialog.typedConfirmation}</code> to approve</span>
            <input bind:value={approvalInput} disabled={approvalLoading || !approvalDialog.preflight} autocomplete="off" />
          </label>
        </div>
        <div class="approval-actions">
          <button class="dialog-btn ghost" onclick={closeDockerApproval} disabled={approvalLoading}>Cancel</button>
          <button class="dialog-btn danger" onclick={executeApprovedDockerAction} disabled={approvalLoading || !approvalDialog.preflight}>
            {approvalLoading ? 'Working...' : approvalDialog.copy.button}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .docker-manager { display: flex; flex-direction: column; height: 100%; padding: 20px; gap: 16px; color: var(--text-main); overflow: auto; }
  .header { display: flex; justify-content: space-between; align-items: center; }
  .header h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; }
  .refresh-btn { background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); color: var(--text-dim); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .refresh-btn:hover { background: rgba(255,255,255,0.15); color: white; }
  .center-msg { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: var(--text-dim); gap: 8px; }
  .error-msg { color: var(--accent-red); }
  .hint { font-size: 12px; color: var(--text-dim); }
  .container-list { display: flex; flex-direction: column; gap: 12px; }
  .container-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--glass-border); }
  .info { display: flex; flex-direction: column; gap: 4px; }
  .name { font-weight: 600; font-size: 14px; color: var(--text-main); }
  .image-port { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .image { font-size: 11px; opacity: 0.6; padding: 2px 6px; background: rgba(0,0,0,0.2); border-radius: 4px; }
  .ports { font-size: 11px; color: var(--accent-blue); opacity: 0.8; font-family: monospace; }
  .status { font-size: 11px; font-weight: 500; }
  .status.health { text-transform: uppercase; letter-spacing: 0.04em; }
  .status.health.healthy { color: #7ee787 !important; }
  .status.health.unhealthy { color: #ff7b72 !important; }
  .status.health.starting { color: #d29922 !important; }
  .actions { display: flex; gap: 8px; }
  .actions button { background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
  
  /* Persistent Action button colors with glass tints */
  .actions button.start { color: var(--accent-green); background: rgba(63, 185, 80, 0.1); border-color: rgba(63, 185, 80, 0.2); }
  .actions button.stop { color: var(--accent-red); background: rgba(248, 81, 73, 0.1); border-color: rgba(248, 81, 73, 0.2); }
  .actions button.restart { color: var(--accent-blue); background: rgba(88, 166, 255, 0.1); border-color: rgba(88, 166, 255, 0.2); }
  .actions button.danger { color: #ff5555; background: rgba(255, 85, 85, 0.1); border-color: rgba(255, 85, 85, 0.2); }
  
  /* Hover states - slightly more intense */
  .actions button.start:hover { background: rgba(63, 185, 80, 0.2); box-shadow: 0 0 10px rgba(63, 185, 80, 0.2); }
  .actions button.stop:hover { background: rgba(248, 81, 73, 0.2); box-shadow: 0 0 10px rgba(248, 81, 73, 0.2); }
  .actions button.restart:hover { background: rgba(88, 166, 255, 0.2); box-shadow: 0 0 10px rgba(88, 166, 255, 0.2); }
  .actions button.danger:hover { background: rgba(255, 85, 85, 0.2); box-shadow: 0 0 12px rgba(255, 85, 85, 0.3); }
  
  .actions button:active { transform: scale(0.92); }
  .info-panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
    margin-top: 14px;
  }
  .info-panel {
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 10px;
    display: grid;
    gap: 8px;
  }
  .panel-head h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .runtime-empty {
    font-size: 12px;
    color: var(--text-dim);
  }
  .simple-list {
    display: grid;
    gap: 6px;
    max-height: 160px;
    overflow: auto;
  }
  .simple-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.2);
  }
  .log-panel {
    margin-top: 12px;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 10px;
    display: grid;
    gap: 8px;
  }
  .log-lines {
    max-height: 220px;
    overflow: auto;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px;
    background: rgba(0, 0, 0, 0.35);
    font-family: monospace;
    font-size: 11px;
    display: grid;
    gap: 4px;
  }
  .log-line {
    color: #c9d4df;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(2, 6, 23, 0.72);
  }
  .approval-dialog {
    width: min(560px, 100%);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: #111827;
    color: var(--text-main);
    padding: 16px;
    display: grid;
    gap: 14px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  }
  .approval-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .approval-head h3 { margin: 0; font-size: 16px; }
  .risk-chip {
    border: 1px solid rgba(248, 113, 113, 0.42);
    border-radius: 999px;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.28);
    padding: 3px 8px;
    font-size: 11px;
    white-space: nowrap;
  }
  .approval-body { display: grid; gap: 10px; }
  .approval-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
  }
  .approval-row span,
  .approval-section span,
  .typed-confirm span {
    color: var(--text-dim);
    font-size: 12px;
  }
  .approval-row strong,
  .approval-row code {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .approval-section {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 4px;
    background: rgba(15, 23, 42, 0.75);
  }
  .approval-section p { margin: 0; font-size: 13px; line-height: 1.4; }
  .approval-error {
    border: 1px dashed rgba(248, 113, 113, 0.4);
    border-radius: 8px;
    padding: 8px;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.22);
    font-size: 12px;
  }
  .typed-confirm { display: grid; gap: 6px; }
  .typed-confirm input {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.8);
    color: var(--text-main);
    padding: 9px 10px;
  }
  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .dialog-btn {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-main);
    padding: 8px 11px;
    cursor: pointer;
  }
  .dialog-btn.danger {
    border-color: rgba(248, 113, 113, 0.46);
    color: #fecaca;
    background: rgba(127, 29, 29, 0.28);
  }
  .dialog-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
