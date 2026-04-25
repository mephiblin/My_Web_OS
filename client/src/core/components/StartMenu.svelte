<script>
  import { LayoutGrid, Search } from 'lucide-svelte';
  import {
    startMenuState,
    closeStartMenu,
    clearStartMenuQuery,
    setStartMenuQuery,
    togglePinnedApp
  } from '../stores/startMenuStore.js';

  let { apps = [], onOpenApp, startButtonEl = null } = $props();

  let menuEl = $state(null);
  let searchInputEl = $state(null);

  const filteredApps = $derived.by(() => {
    const query = $startMenuState.query.trim().toLowerCase();
    const sortedApps = [...apps].sort((a, b) => {
      const titleA = (a?.title || '').toLowerCase();
      const titleB = (b?.title || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });

    if (!query) return sortedApps;

    return sortedApps.filter((app) => {
      const title = (app?.title || '').toLowerCase();
      const id = (app?.id || '').toLowerCase();
      return title.includes(query) || id.includes(query);
    });
  });

  const pinnedApps = $derived.by(() => {
    const pinned = Array.isArray($startMenuState.pinnedAppIds) ? $startMenuState.pinnedAppIds : [];
    const byId = new Map((apps || []).map((app) => [String(app.id), app]));
    return pinned.map((id) => byId.get(String(id))).filter(Boolean);
  });

  function handleWindowMouseDown(event) {
    if (!$startMenuState.isOpen) return;
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

  function isPinned(app) {
    const id = String(app?.id || '');
    return Array.isArray($startMenuState.pinnedAppIds) && $startMenuState.pinnedAppIds.includes(id);
  }

  $effect(() => {
    if (!$startMenuState.isOpen) return;
    requestAnimationFrame(() => {
      searchInputEl?.focus();
    });
  });
</script>

<svelte:window onmousedown={handleWindowMouseDown} onkeydown={handleWindowKeydown} />

{#if $startMenuState.isOpen}
  <div class="start-menu glass-effect {$startMenuState.layout}" bind:this={menuEl} role="dialog" aria-label="Start Menu">
    <div class="menu-header">
      <div class="menu-title">Start</div>
      <div class="menu-count">{filteredApps.length} apps</div>
    </div>

    <label class="search-wrap">
      <Search size={14} />
      <input
        bind:this={searchInputEl}
        type="text"
        placeholder="Search apps"
        value={$startMenuState.query}
        oninput={(event) => setStartMenuQuery(event.currentTarget.value)}
      />
    </label>

    <div class="app-list" role="listbox" aria-label="Applications">
      {#if pinnedApps.length > 0}
        <div class="group-label">Pinned</div>
        {#each pinnedApps as app}
          <button class="app-item pinned" onclick={() => handleOpenApp(app)}>
            <span class="app-icon">
              {#if app.iconType === 'image' && app.iconUrl}
                <img class="app-icon-image" src={app.iconUrl} alt={app.title} loading="lazy" />
              {:else}
                {@const AppIcon = app.iconComponent || LayoutGrid}
                <AppIcon size={16} />
              {/if}
            </span>
            <span class="app-title">{app.title}</span>
            <span
              class="pin-btn"
              role="button"
              tabindex="0"
              onclick={(event) => { event.stopPropagation(); togglePinnedApp(app.id); }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  togglePinnedApp(app.id);
                }
              }}
            >Unpin</span>
          </button>
        {/each}
        <div class="group-label">All Apps</div>
      {/if}
      {#if filteredApps.length === 0}
        <div class="empty-state">No apps found</div>
      {:else}
        {#each filteredApps as app}
          <button class="app-item" onclick={() => handleOpenApp(app)}>
            <span class="app-icon">
              {#if app.iconType === 'image' && app.iconUrl}
                <img class="app-icon-image" src={app.iconUrl} alt={app.title} loading="lazy" />
              {:else}
                {@const AppIcon = app.iconComponent || LayoutGrid}
                <AppIcon size={16} />
              {/if}
            </span>
            <span class="app-title">{app.title}</span>
            <span
              class="pin-btn"
              role="button"
              tabindex="0"
              onclick={(event) => { event.stopPropagation(); togglePinnedApp(app.id); }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  togglePinnedApp(app.id);
                }
              }}
            >
              {isPinned(app) ? 'Unpin' : 'Pin'}
            </span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .start-menu {
    position: absolute;
    left: 10px;
    bottom: 56px;
    width: min(360px, calc(100vw - 20px));
    max-height: min(520px, calc(100vh - 90px));
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 10000;
  }
  .start-menu.compact {
    width: min(300px, calc(100vw - 20px));
  }
  .start-menu.wide {
    width: min(440px, calc(100vw - 20px));
  }

  .menu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .menu-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-main);
  }

  .menu-count {
    font-size: 11px;
    color: var(--text-dim);
  }

  .search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-dim);
    padding: 7px 9px;
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

  .app-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: auto;
    padding-right: 2px;
  }

  .app-item {
    width: 100%;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .app-item.pinned {
    background: rgba(88, 166, 255, 0.08);
  }

  .app-item:hover,
  .app-item:focus-visible {
    background: rgba(255, 255, 255, 0.1);
    outline: none;
  }

  .app-icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
  }

  .app-icon-image {
    width: 16px;
    height: 16px;
    object-fit: contain;
    border-radius: 4px;
  }

  .app-title {
    flex: 1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pin-btn {
    font-size: 11px;
    color: var(--text-dim);
    border: none;
    background: transparent;
    padding: 2px 4px;
    cursor: pointer;
    border-radius: 4px;
  }
  .pin-btn:hover,
  .pin-btn:focus-visible {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.08);
    outline: none;
  }
  .group-label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 8px 8px 4px;
  }

  .empty-state {
    padding: 16px 8px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
