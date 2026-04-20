<script>
  import { onMount } from 'svelte';
  import { LayoutGrid, RefreshCw, Play, Shield } from 'lucide-svelte';
  import { apiFetch } from '../../utils/api.js';
  import { openWindow } from '../../core/stores/windowStore.js';

  let loading = $state(true);
  let error = $state('');
  let packages = $state([]);

  async function loadPackages() {
    loading = true;
    error = '';

    try {
      const response = await apiFetch('/api/packages');
      packages = Array.isArray(response.packages) ? response.packages : [];
    } catch (err) {
      error = err.message || 'Failed to load installed packages.';
      packages = [];
    } finally {
      loading = false;
    }
  }

  function launchPackage(pkg) {
    openWindow({
      ...pkg,
      icon: LayoutGrid
    });
  }

  onMount(loadPackages);
</script>

<div class="package-center">
  <div class="hero">
    <div>
      <div class="eyebrow">Package Center</div>
      <h2>Installed Sandbox Packages</h2>
      <p>Sandbox apps discovered from `inventory/apps` appear here as installable runtime packages.</p>
    </div>
    <button class="refresh" onclick={loadPackages}>
      <RefreshCw size={14} />
      Refresh
    </button>
  </div>

  {#if loading}
    <div class="empty glass-effect">Loading installed packages...</div>
  {:else if error}
    <div class="empty glass-effect error">{error}</div>
  {:else if packages.length === 0}
    <div class="empty glass-effect">
      <LayoutGrid size={20} />
      <span>No sandbox packages are installed yet.</span>
    </div>
  {:else}
    <div class="grid">
      {#each packages as pkg}
        <article class="card glass-effect">
          <div class="card-head">
            <div class="title-wrap">
              <div class="icon"><LayoutGrid size={18} /></div>
              <div>
                <h3>{pkg.title}</h3>
                <p>{pkg.description || 'No description provided.'}</p>
              </div>
            </div>
            <span class="version">v{pkg.version}</span>
          </div>

          <div class="meta">
            <span>Runtime: {pkg.runtime}</span>
            <span>Entry: {pkg.entry}</span>
            <span>Type: {pkg.type}</span>
          </div>

          <div class="permissions">
            <div class="perm-title">
              <Shield size={14} />
              Permissions
            </div>
            <div class="perm-list">
              {#if pkg.permissions?.length}
                {#each pkg.permissions as permission}
                  <span class="perm">{permission}</span>
                {/each}
              {:else}
                <span class="perm muted">No permissions</span>
              {/if}
            </div>
          </div>

          <div class="actions">
            <button class="launch" onclick={() => launchPackage(pkg)}>
              <Play size={14} />
              Launch
            </button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .package-center {
    display: flex;
    flex-direction: column;
    gap: 18px;
    height: 100%;
    padding: 22px;
    color: var(--text-main);
    overflow: auto;
    background:
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 30%),
      linear-gradient(180deg, rgba(7, 14, 26, 0.85) 0%, rgba(5, 9, 18, 0.9) 100%);
  }

  .hero {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
  }

  .eyebrow {
    margin-bottom: 8px;
    color: #38bdf8;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0 0 6px;
    font-size: 24px;
  }

  p {
    margin: 0;
    color: var(--text-dim);
    line-height: 1.45;
  }

  .refresh,
  .launch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    cursor: pointer;
  }

  .refresh {
    padding: 10px 14px;
    background: rgba(15, 23, 36, 0.72);
    color: var(--text-main);
  }

  .launch {
    padding: 10px 14px;
    background: rgba(14, 165, 233, 0.16);
    color: #dbeafe;
    border-color: rgba(56, 189, 248, 0.24);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }

  .card,
  .empty {
    border: 1px solid var(--glass-border);
    border-radius: 18px;
    padding: 18px;
    background: rgba(15, 23, 36, 0.72);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .title-wrap {
    display: flex;
    gap: 12px;
  }

  .icon {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    color: #38bdf8;
    background: rgba(14, 165, 233, 0.16);
  }

  h3 {
    margin: 0 0 4px;
    font-size: 16px;
  }

  .version {
    color: #7dd3fc;
    font-size: 12px;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .meta span,
  .perm {
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    background: rgba(148, 163, 184, 0.08);
    color: var(--text-dim);
  }

  .permissions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .perm-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-main);
  }

  .perm-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .actions {
    margin-top: auto;
    display: flex;
    justify-content: flex-end;
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 140px;
    color: var(--text-dim);
  }

  .error {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.28);
  }
</style>
