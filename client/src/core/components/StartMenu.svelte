<script>
  import { LayoutGrid, Search } from 'lucide-svelte';
  import {
    startMenuState,
    closeStartMenu,
    clearStartMenuQuery,
    setStartMenuQuery
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

  $effect(() => {
    if (!$startMenuState.isOpen) return;
    requestAnimationFrame(() => {
      searchInputEl?.focus();
    });
  });
</script>

<svelte:window onmousedown={handleWindowMouseDown} onkeydown={handleWindowKeydown} />

{#if $startMenuState.isOpen}
  <section class="start-menu glass-effect" bind:this={menuEl} role="dialog" aria-label="Start Menu">
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
      {#if filteredApps.length === 0}
        <div class="empty-state">No apps found</div>
      {:else}
        {#each filteredApps as app}
          <button class="app-item" onclick={() => handleOpenApp(app)}>
            <span class="app-icon">
              {#if app.iconType === 'image' && app.iconUrl}
                <img class="app-icon-image" src={app.iconUrl} alt={app.title} loading="lazy" />
              {:else}
                <svelte:component this={app.iconComponent || LayoutGrid} size={16} />
              {/if}
            </span>
            <span class="app-title">{app.title}</span>
          </button>
        {/each}
      {/if}
    </div>
  </section>
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

  .empty-state {
    padding: 16px 8px;
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
