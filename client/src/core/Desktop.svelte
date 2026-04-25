<script>
  import { onMount } from 'svelte';
  import { Shield, Monitor, Files, Terminal as TerminalIcon, Settings, Container, LayoutGrid, Video, Image, Search, Send, Folder, File, Trash2, ExternalLink } from 'lucide-svelte';
  import { windows, activeWindowId, openWindow, closeWindow, focusWindow, toggleMinimize, initWindows } from './stores/windowStore.js';
  import { contextMenu, openContextMenu, closeContextMenu, contextMenuSettings } from './stores/contextMenuStore.js';
  import { currentDesktopId, initDesktops, layoutEditMode } from './stores/desktopStore.js';
  import { snapGhost } from './stores/snapStore.js';
  import { widgets } from './stores/widgetStore.js';
  import { shortcuts, initShortcuts, removeShortcut } from './stores/shortcutStore.js';
  import Window from './Window.svelte';
  import SandboxAppFrame from './components/SandboxAppFrame.svelte';
  import DashboardWidget from './components/DashboardWidget.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import Agent from './components/Agent.svelte';
  import { agentStore } from './stores/agentStore.js';
  import Spotlight from './Spotlight.svelte';
  import { openSpotlight, toggleSpotlight } from './stores/spotlightStore.js';
  import Taskbar from './components/Taskbar.svelte';
  import StartMenu from './components/StartMenu.svelte';
  import NotificationCenter from './components/NotificationCenter.svelte';
  import { closeStartMenu, startMenuState, toggleStartMenu, initStartMenuState, registerRecentApp } from './stores/startMenuStore.js';
  import { taskbarSettings } from './stores/taskbarStore.js';
  import { windowDefaultsSettings } from './stores/windowDefaultsStore.js';
  import { widgetLibrary } from './stores/widgetLibraryStore.js';
  import { systemSettings } from './stores/systemStore.js';
  import { apiFetch } from '../utils/api.js';
  import { buildShortcutLaunch } from './shortcutLaunch.js';
  import { installWebOSBridge } from '../utils/webosBridge.js';
  import { loadBuiltinComponent, resolveWindowLaunch } from './appLaunchRegistry.js';
  import { normalizeAppModel, deriveOwnerTier, normalizeLaunchContract, normalizeDataBoundary } from './appOwnershipContract.js';

  const iconMap = {
    Shield, Monitor, Files, TerminalIcon, Settings, Container, LayoutGrid, Video, Image, Search, Send
  };

  function resolveIconComponent(iconName) {
    return iconMap[iconName] || LayoutGrid;
  }

  function getAppModelBadgeLabel(appModel) {
    if (appModel === 'system') return 'SYS';
    if (appModel === 'package') return 'PKG';
    return 'APP';
  }

  function normalizeDesktopApp(app) {
    const iconType = app?.iconType === 'image' && app?.iconUrl ? 'image' : 'lucide';
    const appModel = normalizeAppModel(app);
    const ownerTier = deriveOwnerTier(appModel);
    const launch = normalizeLaunchContract(app);
    return {
      ...app,
      appModel,
      ownerTier,
      dataBoundary: normalizeDataBoundary(app, launch, ownerTier),
      appModelBadge: getAppModelBadgeLabel(appModel),
      launch,
      iconType,
      iconComponent: resolveIconComponent(app?.icon || app?.iconName || 'LayoutGrid')
    };
  }

  let apps = $state([]);
  let startButtonEl = $state(null);
  let loadedBuiltinComponents = $state({});
  let builtinComponentErrors = $state({});
  
  async function loadApps() {
    try {
      const data = await apiFetch('/api/system/apps');
      if (!Array.isArray(data)) {
        console.error('Invalid apps data received:', data);
        return;
      }

      apps = data.map((app) => normalizeDesktopApp(app));
    } catch (err) {
      console.error('Failed to load apps:', err);
    }
  }

  let time = $state('');
  let isNotificationCenterOpen = $state(false);

  function updateTime() {
    const now = new Date();
    time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  onMount(async () => {
    // Initialize OS State from backend inventory
    await Promise.all([
      agentStore.init(),
      systemSettings.init(),
      taskbarSettings.init(),
      contextMenuSettings.init(),
      windowDefaultsSettings.init(),
      initDesktops(),
      initWindows(),
      widgets.init(),
      widgetLibrary.init(),
      initShortcuts(),
      initStartMenuState()
    ]);

    updateTime();
    loadApps();
    const disposeWebOSBridge = installWebOSBridge({ openAppById });
    const timer = setInterval(updateTime, 1000);
    return () => {
      clearInterval(timer);
      disposeWebOSBridge();
    };
  });

  function handleKeydown(e) {
    // ESC: close active window
    if (e.key === 'Escape') {
      if ($startMenuState.isOpen) {
        closeStartMenu();
        return;
      }
      if (isNotificationCenterOpen) {
        isNotificationCenterOpen = false;
        return;
      }
      if ($activeWindowId) {
        closeWindow($activeWindowId);
      }
    }
    // Delete: close active window
    if (e.key === 'Delete' && $activeWindowId) {
      closeWindow($activeWindowId);
    }
    // Ctrl + Space: Spotlight
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      openSpotlight();
    }
  }

  // Filter windows by current desktop
  const visibleWindows = $derived($windows.filter(w => w.desktopId === $currentDesktopId));

  $effect(() => {
    // Apply initial settings to document root
    if (typeof document !== 'undefined') {
      const s = $systemSettings;
      document.documentElement.style.setProperty('--glass-blur', `${s.blurIntensity}px`);
      document.documentElement.style.setProperty('--glass-opacity', s.transparency);
      document.documentElement.style.setProperty('--accent-blue', s.accentColor);
    }
  });

  function openShortcut(shortcut) {
    if ($layoutEditMode) return;
    const launch = buildShortcutLaunch(shortcut);
    const iconMapByKey = { Folder, Image, Video, File };
    const icon = iconMapByKey[launch.iconKey] || File;
    openWindow({ ...launch.app, icon }, launch.data);
  }

  function handleShortcutContext(e, shortcutId) {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Remove Shortcut', icon: Trash2, action: () => removeShortcut(shortcutId), danger: true }
    ]);
  }

  function getBgStyle(fit) {
    switch (fit) {
      case 'contain': return 'background-size: contain; background-repeat: no-repeat; background-position: center;';
      case 'stretch': return 'background-size: 100% 100%; background-repeat: no-repeat; background-position: center;';
      case 'center': return 'background-size: auto; background-repeat: no-repeat; background-position: center;';
      case 'tile': return 'background-size: auto; background-repeat: repeat; background-position: top left;';
      case 'cover':
      default: return 'background-size: cover; background-repeat: no-repeat; background-position: center;';
    }
  }

  function getVideoObjectFit(fit) {
    switch (fit) {
      case 'contain': return 'contain';
      case 'stretch': return 'fill';
      case 'center': return 'none';
      case 'tile': return 'none';
      case 'cover':
      default: return 'cover';
    }
  }

  function handleOpenStartMenuApp(app) {
    registerRecentApp(app?.id);
    openWindow(app);
  }

  function openDesktopApp(app) {
    registerRecentApp(app?.id);
    openWindow(app);
  }

  async function openAppById(appId, data = null) {
    const normalizedId = String(appId || '').trim();
    if (!normalizedId) {
      const err = new Error('App id is required.');
      err.code = 'WEBOS_BRIDGE_APP_ID_REQUIRED';
      throw err;
    }

    let target = apps.find((item) => item.id === normalizedId);
    if (!target) {
      await loadApps();
      target = apps.find((item) => item.id === normalizedId);
    }
    if (!target) {
      const err = new Error(`App "${normalizedId}" not found.`);
      err.code = 'WEBOS_BRIDGE_APP_NOT_FOUND';
      throw err;
    }

    openWindow(target, data);
    registerRecentApp(normalizedId);
    return { opened: true, appId: normalizedId };
  }

  function getLoadedBuiltinComponent(componentKey) {
    return loadedBuiltinComponents[String(componentKey || '').trim()] || null;
  }

  function getBuiltinComponentError(componentKey) {
    return builtinComponentErrors[String(componentKey || '').trim()] || '';
  }

  async function ensureBuiltinComponent(componentKey) {
    const key = String(componentKey || '').trim();
    if (!key || loadedBuiltinComponents[key] || builtinComponentErrors[key]) return;

    try {
      const component = await loadBuiltinComponent(key);
      if (!component) return;
      loadedBuiltinComponents = {
        ...loadedBuiltinComponents,
        [key]: component
      };
    } catch (err) {
      builtinComponentErrors = {
        ...builtinComponentErrors,
        [key]: err?.message || 'Failed to load app component.'
      };
    }
  }

  $effect(() => {
    for (const win of visibleWindows) {
      const resolved = resolveWindowLaunch(win);
      if (resolved.hasBuiltinComponent) {
        ensureBuiltinComponent(resolved.componentKey);
      }
    }
  });

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="desktop">
  {#if $systemSettings.wallpaperType === 'video'}
    <video class="wallpaper" style="object-fit: {getVideoObjectFit($systemSettings.wallpaperFit)};" src="{$systemSettings.wallpaper}" autoplay loop muted playsinline disablePictureInPicture></video>
  {:else if $systemSettings.wallpaperType === 'image'}
    <div class="wallpaper" style="background-image: url('{$systemSettings.wallpaper}'); {getBgStyle($systemSettings.wallpaperFit)}"></div>
  {:else}
    <div class="wallpaper" style="background: {$systemSettings.wallpaper}"></div>
  {/if}

  <!-- Widget Layer -->
  <div class="widget-layer">
    {#each $widgets as widget (widget.id)}
      <DashboardWidget {widget} />
    {/each}
  </div>

  <div
    class="app-grid {$layoutEditMode ? 'layout-edit-mode' : ''}"
    role="button"
    tabindex="-1"
    onclick={() => { closeContextMenu(); closeStartMenu(); }}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        closeContextMenu();
        closeStartMenu();
      }
    }}
  >
    {#if $layoutEditMode}
      <div class="layout-edit-banner">Layout Edit Mode: app launch is temporarily disabled.</div>
    {/if}
    {#each apps as app}
      <button class="app-icon" ondblclick={() => !$layoutEditMode && openDesktopApp(app)}>
        <div class="icon-box glass-effect">
          <span class="app-model-badge" title={`Model: ${app.appModel}`}>{app.appModelBadge}</span>
          {#if app.iconType === 'image' && app.iconUrl}
            <img class="app-icon-image" src={app.iconUrl} alt={app.title} loading="lazy" />
          {:else}
            {@const AppIcon = app.iconComponent}
            <AppIcon size={32} />
          {/if}
        </div>
        <span>{app.title}</span>
      </button>
    {/each}

    {#each $shortcuts as shortcut (shortcut.id)}
      <button 
        class="app-icon shortcut" 
        ondblclick={() => !$layoutEditMode && openShortcut(shortcut)}
        oncontextmenu={(e) => handleShortcutContext(e, shortcut.id)}
      >
        <div class="icon-box glass-effect {shortcut.isDirectory ? 'dir' : 'file'}">
          {#if shortcut.isDirectory}
            <Folder size={32} />
          {:else if ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(shortcut.ext)}
            <Image size={32} />
          {:else if ['mp4', 'webm', 'mov'].includes(shortcut.ext)}
            <Video size={32} />
          {:else}
            <File size={32} />
          {/if}
          <div class="shortcut-badge"><ExternalLink size={10} /></div>
        </div>
        <span>{shortcut.name}</span>
      </button>
    {/each}
  </div>

  {#each visibleWindows as win (win.id)}
    <Window window={win} active={$activeWindowId === win.id}>
      {@const resolvedLaunch = resolveWindowLaunch(win)}
      {@const LaunchComponent = getLoadedBuiltinComponent(resolvedLaunch.componentKey)}
      {#if LaunchComponent}
        <LaunchComponent data={win.data} />
      {:else if resolvedLaunch.hasBuiltinComponent}
        <div class="app-loading-state">
          {#if getBuiltinComponentError(resolvedLaunch.componentKey)}
            <h2>{win.title}</h2>
            <p>{getBuiltinComponentError(resolvedLaunch.componentKey)}</p>
          {:else}
            <p>Loading {win.title}...</p>
          {/if}
        </div>
      {:else if resolvedLaunch.launch.mode === 'sandbox' || win.runtime === 'sandbox'}
        <SandboxAppFrame app={win} />
      {:else}
        <div style="padding: 20px; color: var(--text-dim);">
          <h2>{win.title}</h2>
          <p>This application is currently under development.</p>
        </div>
      {/if}
    </Window>
  {/each}

  {#if $contextMenu.visible}
    <ContextMenu 
      x={$contextMenu.x} 
      y={$contextMenu.y} 
      items={$contextMenu.items} 
      close={closeContextMenu} 
    />
  {/if}

  {#if $snapGhost.visible}
    <div 
      class="snap-ghost" 
      style="left: {$snapGhost.x}px; top: {$snapGhost.y}px; width: {$snapGhost.width}px; height: {$snapGhost.height}px;"
    ></div>
  {/if}

  <Spotlight />
  <StartMenu apps={apps} onOpenApp={handleOpenStartMenuApp} {startButtonEl} />
  <NotificationCenter bind:isOpen={isNotificationCenterOpen} />
  
  <Agent />

  <Taskbar 
    {time} 
    isNotificationCenterOpen={isNotificationCenterOpen}
    isStartMenuOpen={$startMenuState.isOpen}
    onStartButtonReady={(el) => (startButtonEl = el)}
    onToggleStartMenu={toggleStartMenu}
    onToggleNotifications={() => isNotificationCenterOpen = !isNotificationCenterOpen}
    onOpenSettings={() => openWindow({ id: 'control-panel', title: 'Settings', icon: Settings, singleton: true })}
  />
</div>

<style>
  .desktop { width: 100vw; height: 100vh; position: relative; background: #000; overflow: hidden; }
  .wallpaper { position: absolute; inset: 0; opacity: 0.8; width: 100%; height: 100%; object-fit: cover; z-index: 0; pointer-events: none; }
  .wallpaper[style*="linear-gradient"] { opacity: 0.8; }
  
  .widget-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
  }
  .app-grid { 
    position: absolute; 
    top: 30px; 
    left: 20px; 
    display: grid; 
    grid-template-rows: repeat(auto-fill, 96px); 
    grid-auto-flow: column;
    gap: 8px;
    height: calc(100% - 100px);
    pointer-events: none;
  }
  .layout-edit-banner {
    grid-column: 1 / -1;
    border: 1px solid rgba(88, 166, 255, 0.4);
    background: rgba(88, 166, 255, 0.12);
    color: #c5ddff;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .app-grid.layout-edit-mode .app-icon {
    animation: wobble 0.35s ease-in-out 2;
  }
  @keyframes wobble {
    0% { transform: rotate(0deg); }
    25% { transform: rotate(-1deg); }
    75% { transform: rotate(1deg); }
    100% { transform: rotate(0deg); }
  }
  .app-icon { 
    background: transparent; 
    border: none; 
    color: white; 
    display: flex; 
    flex-direction: column; 
    align-items: center; 
    gap: 6px; 
    width: 90px; 
    height: 90px;
    cursor: pointer; 
    pointer-events: auto;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .icon-box { 
    width: 56px; 
    height: 56px; 
    position: relative;
    display: flex; 
    align-items: center; 
    justify-content: center; 
    border-radius: 14px; 
    transition: all 0.2s; 
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  .app-icon-image {
    width: 32px;
    height: 32px;
    object-fit: contain;
    border-radius: 8px;
  }
  .app-model-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 14px;
    padding: 0 4px;
    border-radius: 999px;
    border: 1px solid rgba(197, 221, 255, 0.35);
    background: rgba(8, 24, 45, 0.82);
    color: #c5ddff;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    line-height: 1;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  .app-icon:hover .icon-box { 
    transform: scale(1.08) translateY(-2px); 
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(88, 166, 255, 0.2);
  }
  .icon-box.dir { color: #58a6ff; }
  .icon-box.file { color: #f0f6fc; }
  
  .shortcut-badge { 
    position: absolute; 
    bottom: -4px; right: -4px; 
    background: var(--accent-blue); 
    color: white; 
    border-radius: 4px; 
    width: 16px; height: 16px; 
    display: flex; align-items: center; justify-content: center; 
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
  }

  .app-icon span { 
    font-size: 13px; color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.8); text-align: center;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .snap-ghost {
    position: absolute;
    background: rgba(var(--accent-blue-rgb, 0, 120, 215), 0.2);
    border: 2px solid var(--accent-blue);
    border-radius: 8px;
    z-index: 9998;
    pointer-events: none;
    transition: all 0.15s ease-out;
    box-shadow: 0 0 20px rgba(0, 120, 215, 0.3);
  }
  .app-loading-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 20px;
    color: var(--text-dim);
    background: rgba(2, 6, 23, 0.35);
  }
  .app-loading-state h2 {
    margin: 0;
    color: var(--text-main);
    font-size: 16px;
  }
  .app-loading-state p {
    margin: 0;
    font-size: 13px;
  }
</style>
