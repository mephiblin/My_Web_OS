<script>
  import { LayoutGrid, Plus, Search } from 'lucide-svelte';
  import {
    startMenuState,
    closeStartMenu,
    clearStartMenuQuery,
    setStartMenuQuery,
    togglePinnedApp,
    toggleStartMenuKeepOpenOnDesktopClick,
    toggleStartMenuPresentation
  } from '../stores/startMenuStore.js';
  import { openContextMenu } from '../stores/contextMenuStore.js';
  import { i18n, translateWith } from '../i18n/index.js';

  let {
    apps = [],
    onOpenApp,
    onCreateDesktopShortcut,
    startButtonEl = null
  } = $props();

  const TAB_IDS = ['all', 'core-system', 'apps', 'packages'];
  let menuEl = $state(null);
  let searchInputEl = $state(null);
  let activeTab = $state('all');
  const isWindowsLayout = $derived($startMenuState.presentation === 'windows');

  const tabItems = $derived.by(() => [
    { id: 'all', label: translateWith($i18n, 'startMenu.tab.all', {}, 'All') },
    { id: 'core-system', label: translateWith($i18n, 'startMenu.tab.coreSystem', {}, 'Core System') },
    { id: 'apps', label: translateWith($i18n, 'startMenu.tab.apps', {}, 'Apps') },
    { id: 'packages', label: translateWith($i18n, 'startMenu.tab.packages', {}, 'Packages') }
  ]);
  const pinnedIdSet = $derived.by(() => new Set(Array.isArray($startMenuState.pinnedAppIds) ? $startMenuState.pinnedAppIds : []));

  function appMatchesTab(app, tabId) {
    const model = String(app?.appModel || '').toLowerCase();
    if (tabId === 'core-system') return model === 'system';
    if (tabId === 'packages') return model === 'package';
    if (tabId === 'apps') return model !== 'system' && model !== 'package';
    return true;
  }

  const filteredApps = $derived.by(() => {
    const query = $startMenuState.query.trim().toLowerCase();
    const safeTab = TAB_IDS.includes(activeTab) ? activeTab : 'all';
    const sortedApps = [...apps].sort((a, b) => {
      const titleA = (a?.title || '').toLowerCase();
      const titleB = (b?.title || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });

    return sortedApps.filter((app) => {
      if (!$startMenuState.presentation || $startMenuState.presentation === 'drawer') {
        if (!appMatchesTab(app, safeTab)) return false;
      }
      if (!query) return true;
      const title = (app?.title || '').toLowerCase();
      const id = (app?.id || '').toLowerCase();
      return title.includes(query) || id.includes(query);
    });
  });

  function handleWindowMouseDown(event) {
    if (!$startMenuState.isOpen) return;
    if ($startMenuState.keepOpenOnDesktopClick) return;
    if (menuEl && menuEl.contains(event.target)) return;
    if (startButtonEl && startButtonEl.contains(event.target)) return;
    closeStartMenu();
  }

  function handleWindowKeydown(event) {
    if (event.key !== 'Escape') return;
    if (!$startMenuState.isOpen) return;
    event.preventDefault();
    closeStartMenu();
  }

  function handleOpenApp(app) {
    onOpenApp?.(app);
    closeStartMenu();
    clearStartMenuQuery();
  }

  function handleAppContextMenu(event, app) {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY, [
      {
        label: translateWith($i18n, 'startMenu.createDesktopShortcut', {}, 'Create Desktop Shortcut'),
        icon: Plus,
        action: () => onCreateDesktopShortcut?.(app)
      }
    ]);
  }

  function isPinned(appId) {
    return pinnedIdSet.has(String(appId || ''));
  }

  $effect(() => {
    if (!$startMenuState.isOpen) return;
    requestAnimationFrame(() => {
      searchInputEl?.focus();
    });
  });

  $effect(() => {
    if (!$startMenuState.isOpen) return;
    if (!TAB_IDS.includes(activeTab)) {
      activeTab = 'all';
    }
  });
</script>

<svelte:window onmousedown={handleWindowMouseDown} onkeydown={handleWindowKeydown} />

{#if $startMenuState.isOpen}
  <div class="start-menu-overlay {isWindowsLayout ? 'windows' : 'drawer'}">
    <div class="start-menu {isWindowsLayout ? 'windows' : 'drawer'} glass-effect {$startMenuState.layout}" bind:this={menuEl} role="dialog" aria-label={translateWith($i18n, 'startMenu.ariaLabel', {}, 'App Drawer')}>
      <div class="menu-header">
        <div class="menu-title-wrap">
          <div class="menu-title">{translateWith($i18n, 'startMenu.title', {}, 'Start')}</div>
          <div class="menu-count">{translateWith($i18n, 'startMenu.appCount', { count: filteredApps.length }, `${filteredApps.length} apps`)}</div>
        </div>
        <div class="menu-actions">
          <button
            class="menu-toggle-btn {$startMenuState.keepOpenOnDesktopClick ? 'active' : ''}"
            type="button"
            onclick={toggleStartMenuKeepOpenOnDesktopClick}
          >
            {translateWith($i18n, 'startMenu.keepOpenToggle', {}, 'Keep Open')}
          </button>
          <button
            class="menu-toggle-btn {isWindowsLayout ? 'active' : ''}"
            type="button"
            onclick={toggleStartMenuPresentation}
          >
            {#if isWindowsLayout}
              {translateWith($i18n, 'startMenu.drawerModeToggle', {}, 'App Drawer')}
            {:else}
              {translateWith($i18n, 'startMenu.windowsModeToggle', {}, 'Windows Menu')}
            {/if}
          </button>
        </div>

        <label class="search-wrap">
          <Search size={15} />
          <input
            bind:this={searchInputEl}
            type="text"
            placeholder={translateWith($i18n, 'startMenu.searchAppsPlaceholder', {}, 'Search apps')}
            value={$startMenuState.query}
            oninput={(event) => setStartMenuQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      {#if !isWindowsLayout}
        <div class="tab-row" role="tablist" aria-label={translateWith($i18n, 'startMenu.categoriesAriaLabel', {}, 'App categories')}>
          {#each tabItems as tab}
            <button
              role="tab"
              class="tab-btn {activeTab === tab.id ? 'active' : ''}"
              aria-selected={activeTab === tab.id}
              onclick={() => (activeTab = tab.id)}
            >
              {tab.label}
            </button>
          {/each}
        </div>
      {/if}

      <div class="app-grid {isWindowsLayout ? 'windows' : 'drawer'}" role="listbox" aria-label={translateWith($i18n, 'startMenu.applicationsAriaLabel', {}, 'Applications')}>
        {#if filteredApps.length === 0}
          <div class="empty-state">{translateWith($i18n, 'startMenu.noAppsFound', {}, 'No apps found')}</div>
        {:else}
          {#each filteredApps as app}
            <button
              class="app-card {isWindowsLayout ? 'windows' : 'drawer'}"
              onclick={() => handleOpenApp(app)}
              oncontextmenu={(event) => handleAppContextMenu(event, app)}
              title={translateWith($i18n, 'startMenu.contextHint', {}, 'Right click for shortcut options')}
            >
              <span class="app-icon">
                {#if app.iconType === 'image' && app.iconUrl}
                  <img class="app-icon-image" src={app.iconUrl} alt={app.title} loading="lazy" />
                {:else}
                  {@const AppIcon = app.iconComponent || LayoutGrid}
                  <AppIcon size={24} />
                {/if}
              </span>
              {#if isWindowsLayout}
                <span class="app-meta">
                  <span class="app-title">{app.title}</span>
                  <span class="app-subtitle">{app.id}</span>
                </span>
                <span class="app-actions">
                  <span
                    class="quick-shortcut-btn"
                    role="button"
                    tabindex="0"
                    onclick={(event) => { event.preventDefault(); event.stopPropagation(); onCreateDesktopShortcut?.(app); }}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCreateDesktopShortcut?.(app);
                      }
                    }}
                  >
                    <Plus size={11} />
                  </span>
                  <span
                    class="pin-btn"
                    role="button"
                    tabindex="0"
                    onclick={(event) => { event.preventDefault(); event.stopPropagation(); togglePinnedApp(app.id); }}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        togglePinnedApp(app.id);
                      }
                    }}
                  >
                    {isPinned(app.id)
                      ? translateWith($i18n, 'startMenu.unpin', {}, 'Unpin')
                      : translateWith($i18n, 'startMenu.pin', {}, 'Pin')}
                  </span>
                </span>
              {:else}
                <span class="app-title">{app.title}</span>
                <span class="app-subtitle">{app.id}</span>
                <span class="app-shortcut-hint">
                  <Plus size={12} />
                  {translateWith($i18n, 'startMenu.shortcutHint', {}, 'Shortcut')}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .start-menu-overlay {
    position: absolute;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 26px 18px 62px;
    background: radial-gradient(circle at 50% 100%, rgba(15, 42, 68, 0.3), rgba(2, 6, 23, 0));
    pointer-events: none;
  }
  .start-menu-overlay.windows {
    justify-content: flex-start;
    padding-left: 12px;
    background: radial-gradient(circle at 12% 100%, rgba(15, 42, 68, 0.28), rgba(2, 6, 23, 0));
  }

  .start-menu {
    width: min(1080px, calc(100vw - 36px));
    height: min(700px, calc(100vh - 100px));
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    pointer-events: auto;
    overflow: hidden;
  }
  .start-menu.windows {
    width: min(500px, calc(100vw - 24px));
    height: min(560px, calc(100vh - 92px));
    border-radius: 12px;
  }

  .start-menu.drawer.compact {
    width: min(920px, calc(100vw - 36px));
  }

  .start-menu.drawer.wide {
    width: min(1240px, calc(100vw - 36px));
  }

  .menu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .start-menu.windows .menu-header {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'title actions'
      'search search';
    align-items: center;
    gap: 10px;
  }
  .start-menu.windows .menu-title-wrap { grid-area: title; }
  .start-menu.windows .menu-actions { grid-area: actions; }
  .start-menu.windows .search-wrap { grid-area: search; width: 100%; }
  .menu-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .menu-toggle-btn {
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1;
    padding: 7px 9px;
    cursor: pointer;
    white-space: nowrap;
  }
  .menu-toggle-btn:hover,
  .menu-toggle-btn:focus-visible {
    color: var(--text-main);
    border-color: rgba(255, 255, 255, 0.34);
    outline: none;
  }
  .menu-toggle-btn.active {
    color: #eaf4ff;
    border-color: rgba(88, 166, 255, 0.55);
    background: rgba(88, 166, 255, 0.2);
  }

  .menu-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .menu-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-main);
    letter-spacing: 0.02em;
  }

  .menu-count {
    font-size: 12px;
    color: var(--text-dim);
  }

  .search-wrap {
    width: min(360px, 44vw);
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-dim);
    padding: 9px 11px;
  }

  .search-wrap input {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text-main);
    border: none;
    background: transparent;
    font: inherit;
    outline: none;
  }

  .search-wrap input::placeholder {
    color: var(--text-dim);
  }

  .tab-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }

  .tab-btn {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-dim);
    padding: 7px 12px;
    border-radius: 999px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-btn:hover,
  .tab-btn:focus-visible {
    color: var(--text-main);
    border-color: rgba(255, 255, 255, 0.35);
    outline: none;
  }

  .tab-btn.active {
    color: #eaf4ff;
    background: rgba(88, 166, 255, 0.2);
    border-color: rgba(88, 166, 255, 0.55);
  }

  .app-grid {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(152px, 1fr));
    grid-auto-rows: minmax(126px, max-content);
    align-content: start;
    align-items: start;
    gap: 10px;
    overflow: auto;
    padding: 2px;
  }
  .app-grid.windows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .app-card {
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-main);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 12px;
    cursor: pointer;
    text-align: left;
    min-height: 126px;
    position: relative;
    transition: border-color 0.16s ease, transform 0.16s ease, background 0.16s ease;
  }
  .app-card.windows {
    min-height: 64px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: 12px;
    padding: 10px 12px;
  }
  .app-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .app-card.windows .app-shortcut-hint {
    display: none;
  }
  .app-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .quick-shortcut-btn {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.04);
    color: var(--text-dim);
    cursor: pointer;
  }
  .quick-shortcut-btn:hover,
  .quick-shortcut-btn:focus-visible {
    color: var(--text-main);
    border-color: rgba(255,255,255,0.35);
    outline: none;
  }
  .pin-btn {
    font-size: 11px;
    color: var(--text-dim);
    border: 1px solid rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.03);
    padding: 3px 7px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .pin-btn:hover,
  .pin-btn:focus-visible {
    color: var(--text-main);
    border-color: rgba(255,255,255,0.35);
    outline: none;
  }

  .app-card:hover,
  .app-card:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(88, 166, 255, 0.55);
    transform: translateY(-2px);
    outline: none;
  }

  .app-icon {
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
  }

  .app-icon-image {
    width: 24px;
    height: 24px;
    object-fit: contain;
    border-radius: 6px;
  }

  .app-title {
    font-size: 13px;
    font-weight: 600;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-subtitle {
    margin-top: -2px;
    font-size: 11px;
    color: var(--text-dim);
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-shortcut-hint {
    margin-top: auto;
    font-size: 11px;
    color: rgba(198, 226, 255, 0.9);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.14s ease;
  }

  .app-card:hover .app-shortcut-hint,
  .app-card:focus-visible .app-shortcut-hint {
    opacity: 1;
  }

  .empty-state {
    grid-column: 1 / -1;
    padding: 30px 8px;
    text-align: center;
    font-size: 13px;
    color: var(--text-dim);
  }

  @media (max-width: 900px) {
    .start-menu-overlay {
      padding: 16px 10px 56px;
    }

    .start-menu {
      width: calc(100vw - 20px);
      height: min(680px, calc(100vh - 80px));
      padding: 14px;
      border-radius: 12px;
    }

    .menu-header {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    .menu-actions {
      margin-left: 0;
      flex-wrap: wrap;
    }

    .search-wrap {
      width: 100%;
    }

    .app-grid {
      grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
      gap: 8px;
    }
  }
</style>
