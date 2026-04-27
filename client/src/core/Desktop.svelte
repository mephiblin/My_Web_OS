<script>
  import { onMount } from 'svelte';
  import {
    AppWindow,
    Boxes,
    Braces,
    CalendarDays,
    Clapperboard,
    Cuboid,
    DatabaseZap,
    File,
    Folder,
    FolderOpen,
    Gauge,
    Headphones,
    Image as ShortcutImageIcon,
    ImageUp,
    ListChecks,
    MonitorCog,
    PackageOpen,
    PanelsTopLeft,
    ScrollText,
    SearchCheck,
    SendHorizontal,
    SlidersHorizontal,
    SquareTerminal,
    Trash2,
    Video as ShortcutVideoIcon,
    ExternalLink
  } from 'lucide-svelte';
  import { windows, activeWindowId, openWindow, closeWindow, focusWindow, initWindows } from './stores/windowStore.js';
  import { contextMenu, openContextMenu, closeContextMenu, contextMenuSettings } from './stores/contextMenuStore.js';
  import { currentDesktopId, initDesktops, layoutEditMode } from './stores/desktopStore.js';
  import { snapGhost } from './stores/snapStore.js';
  import { widgets } from './stores/widgetStore.js';
  import { shortcuts, initShortcuts, addShortcut, removeShortcut, setShortcutGridPosition } from './stores/shortcutStore.js';
  import Window from './Window.svelte';
  import SandboxAppFrame from './components/SandboxAppFrame.svelte';
  import DashboardWidget from './components/DashboardWidget.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import Agent from './components/Agent.svelte';
  import { agentStore } from './stores/agentStore.js';
  import Spotlight from './Spotlight.svelte';
  import { openSpotlight } from './stores/spotlightStore.js';
  import Taskbar from './components/Taskbar.svelte';
  import StartMenu from './components/StartMenu.svelte';
  import NotificationCenter from './components/NotificationCenter.svelte';
  import { closeStartMenu, startMenuState, toggleStartMenu, initStartMenuState, registerRecentApp } from './stores/startMenuStore.js';
  import { taskbarSettings } from './stores/taskbarStore.js';
  import { windowDefaultsSettings } from './stores/windowDefaultsStore.js';
  import { widgetLibrary } from './stores/widgetLibraryStore.js';
  import { systemSettings } from './stores/systemStore.js';
  import { appRegistryState, loadAppRegistry } from './stores/appRegistryStore.js';
  import { buildShortcutLaunch } from './shortcutLaunch.js';
  import { installWebOSBridge } from '../utils/webosBridge.js';
  import { loadBuiltinComponent, resolveWindowLaunch } from './appLaunchRegistry.js';
  import { normalizeAppModel, deriveOwnerTier, normalizeLaunchContract, normalizeDataBoundary } from './appOwnershipContract.js';
  import { i18n, localizeAppTitle, translateWith } from './i18n/index.js';

  const iconMap = {
    Box: Cuboid,
    CalendarIcon: CalendarDays,
    Code2: Braces,
    Container: Boxes,
    FileText: ScrollText,
    Files: FolderOpen,
    Image: ImageUp,
    LayoutGrid: PackageOpen,
    Monitor: Gauge,
    Music2: Headphones,
    Search: SearchCheck,
    Send: SendHorizontal,
    Settings: SlidersHorizontal,
    Shield: ListChecks,
    TerminalIcon: SquareTerminal,
    Video: Clapperboard
  };

  const iconMapByAppId = {
    'control-panel': MonitorCog,
    calendar: CalendarDays,
    'doc-viewer': ScrollText,
    'document-station': ScrollText,
    'download-station': DatabaseZap,
    docker: Boxes,
    editor: Braces,
    files: FolderOpen,
    logs: ListChecks,
    monitor: Gauge,
    'model-viewer': Cuboid,
    'music-station': Headphones,
    'nexus-term': PanelsTopLeft,
    'package-center': PackageOpen,
    photo: ImageUp,
    'photo-station': ImageUp,
    player: Clapperboard,
    settings: SlidersHorizontal,
    terminal: SquareTerminal,
    transfer: SendHorizontal,
    'video-station': Clapperboard,
    'widget-store': PanelsTopLeft
  };

  function clampNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
  }

  function getDesktopIconScale(value) {
    return clampNumber(value, 1, 0.8, 1.25);
  }

  function buildDesktopGridStyle(scaleValue) {
    const scale = getDesktopIconScale(scaleValue);
    return [
      `--desktop-icon-cell-w: ${Math.round(78 * scale)}px`,
      `--desktop-icon-cell-h: ${Math.round(84 * scale)}px`,
      `--desktop-icon-box: ${Math.round(48 * scale)}px`,
      `--desktop-icon-glyph: ${Math.round(27 * scale)}px`,
      `--desktop-icon-label-w: ${Math.round(82 * scale)}px`,
      `--desktop-icon-label-size: ${Math.max(11, Math.round(12 * scale))}px`,
      `--desktop-icon-gap: ${Math.max(3, Math.round(5 * scale))}px`
    ].join('; ');
  }

  const desktopGridStyle = $derived(buildDesktopGridStyle($systemSettings.desktopIconScale));

  function resolveIconComponent(app) {
    const appId = String(app?.id || '').trim();
    if (iconMapByAppId[appId]) return iconMapByAppId[appId];
    const iconName = app?.icon || app?.iconName || 'AppWindow';
    return iconMap[iconName] || AppWindow;
  }

  function getAppModelBadgeLabel(appModel) {
    if (appModel === 'system') return 'SYS';
    if (appModel === 'package') return 'PKG';
    return 'APP';
  }

  function normalizeDesktopApp(app, i18nContext) {
    const iconType = app?.iconType === 'image' && app?.iconUrl ? 'image' : 'lucide';
    const appModel = normalizeAppModel(app);
    const ownerTier = deriveOwnerTier(appModel);
    const launch = normalizeLaunchContract(app);
    const localizedTitle = localizeAppTitle(app, i18nContext);
    return {
      ...app,
      title: localizedTitle,
      appModel,
      ownerTier,
      dataBoundary: normalizeDataBoundary(app, launch, ownerTier),
      appModelBadge: getAppModelBadgeLabel(appModel),
      launch,
      iconType,
      iconComponent: resolveIconComponent(app)
    };
  }

  const apps = $derived.by(() => {
    const registryApps = Array.isArray($appRegistryState.apps) ? $appRegistryState.apps : [];
    return registryApps.map((app) => normalizeDesktopApp(app, $i18n));
  });
  const appById = $derived.by(() => new Map(apps.map((app) => [String(app.id), app])));
  let startButtonEl = $state(null);
  let loadedBuiltinComponents = $state({});
  let builtinComponentErrors = $state({});
  let draggingShortcutId = $state('');
  let appGridEl = $state(null);
  const DEFAULT_DESKTOP_ROWS = 8;

  async function retryLoadAppRegistry() {
    try {
      await loadAppRegistry({ force: true });
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
    loadAppRegistry().catch((err) => console.error('Failed to load apps:', err));
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
  const activeVisibleWindow = $derived(
    visibleWindows.find((win) => win.id === $activeWindowId && !win.minimized) || null
  );
  const hidesMobileTaskbar = $derived(
    activeVisibleWindow?.maximized === true
    && String(activeVisibleWindow?.appId || activeVisibleWindow?.id || '') === 'nexus-term'
  );
  const visibleShortcuts = $derived($shortcuts.filter((item) => Number(item?.desktopId || 1) === Number($currentDesktopId)));

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
    if (shortcut?.kind === 'app' && shortcut?.appId) {
      openAppById(shortcut.appId);
      return;
    }
    const launch = buildShortcutLaunch(shortcut);
    const iconMapByKey = { Folder, Image: ShortcutImageIcon, Video: ShortcutVideoIcon, File };
    const icon = iconMapByKey[launch.iconKey] || File;
    openWindow({ ...launch.app, icon }, launch.data);
  }

  function handleShortcutContext(e, shortcutId) {
    e.preventDefault();
    if (!$layoutEditMode) {
      closeContextMenu();
      return;
    }
    openContextMenu(e.clientX, e.clientY, [
      {
        label: translateWith($i18n, 'desktop.removeShortcut', {}, 'Remove Shortcut'),
        icon: Trash2,
        action: () => removeShortcut(shortcutId),
        danger: true
      }
    ]);
  }

  function handleStartMenuCreateShortcut(app) {
    if (!app) return;
    addShortcut({
      shortcutType: 'app',
      appId: app.id,
      name: app.title,
      iconType: app.iconType,
      iconUrl: app.iconUrl,
      icon: app.icon,
      desktopId: $currentDesktopId
    });
  }

  function handleShortcutDragStart(event, shortcutId) {
    if (!$layoutEditMode) return;
    draggingShortcutId = String(shortcutId || '');
    event.dataTransfer?.setData('text/plain', draggingShortcutId);
    event.dataTransfer?.setData('application/x-webos-shortcut-id', draggingShortcutId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  function handleShortcutDragOver(event) {
    if (!$layoutEditMode) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function getShortcutGridPlacement(shortcut, index = 0) {
    const gridX = Number.isFinite(Number(shortcut?.gridX))
      ? Math.max(0, Math.floor(Number(shortcut.gridX)))
      : Math.max(0, Math.floor(index / DEFAULT_DESKTOP_ROWS));
    const gridY = Number.isFinite(Number(shortcut?.gridY))
      ? Math.max(0, Math.floor(Number(shortcut.gridY)))
      : Math.max(0, index % DEFAULT_DESKTOP_ROWS);
    return { gridX, gridY };
  }

  function getShortcutPositionStyle(shortcut, index = 0) {
    const placement = getShortcutGridPlacement(shortcut, index);
    return `--grid-x:${placement.gridX}; --grid-y:${placement.gridY};`;
  }

  function resolveGridSnapFromEvent(event) {
    const gridEl = appGridEl;
    if (!gridEl) return { gridX: 0, gridY: 0 };
    const rect = gridEl.getBoundingClientRect();
    const style = window.getComputedStyle(gridEl);
    const cellW = Number.parseFloat(style.getPropertyValue('--desktop-icon-cell-w')) || 78;
    const cellH = Number.parseFloat(style.getPropertyValue('--desktop-icon-cell-h')) || 84;
    const localX = Math.max(0, event.clientX - rect.left);
    const localY = Math.max(0, event.clientY - rect.top);
    return {
      gridX: Math.max(0, Math.floor(localX / cellW)),
      gridY: Math.max(0, Math.floor(localY / cellH))
    };
  }

  function placeShortcutByDropEvent(event, shortcutId) {
    const shortcutKey = String(shortcutId || '').trim();
    if (!shortcutKey) return;
    const snapped = resolveGridSnapFromEvent(event);
    setShortcutGridPosition(shortcutKey, snapped.gridX, snapped.gridY);
  }

  function handleShortcutDropOnShortcut(event, targetShortcut, targetIndex) {
    if (!$layoutEditMode) return;
    event.preventDefault();
    const payloadId = event.dataTransfer?.getData('application/x-webos-shortcut-id')
      || event.dataTransfer?.getData('text/plain')
      || draggingShortcutId;
    if (!payloadId) return;
    const targetPlacement = getShortcutGridPlacement(targetShortcut, targetIndex);
    setShortcutGridPosition(payloadId, targetPlacement.gridX, targetPlacement.gridY);
    draggingShortcutId = '';
  }

  function handleShortcutDropOnGrid(event) {
    if (!$layoutEditMode) return;
    event.preventDefault();
    const payloadId = event.dataTransfer?.getData('application/x-webos-shortcut-id')
      || event.dataTransfer?.getData('text/plain')
      || draggingShortcutId;
    placeShortcutByDropEvent(event, payloadId);
    draggingShortcutId = '';
  }

  function resolveShortcutVisual(shortcut) {
    if (shortcut?.kind === 'app' && shortcut?.appId) {
      const linkedApp = appById.get(String(shortcut.appId));
      if (linkedApp) {
        return {
          kind: 'app',
          iconType: linkedApp.iconType,
          iconUrl: linkedApp.iconUrl,
          iconComponent: linkedApp.iconComponent
        };
      }
      return {
        kind: 'app',
        iconType: shortcut.iconType === 'image' && shortcut.iconUrl ? 'image' : 'lucide',
        iconUrl: shortcut.iconUrl || '',
        iconComponent: iconMap[shortcut.iconName] || AppWindow
      };
    }

    if (shortcut?.isDirectory) {
      return { kind: 'dir', iconType: 'lucide', iconComponent: Folder };
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(shortcut?.ext)) {
      return { kind: 'file', iconType: 'lucide', iconComponent: ShortcutImageIcon };
    }
    if (['mp4', 'webm', 'mov'].includes(shortcut?.ext)) {
      return { kind: 'file', iconType: 'lucide', iconComponent: ShortcutVideoIcon };
    }
    return { kind: 'file', iconType: 'lucide', iconComponent: File };
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

  async function openAppById(appId, data = null) {
    const normalizedId = String(appId || '').trim();
    if (!normalizedId) {
      const err = new Error('App id is required.');
      err.code = 'WEBOS_BRIDGE_APP_ID_REQUIRED';
      throw err;
    }

    let target = apps.find((item) => item.id === normalizedId);
    if (!target) {
      const refreshedApps = await loadAppRegistry({ force: true });
      target = refreshedApps
        .map((item) => normalizeDesktopApp(item, $i18n))
        .find((item) => item.id === normalizedId);
    }
    if (!target) {
      const err = new Error(`App "${normalizedId}" not found.`);
      err.code = $appRegistryState.error?.code || 'WEBOS_BRIDGE_APP_NOT_FOUND';
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
        [key]: err?.message || translateWith($i18n, 'desktop.failedLoadComponent', {}, 'Failed to load app component.')
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

<div class:nexus-term-mobile-fullscreen={hidesMobileTaskbar} class="desktop">
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
    style={desktopGridStyle}
    bind:this={appGridEl}
    role="button"
    tabindex="-1"
    onclick={() => { closeContextMenu(); closeStartMenu(); }}
    ondragover={handleShortcutDragOver}
    ondrop={handleShortcutDropOnGrid}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        closeContextMenu();
        closeStartMenu();
      }
    }}
  >
    {#if $appRegistryState.error}
      <div class="desktop-error-panel glass-effect" role="alert" aria-live="polite">
        <div>
          <strong>{translateWith($i18n, 'desktop.appRegistryLoadFailed', {}, 'App registry unavailable')}</strong>
          <span>{$appRegistryState.error.message}</span>
        </div>
        <button onclick={retryLoadAppRegistry} disabled={$appRegistryState.loading}>
          {$appRegistryState.loading ? translateWith($i18n, 'desktop.retrying', {}, 'Retrying...') : translateWith($i18n, 'desktop.retry', {}, 'Retry')}
        </button>
      </div>
    {/if}

    {#each visibleShortcuts as shortcut, shortcutIndex (shortcut.id)}
      <button
        class="app-icon shortcut"
        style={getShortcutPositionStyle(shortcut, shortcutIndex)}
        ondblclick={() => !$layoutEditMode && openShortcut(shortcut)}
        oncontextmenu={(e) => handleShortcutContext(e, shortcut.id)}
        draggable={$layoutEditMode}
        ondragstart={(event) => handleShortcutDragStart(event, shortcut.id)}
        ondragend={() => (draggingShortcutId = '')}
        ondragover={handleShortcutDragOver}
        ondrop={(event) => handleShortcutDropOnShortcut(event, shortcut, shortcutIndex)}
      >
        <div class="icon-box glass-effect {resolveShortcutVisual(shortcut).kind === 'dir' ? 'dir' : resolveShortcutVisual(shortcut).kind === 'app' ? 'app' : 'file'}">
          {#if resolveShortcutVisual(shortcut).iconType === 'image' && resolveShortcutVisual(shortcut).iconUrl}
            <img class="app-icon-image" src={resolveShortcutVisual(shortcut).iconUrl} alt={shortcut.name} loading="lazy" />
          {:else}
            {@const ShortcutIcon = resolveShortcutVisual(shortcut).iconComponent}
            <ShortcutIcon size={28} />
          {/if}
          <div class="shortcut-badge"><ExternalLink size={10} /></div>
          {#if $layoutEditMode}
            <span
              class="shortcut-remove-btn"
              role="button"
              tabindex="0"
              onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                removeShortcut(shortcut.id);
              }}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  removeShortcut(shortcut.id);
                }
              }}
              title={translateWith($i18n, 'desktop.removeShortcut', {}, 'Remove Shortcut')}
            >
              <Trash2 size={11} />
            </span>
          {/if}
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
            <p>{translateWith($i18n, 'desktop.loadingApp', { title: win.title }, `Loading ${win.title}...`)}</p>
          {/if}
        </div>
      {:else if resolvedLaunch.launch.mode === 'sandbox' || win.runtime === 'sandbox'}
        <SandboxAppFrame app={win} />
      {:else}
        <div style="padding: 20px; color: var(--text-dim);">
          <h2>{win.title}</h2>
          <p>{translateWith($i18n, 'desktop.appUnderDevelopment', {}, 'This application is currently under development.')}</p>
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

  <Spotlight apps={apps} onOpenAppById={openAppById} />
  <StartMenu
    apps={apps}
    onOpenApp={handleOpenStartMenuApp}
    onCreateDesktopShortcut={handleStartMenuCreateShortcut}
    {startButtonEl}
  />
  <NotificationCenter bind:isOpen={isNotificationCenterOpen} />

  <Agent />

  <Taskbar
    {time}
    isNotificationCenterOpen={isNotificationCenterOpen}
    isStartMenuOpen={$startMenuState.isOpen}
    onStartButtonReady={(el) => (startButtonEl = el)}
    onToggleStartMenu={toggleStartMenu}
    onToggleNotifications={() => isNotificationCenterOpen = !isNotificationCenterOpen}
  />
</div>

<style>
  .desktop { width: 100vw; height: 100vh; position: relative; background: #000; overflow: hidden; }
  @supports (height: 100dvh) {
    .desktop { width: 100dvw; height: 100dvh; }
  }
  @media (max-width: 760px) {
    .desktop.nexus-term-mobile-fullscreen :global(.taskbar) {
      display: none;
    }
  }
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
    top: 24px;
    left: 18px;
    width: calc(100% - 36px);
    height: calc(100% - 100px);
    pointer-events: auto;
  }
  .desktop-error-panel {
    position: absolute;
    top: 0;
    left: 0;
    width: min(420px, calc(100vw - 36px));
    border: 1px solid rgba(248, 113, 113, 0.34);
    border-radius: 10px;
    background: rgba(69, 10, 10, 0.78);
    color: #fecaca;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    z-index: 12;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
  }
  .desktop-error-panel div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .desktop-error-panel strong {
    color: #fff1f2;
    font-size: 13px;
  }
  .desktop-error-panel span {
    font-size: 12px;
    line-height: 1.35;
  }
  .desktop-error-panel button {
    border: 1px solid rgba(254, 202, 202, 0.45);
    border-radius: 8px;
    background: rgba(127, 29, 29, 0.35);
    color: #fff1f2;
    padding: 7px 10px;
    cursor: pointer;
    font-size: 12px;
    flex-shrink: 0;
  }
  .desktop-error-panel button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .app-grid.layout-edit-mode .app-icon {
    animation: icon-jiggle 0.72s ease-in-out infinite;
    transform-origin: 50% 72%;
  }
  .app-grid.layout-edit-mode .app-icon:nth-child(2n) {
    animation-delay: -0.18s;
    animation-duration: 0.66s;
  }
  .app-grid.layout-edit-mode .app-icon:nth-child(3n) {
    animation-delay: -0.32s;
    animation-duration: 0.78s;
  }
  @keyframes icon-jiggle {
    0%, 100% { transform: rotate(-1.3deg) translateY(0); }
    50% { transform: rotate(1.3deg) translateY(-1px); }
  }
  .app-icon {
    position: absolute;
    left: calc(var(--grid-x, 0) * var(--desktop-icon-cell-w, 78px));
    top: calc(var(--grid-y, 0) * var(--desktop-icon-cell-h, 84px));
    background: transparent;
    border: none;
    color: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: var(--desktop-icon-cell-w, 78px);
    height: var(--desktop-icon-cell-h, 84px);
    cursor: pointer;
    pointer-events: auto;
    transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .icon-box {
    width: var(--desktop-icon-box, 48px);
    height: var(--desktop-icon-box, 48px);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    transition: all 0.2s;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  .icon-box :global(svg) {
    width: var(--desktop-icon-glyph, 27px);
    height: var(--desktop-icon-glyph, 27px);
  }
  .app-icon-image {
    width: var(--desktop-icon-glyph, 27px);
    height: var(--desktop-icon-glyph, 27px);
    object-fit: contain;
    border-radius: 8px;
  }
  .app-icon:hover .icon-box {
    transform: scale(1.08) translateY(-2px);
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(88, 166, 255, 0.2);
  }
  .icon-box.dir { color: #58a6ff; }
  .icon-box.file { color: #f0f6fc; }
  .icon-box.app { color: #d5e8ff; }

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
  .shortcut-remove-btn {
    position: absolute;
    top: -6px;
    left: -6px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    border: 1px solid rgba(255, 170, 170, 0.6);
    background: rgba(90, 8, 8, 0.9);
    color: #ffd5d5;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    z-index: 2;
  }
  .shortcut-remove-btn:hover {
    background: rgba(125, 12, 12, 0.95);
  }

  .app-icon span {
    font-size: var(--desktop-icon-label-size, 12px); color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.8); text-align: center;
    max-width: var(--desktop-icon-label-w, 82px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .app-grid.layout-edit-mode .app-icon {
      animation: none;
    }
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
