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
  let installedPackages = $state([]);
  let storeSourceErrors = $state([]);
  let runtimeStatusByApp = $state({});
  let runtimeLogsByApp = $state({});
  let runtimeActioning = $state('');
  let runtimeLogsLoading = $state('');

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

  function getSourcePackageCount(sourceId) {
    return storePackages.filter((pkg) => pkg.source?.id === sourceId).length;
  }

  async function loadInstalledPackages() {
    loadingInstalled = true;
    try {
      const response = await apiFetch('/api/packages');
      installedPackages = Array.isArray(response.packages) ? response.packages : [];
    } catch (err) {
      installedPackages = [];
      error = err.message || '설치된 패키지 목록을 가져오지 못했습니다.';
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
          error: result.error || '스토어를 읽지 못했습니다.'
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
      error = err.message || '스토어 목록을 불러오지 못했습니다.';
    } finally {
      loadingStore = false;
    }
  }

  async function saveStoreSource() {
    clearFeedback();
    const normalizedUrl = normalizeRegistryUrl(sourceForm.url);
    const sourceId = sourceForm.id.trim() || slugify(sourceForm.title || normalizedUrl);

    if (!normalizedUrl) {
      error = '스토어 주소를 입력하세요.';
      return;
    }
    if (!sourceId) {
      error = '스토어 ID를 입력하세요.';
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

      message = `스토어 "${sourceId}"를 추가했습니다.`;
      sourceForm = { id: '', title: '', url: '' };
      await loadRegistrySources();
      await loadStorePackages();
    } catch (err) {
      error = err.message || '스토어 주소 저장에 실패했습니다.';
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
      message = `스토어 "${sourceId}"를 제거했습니다.`;
      if (activeStoreSource === sourceId) {
        activeStoreSource = 'all';
      }
      await loadRegistrySources();
      await loadStorePackages();
    } catch (err) {
      error = err.message || '스토어 제거에 실패했습니다.';
    }
  }

  async function installPackage(pkg) {
    installingPackageId = pkg.id;
    clearFeedback();
    try {
      await apiFetch('/api/packages/registry/install', {
        method: 'POST',
        body: JSON.stringify({
          sourceId: pkg.source?.id,
          packageId: pkg.id,
          zipUrl: pkg.zipUrl || ''
        })
      });
      message = `패키지 "${pkg.title}" 설치 완료`;
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
    } catch (err) {
      error = err.message || '패키지 설치에 실패했습니다.';
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
      message = `"${pkg.title}" 실행 중인 창이 없습니다.`;
      return;
    }

    for (const win of active) {
      closeWindow(win.id);
    }
    message = `"${pkg.title}" 창 ${active.length}개를 중지했습니다.`;
  }

  async function controlRuntime(pkg, action) {
    runtimeActioning = `${pkg.id}:${action}`;
    clearFeedback();
    try {
      await apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/${action}`, {
        method: 'POST'
      });
      await loadRuntimeStatuses();
      message = `"${pkg.title}" ${action === 'start' ? '시작' : action === 'stop' ? '중지' : '재시작'} 완료`;
    } catch (err) {
      error = err.message || `런타임 ${action} 처리에 실패했습니다.`;
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
      const response = await apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/logs?limit=200`);
      runtimeLogsByApp = {
        ...runtimeLogsByApp,
        [pkg.id]: Array.isArray(response.logs) ? response.logs : []
      };
    } catch (err) {
      error = err.message || '런타임 로그를 불러오지 못했습니다.';
    } finally {
      runtimeLogsLoading = '';
    }
  }

  async function removeInstalledPackage(pkg) {
    clearFeedback();
    const ok = globalThis.confirm(`"${pkg.title}" 패키지를 제거하시겠습니까?`);
    if (!ok) return;

    try {
      if (isServicePackage(pkg)) {
        await apiFetch(`/api/runtime/apps/${encodeURIComponent(pkg.id)}/stop`, { method: 'POST' }).catch(() => {});
      }
      await apiFetch(`/api/packages/${encodeURIComponent(pkg.id)}`, {
        method: 'DELETE'
      });
      stopInstalledPackage(pkg);
      message = `"${pkg.title}" 제거 완료`;
      clearRuntimeLogs(pkg.id);
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
    } catch (err) {
      error = err.message || '패키지 제거에 실패했습니다.';
    }
  }

  onMount(async () => {
    await Promise.all([loadRegistrySources(), loadStorePackages(), loadInstalledPackages(), loadRuntimeStatuses()]);
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
      <span>설치됨</span>
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
          <h3>Store 주소 추가</h3>
          <button class="btn ghost" onclick={loadStorePackages} disabled={loadingStore}>
            <RefreshCw size={14} />
            새로고침
          </button>
        </div>

        <div class="source-form">
          <input type="text" bind:value={sourceForm.url} oninput={syncSourceId} placeholder="GitHub URL 또는 raw JSON URL" />
          <input type="text" bind:value={sourceForm.title} oninput={syncSourceId} placeholder="Store 이름" />
          <input type="text" bind:value={sourceForm.id} placeholder="store-id" />
          <button class="btn primary" onclick={saveStoreSource} disabled={savingSource}>
            <Link2 size={14} />
            {savingSource ? '저장 중...' : '스토어 추가'}
          </button>
        </div>

        {#if registrySources.length > 0}
          <div class="sources">
            {#each registrySources as source}
              <div class="source-pill">
                <span>{source.title} ({source.id})</span>
                <button class="btn tiny" onclick={() => removeStoreSource(source.id)}>제거</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="block glass-effect">
        <div class="block-head">
          <h3>Store 목록</h3>
        </div>
        <div class="store-categories">
          <button class="store-filter {activeStoreSource === 'all' ? 'active' : ''}" onclick={() => activeStoreSource = 'all'}>
            전체 ({storePackages.length})
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
          <div class="empty">스토어 목록 로딩 중...</div>
        {:else if getVisibleStorePackages().length === 0}
          <div class="empty">표시할 스토어 패키지가 없습니다.</div>
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
                    <button class="btn ghost" disabled>설치됨</button>
                  {:else if !pkg.zipUrl}
                    <button class="btn ghost" disabled>설치 불가</button>
                  {:else}
                    <button class="btn primary" onclick={() => installPackage(pkg)} disabled={installingPackageId === pkg.id}>
                      <Download size={14} />
                      {installingPackageId === pkg.id ? '설치 중...' : '설치'}
                    </button>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if activeCategory === CATEGORY.INSTALLED}
      <div class="block glass-effect">
        <div class="block-head">
          <h3>설치됨</h3>
          <button class="btn ghost" onclick={() => Promise.all([loadInstalledPackages(), loadRuntimeStatuses()])} disabled={loadingInstalled}>
            <RefreshCw size={14} />
            새로고침
          </button>
        </div>

        {#if loadingInstalled}
          <div class="empty">설치된 패키지 로딩 중...</div>
        {:else if installedPackages.length === 0}
          <div class="empty">설치된 패키지가 없습니다.</div>
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
                  {#if isServicePackage(pkg)}
                    <span class="runtime {getRuntimeState(pkg)?.status || 'stopped'}">{getRuntimeStatusLabel(pkg)}</span>
                  {/if}
                </div>
                <div class="actions">
                  {#if canOpenPackage(pkg)}
                    <button class="btn primary" onclick={() => openInstalledPackage(pkg)}>
                      <Play size={14} />
                      열기
                    </button>
                    <button class="btn ghost" onclick={() => stopInstalledPackage(pkg)}>
                      <Square size={14} />
                      창 중지
                    </button>
                  {/if}
                  {#if isServicePackage(pkg)}
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'start')} disabled={runtimeActioning === `${pkg.id}:start` || isRuntimeRunning(pkg)}>
                      <Play size={14} />
                      시작
                    </button>
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'stop')} disabled={runtimeActioning === `${pkg.id}:stop` || !isRuntimeRunning(pkg)}>
                      <Square size={14} />
                      서비스 중지
                    </button>
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'restart')} disabled={runtimeActioning === `${pkg.id}:restart`}>
                      <RotateCcw size={14} />
                      재시작
                    </button>
                    <button class="btn ghost" onclick={() => toggleRuntimeLogs(pkg)} disabled={runtimeLogsLoading === pkg.id}>
                      {runtimeLogsByApp[pkg.id] ? '로그 닫기' : (runtimeLogsLoading === pkg.id ? '로그 로딩...' : '로그')}
                    </button>
                  {/if}
                  <button class="btn danger" onclick={() => removeInstalledPackage(pkg)}>
                    <Trash2 size={14} />
                    제거
                  </button>
                </div>
                {#if runtimeLogsByApp[pkg.id]}
                  <div class="runtime-log-panel">
                    {#if runtimeLogsByApp[pkg.id].length === 0}
                      <div class="runtime-log-empty">로그가 없습니다.</div>
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

  @media (max-width: 1000px) {
    .package-center {
      grid-template-columns: 1fr;
    }

    .source-form {
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
