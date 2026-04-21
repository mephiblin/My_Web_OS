<script>
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { LayoutGrid, Store, Link2, RefreshCw, Download, Play, Square, RotateCcw, Trash2 } from 'lucide-svelte';
  import { apiFetch } from '../../utils/api.js';
  import { openWindow, windows, closeWindow } from '../../core/stores/windowStore.js';

  const CATEGORY = {
    STORE: 'store',
    INSTALLED: 'installed'
  };

  let activeCategory = $state(CATEGORY.STORE);
  let loadingStore = $state(true);
  let loadingInstalled = $state(true);
  let savingSource = $state(false);
  let installingPackageId = $state('');
  let message = $state('');
  let error = $state('');
  let activeStoreSource = $state('all');

  let registrySources = $state([]);
  let storePackages = $state([]);
  let ecosystemTemplates = $state([]);
  let installedPackages = $state([]);
  let storeSourceErrors = $state([]);
  let runtimeStatusByApp = $state({});
  let runtimeLogsByApp = $state({});
  let runtimeEventsByApp = $state({});
  let lifecycleByApp = $state({});
  let healthByApp = $state({});
  let consoleOpenByApp = $state({});
  let runtimeActioning = $state('');
  let runtimeLogsLoading = $state('');
  let runtimeEventsLoading = $state('');
  let lifecycleLoading = $state('');
  let lifecycleActioning = $state('');
  let healthLoading = $state('');
  let scaffoldingTemplateId = $state('');
  let backupNotesByApp = $state({});
  let selectedBackupByApp = $state({});

  let sourceForm = $state({
    id: '',
    title: '',
    url: ''
  });

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  function clearFeedback() {
    message = '';
    error = '';
  }

  async function withTimeout(promise, timeoutMs, timeoutMessage) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const err = new Error(timeoutMessage || '?붿껌 ?쒓컙??珥덇낵?섏뿀?듬땲??');
            err.code = 'REQUEST_TIMEOUT';
            reject(err);
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeRegistryUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.includes('raw.githubusercontent.com')) return value;

    const githubBlob = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
    if (githubBlob) {
      const [, owner, repo, branch, filePath] = githubBlob;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    const githubRepo = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/i);
    if (githubRepo) {
      const [, owner, repo] = githubRepo;
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/webos-store.json`;
    }

    return value;
  }

  function syncSourceId() {
    if (!sourceForm.id.trim()) {
      sourceForm.id = slugify(sourceForm.title || sourceForm.url);
    }
  }

  function getIconUrl(item) {
    if (!item) return '';
    if (item.iconType === 'image' && item.iconUrl) return item.iconUrl;
    if (typeof item.iconUrl === 'string' && item.iconUrl.trim()) return item.iconUrl.trim();
    if (typeof item.icon === 'string' && (/^https?:\/\//i.test(item.icon) || /^data:image\//i.test(item.icon))) return item.icon;
    return '';
  }

  function hasImageIcon(item) {
    return Boolean(getIconUrl(item));
  }

  function getVisibleStorePackages() {
    if (activeStoreSource === 'all') return storePackages;
    return storePackages.filter((pkg) => pkg.source?.id === activeStoreSource);
  }

  function isServicePackage(pkg) {
    if (!pkg) return false;
    if (pkg.appType === 'service' || pkg.type === 'service') return true;
    if (pkg.appType === 'hybrid' || pkg.type === 'hybrid') return true;
    return pkg.runtimeProfile?.runtimeType && pkg.runtimeProfile.runtimeType !== 'sandbox-html';
  }

  function canOpenPackage(pkg) {
    return !pkg || (pkg.appType || pkg.type) !== 'service';
  }

  function getRuntimeState(pkg) {
    return runtimeStatusByApp[pkg.id] || pkg.runtimeStatus || null;
  }

  function getRuntimeStatusLabel(pkg) {
    const status = getRuntimeState(pkg)?.status || 'stopped';
    return String(status).toUpperCase();
  }

  function isRuntimeRunning(pkg) {
    const status = getRuntimeState(pkg)?.status || 'stopped';
    return status === 'running' || status === 'starting' || status === 'degraded';
  }

  function clearRuntimeLogs(appId) {
    const next = { ...runtimeLogsByApp };
    delete next[appId];
    runtimeLogsByApp = next;
  }

  function clearRuntimeEvents(appId) {
    const next = { ...runtimeEventsByApp };
    delete next[appId];
    runtimeEventsByApp = next;
  }

  function getLifecycle(pkg) {
    return lifecycleByApp[pkg.id] || null;
  }

  function getHealthReport(pkg) {
    return healthByApp[pkg.id] || getLifecycle(pkg)?.lastQaReport || null;
  }

  function getHealthStatus(pkg) {
    return String(getHealthReport(pkg)?.status || 'unknown').toLowerCase();
  }

  function isConsoleOpen(pkg) {
    return Boolean(consoleOpenByApp[pkg.id]);
  }

  function getLifecycleCurrentChannel(pkg) {
    return getLifecycle(pkg)?.channel || 'stable';
  }

  function getAvailableBackups(pkg) {
    const lifecycle = getLifecycle(pkg);
    const backups = Array.isArray(lifecycle?.backups) ? lifecycle.backups : [];
    return [...backups].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function formatEventLabel(event) {
    if (!event) return '-';
    return String(event.action || event.type || event.id || 'event');
  }

  function getBackupNote(appId) {
    return String(backupNotesByApp[appId] || '');
  }

  function setBackupNote(appId, value) {
    backupNotesByApp = {
      ...backupNotesByApp,
      [appId]: String(value || '')
    };
  }

  function setSelectedBackup(appId, backupId) {
    selectedBackupByApp = {
      ...selectedBackupByApp,
      [appId]: String(backupId || '')
    };
  }

  function getSourcePackageCount(sourceId) {
    return storePackages.filter((pkg) => pkg.source?.id === sourceId).length;
  }

  async function loadInstalledPackages() {
    loadingInstalled = true;
    try {
      const response = await apiFetch('/api/packages');
      installedPackages = Array.isArray(response.packages) ? response.packages : [];
      const activeIds = new Set(installedPackages.map((item) => item.id));
      for (const appId of Object.keys(consoleOpenByApp)) {
        if (!activeIds.has(appId)) {
          clearRuntimeLogs(appId);
          clearRuntimeEvents(appId);
        }
      }
    } catch (err) {
      installedPackages = [];
      error = err.message || '?ㅼ튂???⑦궎吏 紐⑸줉??媛?몄삤吏 紐삵뻽?듬땲??';
    } finally {
      loadingInstalled = false;
    }
  }

  async function loadRuntimeStatuses() {
    try {
      const response = await apiFetch('/api/runtime/apps');
      const apps = Array.isArray(response.apps) ? response.apps : [];
      const next = {};
      for (const app of apps) {
        next[app.appId] = {
          status: app.status,
          pid: app.pid,
          lastError: app.lastError,
          updatedAt: app.updatedAt
        };
      }
      runtimeStatusByApp = next;
    } catch (_err) {
      runtimeStatusByApp = {};
    }
  }

  async function loadRegistrySources() {
    try {
      const response = await apiFetch('/api/packages/registry/sources');
      const nextSources = Array.isArray(response.sources) ? response.sources : [];
      registrySources = nextSources;
      if (activeStoreSource !== 'all' && !nextSources.some((source) => source.id === activeStoreSource)) {
        activeStoreSource = 'all';
      }
    } catch (_err) {
      registrySources = [];
      activeStoreSource = 'all';
    }
  }

  async function loadStorePackages() {
    loadingStore = true;
    try {
      const response = await apiFetch('/api/packages/registry');
      const results = Array.isArray(response.results) ? response.results : [];
      storeSourceErrors = results
        .filter((result) => !result.ok)
        .map((result) => ({
          id: result.source?.id || 'unknown',
          title: result.source?.title || result.source?.id || 'Unknown Source',
          error: result.error || '?ㅽ넗?대? ?쎌? 紐삵뻽?듬땲??'
        }));
      storePackages = results
        .filter((result) => result.ok)
        .flatMap((result) => (Array.isArray(result.packages) ? result.packages : []))
        .sort((a, b) => {
          const sourceA = String(a.source?.title || a.source?.id || '');
          const sourceB = String(b.source?.title || b.source?.id || '');
          if (sourceA !== sourceB) {
            return sourceA.localeCompare(sourceB, 'ko');
          }
          return String(a.title || '').localeCompare(String(b.title || ''), 'ko');
        });
    } catch (err) {
      storePackages = [];
      storeSourceErrors = [];
      error = err.message || '?ㅽ넗??紐⑸줉??遺덈윭?ㅼ? 紐삵뻽?듬땲??';
    } finally {
      loadingStore = false;
    }
  }

  async function loadEcosystemTemplates() {
    try {
      const response = await apiFetch('/api/packages/ecosystem/templates');
      ecosystemTemplates = Array.isArray(response.templates) ? response.templates : [];
    } catch (_err) {
      ecosystemTemplates = [];
    }
  }

  async function saveStoreSource() {
    clearFeedback();
    const normalizedUrl = normalizeRegistryUrl(sourceForm.url);
    const sourceId = sourceForm.id.trim() || slugify(sourceForm.title || normalizedUrl);

    if (!normalizedUrl) {
      error = '?ㅽ넗??二쇱냼瑜??낅젰?섏꽭??';
      return;
    }
    if (!sourceId) {
      error = '?ㅽ넗??ID瑜??낅젰?섏꽭??';
      return;
    }

    savingSource = true;
    try {
      await apiFetch('/api/packages/registry/sources', {
        method: 'POST',
        body: JSON.stringify({
          id: sourceId,
          title: sourceForm.title.trim() || sourceId,
          url: normalizedUrl
        })
      });

      message = `?ㅽ넗??"${sourceId}"瑜?異붽??덉뒿?덈떎.`;
      sourceForm = { id: '', title: '', url: '' };
      await loadRegistrySources();
      await loadStorePackages();
    } catch (err) {
      error = err.message || '?ㅽ넗??二쇱냼 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.';
    } finally {
      savingSource = false;
    }
  }

  async function removeStoreSource(sourceId) {
    clearFeedback();
    try {
      await apiFetch(`/api/packages/registry/sources/${encodeURIComponent(sourceId)}`, {
        method: 'DELETE'
      });
      message = `?ㅽ넗??"${sourceId}"瑜??쒓굅?덉뒿?덈떎.`;
      if (activeStoreSource === sourceId) {
        activeStoreSource = 'all';
      }
      await loadRegistrySources();
      await loadStorePackages();
    } catch (err) {
      error = err.message || '?ㅽ넗???쒓굅???ㅽ뙣?덉뒿?덈떎.';
    }
  }

  async function scaffoldTemplate(template) {
    scaffoldingTemplateId = template.id;
    clearFeedback();
    try {
      const appId = `${template.id}-${Math.random().toString(36).slice(2, 8)}`;
      const title = `${template.title} ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
      await apiFetch(`/api/packages/ecosystem/templates/${encodeURIComponent(template.id)}/scaffold`, {
        method: 'POST',
        body: JSON.stringify({ appId, title })
      });
      message = `?쒗뵆由?"${template.title}"濡?"${appId}" ?앹꽦 ?꾨즺`;
      await Promise.all([loadInstalledPackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
    } catch (err) {
      error = err.message || '?쒗뵆由??앹꽦???ㅽ뙣?덉뒿?덈떎.';
    } finally {
      scaffoldingTemplateId = '';
    }
  }

  async function installPackage(pkg, options = {}) {
    installingPackageId = pkg.id;
    clearFeedback();
    try {
      const overwrite = options.overwrite === true;
      const forcePolicyBypass = options.forcePolicyBypass === true;
      await apiFetch('/api/packages/registry/install', {
        method: 'POST',
        body: JSON.stringify({
          sourceId: pkg.source?.id,
          packageId: pkg.id,
          zipUrl: pkg.zipUrl || '',
          overwrite,
          forcePolicyBypass
        })
      });
      message = overwrite
        ? `Package "${pkg.title}" updated successfully.`
        : `Package "${pkg.title}" installed successfully.`;
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
    } catch (err) {
      error = err.message || 'Package install/update failed.';
    } finally {
      installingPackageId = '';
    }
  }

  function openInstalledPackage(pkg) {
    openWindow({
      ...pkg,
      iconType: hasImageIcon(pkg) ? 'image' : 'lucide',
      iconUrl: getIconUrl(pkg),
      iconComponent: LayoutGrid
    });
  }

  function stopInstalledPackage(pkg) {
    const active = get(windows).filter((item) => item.appId === pkg.id);
    if (active.length === 0) {
      message = `"${pkg.title}" ?ㅽ뻾 以묒씤 李쎌씠 ?놁뒿?덈떎.`;
      return;
    }

    for (const win of active) {
      closeWindow(win.id);
    }
    message = `"${pkg.title}" 李?${active.length}媛쒕? 以묒??덉뒿?덈떎.`;
  }

  async function controlRuntime(pkg, action) {
    runtimeActioning = `${pkg.id}:${action}`;
    clearFeedback();
    try {
      await withTimeout(
        apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/${action}`, {
          method: 'POST'
        }),
        15000,
        'Runtime control request timed out.'
      );
      await loadRuntimeStatuses();
      const actionLabel = action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted';
      message = `"${pkg.title}" ${actionLabel}.`;
    } catch (err) {
      error = err.message || `Failed to ${action} runtime.`;
    } finally {
      runtimeActioning = '';
    }
  }

  async function toggleRuntimeLogs(pkg) {
    if (runtimeLogsByApp[pkg.id]) {
      clearRuntimeLogs(pkg.id);
      return;
    }

    runtimeLogsLoading = pkg.id;
    clearFeedback();
    try {
      const response = await withTimeout(
        apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/logs?limit=200`),
        10000,
        '濡쒓렇 議고쉶媛 吏?곕릺怨??덉뒿?덈떎.'
      );
      runtimeLogsByApp = {
        ...runtimeLogsByApp,
        [pkg.id]: Array.isArray(response.logs) ? response.logs : []
      };
    } catch (err) {
      error = err.message || '?고???濡쒓렇瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??';
    } finally {
      runtimeLogsLoading = '';
    }
  }

  async function loadRuntimeEvents(appId) {
    runtimeEventsLoading = appId;
    try {
      const response = await withTimeout(
        apiFetch(`/api/runtime/apps/${encodeURIComponent(appId)}/events?limit=120`),
        10000,
        'Runtime events request timed out.'
      );
      runtimeEventsByApp = {
        ...runtimeEventsByApp,
        [appId]: Array.isArray(response.events) ? response.events : []
      };
    } catch (err) {
      clearRuntimeEvents(appId);
      error = err.message || 'Failed to load runtime events.';
    } finally {
      runtimeEventsLoading = '';
    }
  }

  async function loadLifecycle(appId) {
    lifecycleLoading = appId;
    try {
      const response = await withTimeout(
        apiFetch(`/api/packages/${encodeURIComponent(appId)}/lifecycle`),
        10000,
        'Lifecycle request timed out.'
      );
      lifecycleByApp = {
        ...lifecycleByApp,
        [appId]: response.lifecycle || null
      };
    } catch (err) {
      lifecycleByApp = {
        ...lifecycleByApp,
        [appId]: null
      };
      error = err.message || 'Failed to load lifecycle.';
    } finally {
      lifecycleLoading = '';
    }
  }

  async function runHealthCheck(pkg) {
    healthLoading = pkg.id;
    clearFeedback();
    try {
      const response = await withTimeout(
        apiFetch(`/api/packages/${encodeURIComponent(pkg.id)}/health`),
        12000,
        'Health check timed out.'
      );
      healthByApp = {
        ...healthByApp,
        [pkg.id]: response.report || null
      };
      await loadLifecycle(pkg.id);
      message = `"${pkg.title}" health check completed.`;
    } catch (err) {
      error = err.message || 'Health check failed.';
    } finally {
      healthLoading = '';
    }
  }

  async function setReleaseChannel(pkg, channel) {
    lifecycleActioning = `${pkg.id}:channel:${channel}`;
    clearFeedback();
    try {
      await apiFetch(`/api/packages/${encodeURIComponent(pkg.id)}/channel`, {
        method: 'PUT',
        body: JSON.stringify({ channel })
      });
      await loadLifecycle(pkg.id);
      message = `"${pkg.title}" channel changed to ${channel}.`;
    } catch (err) {
      error = err.message || 'Failed to change channel.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function createLifecycleBackup(pkg) {
    lifecycleActioning = `${pkg.id}:backup`;
    clearFeedback();
    try {
      await apiFetch(`/api/packages/${encodeURIComponent(pkg.id)}/backup`, {
        method: 'POST',
        body: JSON.stringify({ note: getBackupNote(pkg.id) || 'Manual backup from Package Center' })
      });
      setBackupNote(pkg.id, '');
      await loadLifecycle(pkg.id);
      message = `"${pkg.title}" backup created.`;
    } catch (err) {
      error = err.message || 'Failed to create backup.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function rollbackToBackup(pkg) {
    const backupId = selectedBackupByApp[pkg.id] || '';
    if (!backupId) {
      error = 'Select a backup to rollback.';
      return;
    }

    lifecycleActioning = `${pkg.id}:rollback`;
    clearFeedback();
    try {
      await apiFetch(`/api/packages/${encodeURIComponent(pkg.id)}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ backupId })
      });
      await Promise.all([loadLifecycle(pkg.id), loadRuntimeStatuses()]);
      message = `"${pkg.title}" rollback completed.`;
    } catch (err) {
      error = err.message || 'Rollback failed.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function recoverRuntime(pkg) {
    lifecycleActioning = `${pkg.id}:recover`;
    clearFeedback();
    try {
      await apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/recover`, {
        method: 'POST'
      });
      await Promise.all([loadRuntimeStatuses(), loadRuntimeEvents(pkg.id)]);
      message = `"${pkg.title}" runtime recover requested.`;
    } catch (err) {
      error = err.message || 'Runtime recover failed.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function toggleOpsConsole(pkg) {
    const currentlyOpen = isConsoleOpen(pkg);
    consoleOpenByApp = {
      ...consoleOpenByApp,
      [pkg.id]: !currentlyOpen
    };
    if (currentlyOpen) {
      return;
    }

    await Promise.all([
      loadLifecycle(pkg.id),
      loadRuntimeEvents(pkg.id)
    ]);
  }

  async function removeInstalledPackage(pkg) {
    clearFeedback();
    const ok = globalThis.confirm(`"${pkg.title}" ?⑦궎吏瑜??쒓굅?섏떆寃좎뒿?덇퉴?`);
    if (!ok) return;

    try {
      if (isServicePackage(pkg)) {
        await apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/stop`, { method: 'POST' }).catch(() => {});
      }
      await apiFetch(`/api/packages/${encodeURIComponent(pkg.id)}`, {
        method: 'DELETE'
      });
      stopInstalledPackage(pkg);
      message = `"${pkg.title}" ?쒓굅 ?꾨즺`;
      clearRuntimeLogs(pkg.id);
      clearRuntimeEvents(pkg.id);
      lifecycleByApp = { ...lifecycleByApp, [pkg.id]: null };
      healthByApp = { ...healthByApp, [pkg.id]: null };
      consoleOpenByApp = { ...consoleOpenByApp, [pkg.id]: false };
      selectedBackupByApp = { ...selectedBackupByApp, [pkg.id]: '' };
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
    } catch (err) {
      error = err.message || '?⑦궎吏 ?쒓굅???ㅽ뙣?덉뒿?덈떎.';
    }
  }

  onMount(() => {
    Promise.all([loadRegistrySources(), loadStorePackages(), loadEcosystemTemplates(), loadInstalledPackages(), loadRuntimeStatuses()]).catch(() => {});
    const timer = setInterval(() => {
      if (activeCategory === CATEGORY.INSTALLED) {
        loadRuntimeStatuses().catch(() => {});
        const openIds = Object.entries(consoleOpenByApp)
          .filter(([, opened]) => opened)
          .map(([appId]) => appId);
        for (const appId of openIds) {
          loadLifecycle(appId).catch(() => {});
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  });
</script>

<div class="package-center">
  <aside class="category-panel glass-effect">
    <div class="panel-title">Package Center</div>
    <button class="category {activeCategory === CATEGORY.STORE ? 'active' : ''}" onclick={() => activeCategory = CATEGORY.STORE}>
      <Store size={16} />
      <span>Store</span>
    </button>
    <button class="category {activeCategory === CATEGORY.INSTALLED ? 'active' : ''}" onclick={() => activeCategory = CATEGORY.INSTALLED}>
      <LayoutGrid size={16} />
      <span>Installed</span>
    </button>
  </aside>

  <section class="content">
    {#if message}
      <div class="feedback info glass-effect">{message}</div>
    {/if}
    {#if error}
      <div class="feedback error glass-effect">{error}</div>
    {/if}

    {#if activeCategory === CATEGORY.STORE}
      <div class="block glass-effect">
        <div class="block-head">
          <h3>Store 二쇱냼 異붽?</h3>
          <button class="btn ghost" onclick={loadStorePackages} disabled={loadingStore}>
            <RefreshCw size={14} />
            ?덈줈怨좎묠
          </button>
        </div>

        <div class="source-form">
          <input type="text" bind:value={sourceForm.url} oninput={syncSourceId} placeholder="GitHub URL ?먮뒗 raw JSON URL" />
          <input type="text" bind:value={sourceForm.title} oninput={syncSourceId} placeholder="Store ?대쫫" />
          <input type="text" bind:value={sourceForm.id} placeholder="store-id" />
          <button class="btn primary" onclick={saveStoreSource} disabled={savingSource}>
            <Link2 size={14} />
            {savingSource ? '???以?..' : '?ㅽ넗??異붽?'}
          </button>
        </div>

        {#if registrySources.length > 0}
          <div class="sources">
            {#each registrySources as source}
              <div class="source-pill">
                <span>{source.title} ({source.id})</span>
                <button class="btn tiny" onclick={() => removeStoreSource(source.id)}>?쒓굅</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="block glass-effect">
        <div class="block-head">
          <h3>Store 紐⑸줉</h3>
        </div>

        {#if ecosystemTemplates.length > 0}
          <div class="ecosystem-templates">
            <div class="section-title">Official Ecosystem Templates</div>
            <div class="template-list">
              {#each ecosystemTemplates as template}
                <article class="template-card">
                  <div class="template-top">
                    <strong>{template.title}</strong>
                    <span>{template.category}</span>
                  </div>
                  <p>{template.description}</p>
                  <button
                    class="btn tiny"
                    onclick={() => scaffoldTemplate(template)}
                    disabled={scaffoldingTemplateId === template.id}
                  >
                    {scaffoldingTemplateId === template.id ? '?앹꽦 以?..' : '?쒗뵆由??앹꽦'}
                  </button>
                </article>
              {/each}
            </div>
          </div>
        {/if}

        <div class="store-categories">
          <button class="store-filter {activeStoreSource === 'all' ? 'active' : ''}" onclick={() => activeStoreSource = 'all'}>
            ?꾩껜 ({storePackages.length})
          </button>
          {#each registrySources as source}
            <button class="store-filter {activeStoreSource === source.id ? 'active' : ''}" onclick={() => activeStoreSource = source.id}>
              {source.title} ({getSourcePackageCount(source.id)})
            </button>
          {/each}
        </div>

        {#if storeSourceErrors.length > 0}
          <div class="source-errors">
            {#each storeSourceErrors as sourceError}
              <div class="source-error">
                <strong>{sourceError.title}</strong>
                <span>{sourceError.error}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if loadingStore}
          <div class="empty">?ㅽ넗??紐⑸줉 濡쒕뵫 以?..</div>
        {:else if getVisibleStorePackages().length === 0}
          <div class="empty">?쒖떆???ㅽ넗???⑦궎吏媛 ?놁뒿?덈떎.</div>
        {:else}
          <div class="grid">
            {#each getVisibleStorePackages() as pkg}
              <article class="card">
                <div class="card-head">
                  <div class="icon-box">
                    {#if hasImageIcon(pkg)}
                      <img class="icon-image" src={getIconUrl(pkg)} alt={pkg.title} loading="lazy" />
                    {:else}
                      <LayoutGrid size={18} />
                    {/if}
                  </div>
                  <div class="meta">
                    <h4>{pkg.title}</h4>
                    <p>{pkg.description || 'No description'}</p>
                  </div>
                </div>
                <div class="chips">
                  <span>v{pkg.version}</span>
                  <span>{pkg.source?.id}</span>
                </div>
                <div class="actions">
                  {#if pkg.installed}
                    {#if pkg.updatePolicy?.allowed}
                      <button class="btn primary" onclick={() => installPackage(pkg, { overwrite: true })} disabled={installingPackageId === pkg.id}>
                        <Download size={14} />
                        {installingPackageId === pkg.id ? 'Updating...' : 'Update'}
                      </button>
                    {:else}
                      <button class="btn ghost" disabled>Installed</button>
                    {/if}
                  {:else if !pkg.zipUrl}
                    <button class="btn ghost" disabled>No Zip</button>
                  {:else}
                    <button class="btn primary" onclick={() => installPackage(pkg)} disabled={installingPackageId === pkg.id}>
                      <Download size={14} />
                      {installingPackageId === pkg.id ? 'Installing...' : 'Install'}
                    </button>
                  {/if}
                </div>
                {#if pkg.installed && pkg.updatePolicy && !pkg.updatePolicy.allowed}
                  <div class="runtime-log-empty">
                    update blocked: {pkg.updatePolicy.blockedReason || 'policy'}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if activeCategory === CATEGORY.INSTALLED}
      <div class="block glass-effect">
        <div class="block-head">
          <h3>Installed</h3>
          <button class="btn ghost" onclick={() => Promise.all([loadInstalledPackages(), loadRuntimeStatuses()])} disabled={loadingInstalled}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {#if loadingInstalled}
          <div class="empty">Loading installed packages...</div>
        {:else if installedPackages.length === 0}
          <div class="empty">No installed packages.</div>
        {:else}
          <div class="grid">
            {#each installedPackages as pkg}
              <article class="card">
                <div class="card-head">
                  <div class="icon-box">
                    {#if hasImageIcon(pkg)}
                      <img class="icon-image" src={getIconUrl(pkg)} alt={pkg.title} loading="lazy" />
                    {:else}
                      <LayoutGrid size={18} />
                    {/if}
                  </div>
                  <div class="meta">
                    <h4>{pkg.title}</h4>
                    <p>{pkg.description || 'No description'}</p>
                  </div>
                </div>
                <div class="chips">
                  <span>v{pkg.version}</span>
                  <span>{pkg.runtime}</span>
                  <span>channel:{getLifecycleCurrentChannel(pkg)}</span>
                  <span class="health {getHealthStatus(pkg)}">health:{String(getHealthStatus(pkg)).toUpperCase()}</span>
                  {#if isServicePackage(pkg)}
                    <span class="runtime {getRuntimeState(pkg)?.status || 'stopped'}">{getRuntimeStatusLabel(pkg)}</span>
                  {/if}
                </div>
                <div class="actions">
                  {#if canOpenPackage(pkg)}
                    <button class="btn primary" onclick={() => openInstalledPackage(pkg)}>
                      <Play size={14} />
                      Open
                    </button>
                    <button class="btn ghost" onclick={() => stopInstalledPackage(pkg)}>
                      <Square size={14} />
                      Close Windows
                    </button>
                  {/if}
                  {#if isServicePackage(pkg)}
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'start')} disabled={runtimeActioning === `${pkg.id}:start` || isRuntimeRunning(pkg)}>
                      <Play size={14} />
                      Start
                    </button>
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'stop')} disabled={runtimeActioning === `${pkg.id}:stop` || !isRuntimeRunning(pkg)}>
                      <Square size={14} />
                      Stop Service
                    </button>
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'restart')} disabled={runtimeActioning === `${pkg.id}:restart`}>
                      <RotateCcw size={14} />
                      Restart
                    </button>
                    <button class="btn ghost" onclick={() => toggleRuntimeLogs(pkg)} disabled={runtimeLogsLoading === pkg.id}>
                      {runtimeLogsByApp[pkg.id] ? 'Hide Logs' : (runtimeLogsLoading === pkg.id ? 'Loading Logs...' : 'Logs')}
                    </button>
                  {/if}
                  <button class="btn ghost" onclick={() => runHealthCheck(pkg)} disabled={healthLoading === pkg.id}>
                    {healthLoading === pkg.id ? 'Health...' : 'Health'}
                  </button>
                  <button class="btn ghost" onclick={() => toggleOpsConsole(pkg)} disabled={lifecycleLoading === pkg.id || runtimeEventsLoading === pkg.id}>
                    {isConsoleOpen(pkg) ? 'Ops Close' : 'Ops Console'}
                  </button>
                  <button class="btn danger" onclick={() => removeInstalledPackage(pkg)}>
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
                {#if isConsoleOpen(pkg)}
                  <div class="ops-console">
                    <div class="ops-row">
                      <div class="ops-group">
                        <label>Release Channel</label>
                        <div class="ops-inline">
                          {#each ['stable', 'beta', 'alpha', 'canary'] as channel}
                            <button
                              class="btn tiny {getLifecycleCurrentChannel(pkg) === channel ? 'primary' : 'ghost'}"
                              onclick={() => setReleaseChannel(pkg, channel)}
                              disabled={Boolean(lifecycleActioning)}
                            >
                              {channel}
                            </button>
                          {/each}
                        </div>
                      </div>
                      <div class="ops-group">
                        <label>Recover Flow</label>
                        <div class="ops-inline">
                          <button class="btn tiny ghost" onclick={() => recoverRuntime(pkg)} disabled={lifecycleActioning === `${pkg.id}:recover`}>
                            {lifecycleActioning === `${pkg.id}:recover` ? 'Recovering...' : 'Recover'}
                          </button>
                          <button class="btn tiny ghost" onclick={() => loadRuntimeEvents(pkg.id)} disabled={runtimeEventsLoading === pkg.id}>
                            {runtimeEventsLoading === pkg.id ? 'Loading events...' : 'Reload events'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <label>Create Backup</label>
                        <div class="ops-inline">
                          <input
                            type="text"
                            placeholder="backup note"
                            value={getBackupNote(pkg.id)}
                            oninput={(event) => setBackupNote(pkg.id, event.currentTarget.value)}
                          />
                          <button class="btn tiny ghost" onclick={() => createLifecycleBackup(pkg)} disabled={lifecycleActioning === `${pkg.id}:backup`}>
                            {lifecycleActioning === `${pkg.id}:backup` ? 'Backing up...' : 'Backup'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <label>Rollback</label>
                        <div class="ops-inline">
                          <select
                            onchange={(event) => setSelectedBackup(pkg.id, event.currentTarget.value)}
                            value={selectedBackupByApp[pkg.id] || ''}
                          >
                            <option value="">select backup</option>
                            {#each getAvailableBackups(pkg) as backup}
                              <option value={backup.id}>
                                {backup.id} | {backup.version} | {formatDateTime(backup.createdAt)}
                              </option>
                            {/each}
                          </select>
                          <button class="btn tiny danger" onclick={() => rollbackToBackup(pkg)} disabled={lifecycleActioning === `${pkg.id}:rollback`}>
                            {lifecycleActioning === `${pkg.id}:rollback` ? 'Rolling back...' : 'Rollback'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="ops-row split">
                      <div class="ops-panel">
                        <div class="ops-panel-title">Lifecycle Summary</div>
                        {#if lifecycleLoading === pkg.id}
                          <div class="runtime-log-empty">Loading lifecycle...</div>
                        {:else if !getLifecycle(pkg)}
                          <div class="runtime-log-empty">No lifecycle data.</div>
                        {:else}
                          <div class="ops-meta-list">
                            <div>Current: {getLifecycle(pkg)?.current?.version || '-'}</div>
                            <div>Installed: {formatDateTime(getLifecycle(pkg)?.current?.installedAt)}</div>
                            <div>Source: {getLifecycle(pkg)?.current?.source || '-'}</div>
                            <div>Backups: {getAvailableBackups(pkg).length}</div>
                          </div>
                        {/if}
                      </div>
                      <div class="ops-panel">
                        <div class="ops-panel-title">Recent Runtime Events</div>
                        {#if runtimeEventsLoading === pkg.id}
                          <div class="runtime-log-empty">Loading events...</div>
                        {:else if !runtimeEventsByApp[pkg.id] || runtimeEventsByApp[pkg.id].length === 0}
                          <div class="runtime-log-empty">No events.</div>
                        {:else}
                          <div class="event-list">
                            {#each runtimeEventsByApp[pkg.id].slice(-10).reverse() as event}
                              <div class="event-row">
                                <span>{formatDateTime(event.timestamp)}</span>
                                <span>{formatEventLabel(event)}</span>
                                <span>{event.reason || event.message || '-'}</span>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <label>Last Health/QA</label>
                        {#if getHealthReport(pkg)}
                          <div class="ops-meta-list">
                            <div>Status: {String(getHealthStatus(pkg)).toUpperCase()}</div>
                            <div>Checked: {formatDateTime(getHealthReport(pkg)?.checkedAt)}</div>
                            <div>Summary: {getHealthReport(pkg)?.summary || '-'}</div>
                          </div>
                        {:else}
                          <div class="runtime-log-empty">No health report yet.</div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/if}
                {#if runtimeLogsByApp[pkg.id]}
                  <div class="runtime-log-panel">
                    {#if runtimeLogsByApp[pkg.id].length === 0}
                      <div class="runtime-log-empty">No logs.</div>
                    {:else}
                      {#each runtimeLogsByApp[pkg.id] as row}
                        <div class="runtime-log-line">
                          <span>[{new Date(row.timestamp).toLocaleTimeString()}]</span>
                          <span class="runtime-log-stream {row.stream}">{row.stream}</span>
                          <span>{row.message}</span>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .package-center {
    height: 100%;
    padding: 20px;
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 16px;
    color: var(--text-main);
    background:
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 30%),
      linear-gradient(180deg, rgba(7, 14, 26, 0.88) 0%, rgba(5, 9, 18, 0.92) 100%);
    overflow: auto;
  }

  .category-panel {
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: fit-content;
    background: rgba(15, 23, 36, 0.7);
  }

  .panel-title {
    font-size: 13px;
    color: #7dd3fc;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .category {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: transparent;
    color: var(--text-main);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .category.active {
    border-color: rgba(14, 165, 233, 0.45);
    background: rgba(14, 165, 233, 0.15);
    color: #dbeafe;
  }

  .content {
    display: grid;
    gap: 12px;
  }

  .feedback {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13px;
    background: rgba(15, 23, 36, 0.7);
  }

  .feedback.info {
    color: #bbf7d0;
    border-color: rgba(16, 185, 129, 0.35);
  }

  .feedback.error {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.3);
  }

  .block {
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 14px;
    background: rgba(15, 23, 36, 0.7);
    display: grid;
    gap: 12px;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  h3 {
    margin: 0;
    font-size: 16px;
  }

  .source-form {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto;
    gap: 8px;
  }

  input {
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.65);
    color: #e2e8f0;
    padding: 9px 10px;
  }

  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .source-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    padding: 6px 10px;
    background: rgba(148, 163, 184, 0.08);
    font-size: 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  .ecosystem-templates {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.35);
    display: grid;
    gap: 10px;
  }

  .section-title {
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #bae6fd;
  }

  .template-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .template-card {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: rgba(15, 23, 36, 0.7);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .template-top {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }

  .template-top strong {
    font-size: 13px;
  }

  .template-top span {
    font-size: 11px;
    color: #93c5fd;
    border: 1px solid rgba(96, 165, 250, 0.35);
    border-radius: 999px;
    padding: 2px 7px;
  }

  .template-card p {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.4;
  }

  .store-categories {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .store-filter {
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 999px;
    padding: 6px 10px;
    background: rgba(2, 6, 23, 0.45);
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
  }

  .store-filter.active {
    color: #dbeafe;
    border-color: rgba(56, 189, 248, 0.34);
    background: rgba(14, 165, 233, 0.16);
  }

  .source-errors {
    display: grid;
    gap: 8px;
  }

  .source-error {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px dashed rgba(248, 113, 113, 0.35);
    border-radius: 10px;
    background: rgba(127, 29, 29, 0.14);
    padding: 8px 10px;
    font-size: 12px;
    color: #fecaca;
  }

  .card {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 14px;
    padding: 12px;
    display: grid;
    gap: 10px;
    background: rgba(2, 6, 23, 0.45);
  }

  .card-head {
    display: flex;
    gap: 10px;
  }

  .icon-box {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7dd3fc;
    background: rgba(14, 165, 233, 0.14);
    flex-shrink: 0;
  }

  .icon-image {
    width: 18px;
    height: 18px;
    object-fit: contain;
    border-radius: 4px;
  }

  .meta h4 {
    margin: 0;
    font-size: 14px;
  }

  .meta p {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.35;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips span {
    padding: 5px 8px;
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-dim);
    background: rgba(148, 163, 184, 0.08);
  }

  .chips .runtime {
    font-weight: 600;
  }

  .chips .runtime.running {
    color: #bbf7d0;
    background: rgba(22, 163, 74, 0.18);
  }

  .chips .runtime.starting,
  .chips .runtime.degraded {
    color: #fde68a;
    background: rgba(202, 138, 4, 0.18);
  }

  .chips .runtime.error {
    color: #fecaca;
    background: rgba(185, 28, 28, 0.2);
  }

  .chips .runtime.stopped {
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.25);
  }

  .chips .health.pass {
    color: #bbf7d0;
    background: rgba(22, 163, 74, 0.18);
  }

  .chips .health.warn {
    color: #fde68a;
    background: rgba(202, 138, 4, 0.18);
  }

  .chips .health.fail,
  .chips .health.error {
    color: #fecaca;
    background: rgba(185, 28, 28, 0.2);
  }

  .chips .health.unknown {
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.25);
  }

  .actions {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .btn {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: transparent;
    color: var(--text-main);
    padding: 8px 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .btn.primary {
    color: #dbeafe;
    border-color: rgba(56, 189, 248, 0.3);
    background: rgba(14, 165, 233, 0.16);
  }

  .btn.ghost {
    background: rgba(15, 23, 36, 0.72);
  }

  .btn.danger {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.3);
    background: rgba(127, 29, 29, 0.2);
  }

  .btn.tiny {
    padding: 4px 8px;
    font-size: 11px;
    border-radius: 999px;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .empty {
    min-height: 120px;
    border: 1px dashed rgba(148, 163, 184, 0.25);
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 13px;
  }

  .ops-console {
    margin-top: 2px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.5);
    display: grid;
    gap: 10px;
  }

  .ops-row {
    display: grid;
    gap: 8px;
  }

  .ops-row.split {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .ops-group {
    display: grid;
    gap: 6px;
  }

  .ops-group label {
    font-size: 11px;
    color: #93c5fd;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .ops-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .ops-inline input,
  .ops-inline select {
    min-width: 160px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.65);
    color: #e2e8f0;
    padding: 6px 8px;
    font-size: 12px;
  }

  .ops-panel {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    padding: 8px;
    background: rgba(15, 23, 36, 0.45);
    display: grid;
    gap: 8px;
  }

  .ops-panel-title {
    font-size: 12px;
    font-weight: 600;
    color: #dbeafe;
  }

  .ops-meta-list {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: #cbd5e1;
  }

  .event-list {
    max-height: 170px;
    overflow: auto;
    display: grid;
    gap: 6px;
  }

  .event-row {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr 1fr;
    gap: 8px;
    font-size: 11px;
    color: #cbd5e1;
  }

  @media (max-width: 1000px) {
    .package-center {
      grid-template-columns: 1fr;
    }

    .source-form {
      grid-template-columns: 1fr;
    }

    .ops-row.split {
      grid-template-columns: 1fr;
    }
  }

  .runtime-log-panel {
    margin-top: 4px;
    max-height: 180px;
    overflow: auto;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(2, 6, 23, 0.65);
    padding: 8px;
    display: grid;
    gap: 4px;
  }

  .runtime-log-line {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 8px;
    font-size: 11px;
    color: #cbd5e1;
    line-height: 1.35;
  }

  .runtime-log-stream {
    text-transform: uppercase;
    opacity: 0.9;
  }

  .runtime-log-stream.stderr {
    color: #fecaca;
  }

  .runtime-log-stream.system {
    color: #bae6fd;
  }

  .runtime-log-empty {
    font-size: 12px;
    color: var(--text-dim);
  }
</style>

