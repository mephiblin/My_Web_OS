<script>
  import { Search, Command, AppWindow, File, Folder, LogOut, Power, RefreshCw } from 'lucide-svelte';
  import { spotlightVisible, spotlightQuery, closeSpotlight } from './stores/spotlightStore.js';
  import { addToast } from './stores/toastStore.js';
  import { contextMenuSettings } from './stores/contextMenuStore.js';
  import * as fsApi from '../apps/system/file-explorer/api.js';
  import { getFileExtension, resolveOpenPlan } from '../apps/system/file-explorer/services/fileAssociations.js';
  import { i18n, localizeAppTitle, translateWith } from './i18n/index.js';

  let { apps = [], onOpenAppById } = $props();

  let inputEl = $state(null);
  let results = $state([]);
  let selectedIndex = $state(0);
  let searchError = $state('');
  let searchingFiles = $state(false);
  let executingId = $state('');

  const normalizedApps = $derived.by(() => {
    const source = Array.isArray(apps) ? apps : [];
    return source
      .filter((app) => app?.id)
      .map((app) => ({
        ...app,
        title: localizeAppTitle(app, $i18n) || app.title || app.id
      }));
  });

  const commands = $derived.by(() => [
    {
      id: 'logout',
      kind: 'command',
      title: translateWith($i18n, 'spotlight.action.logout', {}, 'Log Out'),
      subtitle: translateWith($i18n, 'spotlight.commandUnavailable', {}, 'Unavailable'),
      disabledReason: translateWith($i18n, 'spotlight.logoutUnavailableReason', {}, 'Logout is not connected to the session manager yet.'),
      icon: LogOut
    },
    {
      id: 'reboot',
      kind: 'command',
      title: translateWith($i18n, 'spotlight.action.reboot', {}, 'Reboot'),
      subtitle: translateWith($i18n, 'spotlight.commandUnavailable', {}, 'Unavailable'),
      disabledReason: translateWith($i18n, 'spotlight.rebootUnavailableReason', {}, 'Reboot requires the risky operation approval contract before it can run here.'),
      icon: RefreshCw
    },
    {
      id: 'shutdown',
      kind: 'command',
      title: translateWith($i18n, 'spotlight.action.shutdown', {}, 'Shut Down'),
      subtitle: translateWith($i18n, 'spotlight.commandUnavailable', {}, 'Unavailable'),
      disabledReason: translateWith($i18n, 'spotlight.shutdownUnavailableReason', {}, 'Shutdown requires the risky operation approval contract before it can run here.'),
      icon: Power
    }
  ]);

  $effect(() => {
    if ($spotlightVisible && inputEl) {
      inputEl.focus();
    }
  });

  let debounceTimer;
  let fileSearchToken = 0;

  $effect(() => {
    const query = $spotlightQuery.trim();
    const q = query.toLowerCase();
    fileSearchToken += 1;
    const token = fileSearchToken;

    if (!q) {
      results = [];
      searchError = '';
      searchingFiles = false;
      selectedIndex = 0;
      if (debounceTimer) clearTimeout(debounceTimer);
      return;
    }

    const appResults = normalizedApps
      .filter((app) => appMatchesQuery(app, q))
      .map((app) => buildAppResult(app));
    const commandResults = commands.filter((command) => resultMatchesQuery(command, q));

    results = [...appResults, ...commandResults];
    searchError = '';
    searchingFiles = true;
    selectedIndex = 0;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const payload = await fsApi.searchFiles(query);
        if (token !== fileSearchToken) return;
        const mappedFiles = normalizeFileSearchItems(payload).map((item) => buildFileResult(item));
        results = [...appResults, ...commandResults, ...mappedFiles];
        searchError = '';
      } catch (err) {
        console.error('Search error', err);
        if (token !== fileSearchToken) return;
        searchError = formatError(err, translateWith($i18n, 'spotlight.searchFailed', {}, 'File search failed.'));
      } finally {
        if (token === fileSearchToken) {
          searchingFiles = false;
        }
      }
    }, 300);
  });

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSpotlight();
    } else if (e.key === 'ArrowDown') {
      if (results.length === 0) return;
      selectedIndex = (selectedIndex + 1) % results.length;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return;
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (results[selectedIndex]) {
        e.preventDefault();
        executeResult(results[selectedIndex]);
      }
    }
  }

  function appMatchesQuery(app, q) {
    return [
      app?.title,
      app?.id,
      app?.subtitle,
      app?.path,
      app?.entry,
      app?.manifestPath
    ].some((value) => String(value || '').toLowerCase().includes(q));
  }

  function resultMatchesQuery(result, q) {
    return [
      result?.title,
      result?.id,
      result?.subtitle
    ].some((value) => String(value || '').toLowerCase().includes(q));
  }

  function appTypeLabel(app) {
    const model = String(app?.appModel || app?.model || app?.type || '').toLowerCase();
    if (model === 'system') return translateWith($i18n, 'spotlight.systemType', {}, 'System');
    if (model === 'package') return translateWith($i18n, 'spotlight.packageType', {}, 'Package');
    return translateWith($i18n, 'spotlight.appType', {}, 'App');
  }

  function appSubtitle(app) {
    return String(
      app?.subtitle ||
      app?.path ||
      app?.entry ||
      app?.manifestPath ||
      app?.launch?.entryUrl ||
      app?.id ||
      ''
    ).trim();
  }

  function appIcon(app) {
    if (typeof app?.iconComponent === 'function') return app.iconComponent;
    if (typeof app?.icon === 'function') return app.icon;
    return AppWindow;
  }

  function buildAppResult(app) {
    return {
      id: `app:${app.id}`,
      kind: 'app',
      appId: app.id,
      title: app.title || app.id,
      subtitle: appSubtitle(app),
      typeLabel: appTypeLabel(app),
      icon: appIcon(app),
      iconType: app.iconType,
      iconUrl: app.iconUrl,
      app
    };
  }

  function normalizeFileSearchItems(payload) {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.data?.items)
          ? payload.data.items
          : [];
    return items.filter((item) => String(item?.path || '').trim());
  }

  function isFolderItem(item) {
    const type = String(item?.type || item?.kind || '').toLowerCase();
    return item?.isDirectory === true || item?.isDir === true || type === 'dir' || type === 'directory' || type === 'folder';
  }

  function fileNameFromPath(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    return parts.at(-1) || path || '';
  }

  function buildFileResult(item) {
    const path = String(item?.path || '').trim();
    const title = String(item?.name || item?.title || fileNameFromPath(path) || path).trim();
    const isFolder = isFolderItem(item);
    return {
      id: `${isFolder ? 'folder' : 'file'}:${path}`,
      kind: isFolder ? 'folder' : 'file',
      title,
      subtitle: path,
      path,
      extension: isFolder ? '' : getFileExtension(title || path),
      typeLabel: isFolder
        ? translateWith($i18n, 'spotlight.folderType', {}, 'Folder')
        : translateWith($i18n, 'spotlight.fileType', {}, 'File'),
      icon: isFolder ? Folder : File
    };
  }

  function preferredDefaultForExtension(extension) {
    const ext = String(extension || '').trim().toLowerCase();
    if (!ext) return '';
    return String($contextMenuSettings?.openWithByExtension?.[ext] || '').trim();
  }

  function fileGrantMode(action) {
    return action === 'edit' ? 'readwrite' : 'read';
  }

  function buildFileContext(item, grant, mode) {
    return {
      source: 'spotlight',
      file: {
        path: item.path,
        name: item.title,
        extension: item.extension,
        mode
      },
      permissionContext: {
        grantId: grant.id,
        scope: grant.scope || 'single-file',
        expiresOnWindowClose: true
      }
    };
  }

  async function callAppLauncher(appId, data = null) {
    if (typeof onOpenAppById !== 'function') {
      const err = new Error('Spotlight app launcher is not available.');
      err.code = 'SPOTLIGHT_LAUNCHER_MISSING';
      throw err;
    }
    await onOpenAppById(appId, data);
  }

  async function openFileResult(item) {
    const extension = item.extension || getFileExtension(item.title || item.path);
    const preferredDefault = preferredDefaultForExtension(extension);
    const plan = resolveOpenPlan(normalizedApps, extension, preferredDefault);
    const mode = fileGrantMode(plan.action);
    const grantResponse = await fsApi.createFileGrant(item.path, mode, plan.appId, 'spotlight');
    const grant = grantResponse?.grant || grantResponse || null;
    if (!grant?.id) {
      const err = new Error('File grant response did not include a grant id.');
      err.code = 'FILE_GRANT_MISSING';
      throw err;
    }

    try {
      await callAppLauncher(plan.appId, {
        path: item.path,
        fileContext: buildFileContext(item, grant, mode)
      });
    } catch (err) {
      fsApi.revokeFileGrant(grant.id, 'spotlight').catch(() => {});
      throw err;
    }
  }

  function formatError(err, fallbackMessage) {
    const code = String(err?.code || '').trim();
    const message = String(err?.message || err?.rawMessage || fallbackMessage || 'Request failed.').trim();
    return code ? `${message} (${code})` : message;
  }

  async function executeResult(item) {
    if (!item) return;
    if (item.kind === 'command') {
      addToast(item.disabledReason || translateWith($i18n, 'spotlight.commandUnavailableReason', {}, 'This command is unavailable.'), 'warning', 5000);
      return;
    }
    if (executingId) return;

    executingId = item.id;
    try {
      if (item.kind === 'app') {
        await callAppLauncher(item.appId);
      } else if (item.kind === 'file') {
        await openFileResult(item);
      } else if (item.kind === 'folder') {
        await callAppLauncher('files', { path: item.path });
      } else {
        const err = new Error('Unsupported Spotlight result type.');
        err.code = 'SPOTLIGHT_UNSUPPORTED_RESULT';
        throw err;
      }
      closeSpotlight();
    } catch (err) {
      addToast(formatError(err, translateWith($i18n, 'spotlight.launchFailed', { title: item.title }, `Could not open ${item.title}.`)), 'error', 5000);
    } finally {
      executingId = '';
    }
  }
</script>

{#if $spotlightVisible}
  <div class="spotlight-overlay" onclick={closeSpotlight} onkeydown={handleKeydown} role="button" tabindex="-1">
    <div
      class="spotlight-box glass-effect"
      role="dialog"
      aria-modal="true"
      aria-label={translateWith($i18n, 'spotlight.ariaLabel', {}, 'Spotlight Search')}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { e.stopPropagation(); handleKeydown(e); }}
    >
      <div class="search-input">
        <span class="search-icon"><Search size={24} /></span>
        <input
          bind:this={inputEl}
          bind:value={$spotlightQuery}
          placeholder={translateWith($i18n, 'spotlight.placeholder', {}, 'Spotlight Search...')}
          spellcheck="false"
        />
        <div class="shortcut">
          <Command size={14} /> <span>SPACE</span>
        </div>
      </div>

      {#if results.length > 0}
        <div class="results">
          {#each results as result, i}
            {@const ResultIcon = result.icon}
            <button
              class="result-item {i === selectedIndex ? 'selected' : ''} {result.disabledReason ? 'disabled' : ''}"
              onclick={() => executeResult(result)}
              onmouseenter={() => selectedIndex = i}
              aria-disabled={result.disabledReason ? 'true' : 'false'}
            >
              <div class="icon-box">
                {#if result.iconType === 'image' && result.iconUrl}
                  <img class="result-icon-image" src={result.iconUrl} alt="" loading="lazy" />
                {:else}
                  <ResultIcon size={20} />
                {/if}
              </div>
              <div class="result-meta">
                <span class="title">{result.title}</span>
                {#if result.subtitle}
                  <span class="subtitle">{result.subtitle}</span>
                {/if}
              </div>
              <span class="type">{result.typeLabel || translateWith($i18n, 'spotlight.commandType', {}, 'Command')}</span>
            </button>
          {/each}
        </div>
      {:else if $spotlightQuery && searchingFiles}
        <div class="no-results">
          <p>{translateWith($i18n, 'spotlight.searching', {}, 'Searching...')}</p>
        </div>
      {:else if $spotlightQuery && searchError}
        <div class="no-results error">
          <p>{searchError}</p>
        </div>
      {:else if $spotlightQuery}
        <div class="no-results">
          <p>{translateWith($i18n, 'spotlight.noResults', { query: $spotlightQuery }, `No results for "${$spotlightQuery}"`)}</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .spotlight-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    z-index: 10000;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .spotlight-box {
    width: 600px;
    height: fit-content;
    max-height: 500px;
    background: rgba(25, 25, 25, 0.85);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    box-shadow: 0 32px 64px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .search-input {
    display: flex;
    align-items: center;
    padding: 20px;
    gap: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .search-icon { color: var(--accent-blue); display: flex; }

  input {
    flex: 1;
    background: transparent;
    border: none;
    color: white;
    font-size: 20px;
    font-weight: 500;
    outline: none;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.1);
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 700;
  }

  .results {
    padding: 8px;
    overflow-y: auto;
  }

  .result-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    background: transparent;
    border: none;
    color: white;
    cursor: pointer;
    transition: all 0.1s;
  }

  .result-item.selected {
    background: var(--accent-blue);
    box-shadow: 0 4px 12px rgba(88, 166, 255, 0.3);
  }

  .result-item.disabled {
    opacity: 0.72;
  }

  .icon-box {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    flex-shrink: 0;
  }

  .result-item.selected .icon-box {
    background: rgba(255, 255, 255, 0.2);
  }

  .result-icon-image {
    width: 22px;
    height: 22px;
    object-fit: contain;
    border-radius: 5px;
  }

  .result-meta {
    flex: 1;
    display: grid;
    gap: 2px;
    min-width: 0;
    text-align: left;
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 500;
  }

  .subtitle {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.48);
  }

  .type {
    font-size: 12px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0;
    flex-shrink: 0;
  }

  .result-item.selected .type { color: rgba(255, 255, 255, 0.7); }

  .no-results { padding: 40px; text-align: center; color: var(--text-dim); }
  .no-results.error { color: #fecaca; }
</style>
