<script>
  import { onMount } from 'svelte';
  import { Shield, Monitor, Files, Terminal as TerminalIcon, Settings, Container, LayoutGrid, Video, Image, Search, Send } from 'lucide-svelte';
  import { windows, activeWindowId, openWindow, closeWindow, focusWindow, toggleMinimize } from './stores/windowStore.js';
  import { contextMenu, closeContextMenu } from './stores/contextMenuStore.js';
  import { desktops, currentDesktopId, switchDesktop } from './stores/desktopStore.js';
  import { snapGhost } from './stores/snapStore.js';
  import Window from './Window.svelte';
  import ContextMenu from './components/ContextMenu.svelte';

  import FileExplorer from '../apps/file-explorer/FileExplorer.svelte';
  import TerminalApp from '../apps/terminal/Terminal.svelte';
  import ResourceMonitor from '../apps/resource-monitor/ResourceMonitor.svelte';
  import CodeEditor from '../apps/code-editor/CodeEditor.svelte';
  import DockerManager from '../apps/docker-manager/DockerManager.svelte';
  import SettingsApp from '../apps/settings/Settings.svelte';
  import MediaPlayer from '../apps/media-player/MediaPlayer.svelte';
  import DocumentViewer from '../apps/document-viewer/DocumentViewer.svelte';
  import ModelViewer from '../apps/model-viewer/ModelViewer.svelte';
  import Spotlight from './Spotlight.svelte';
  import { openSpotlight, toggleSpotlight } from './stores/spotlightStore.js';
  import Taskbar from './components/Taskbar.svelte';
  import NotificationCenter from './components/NotificationCenter.svelte';
  import ControlPanel from '../apps/control-panel/ControlPanel.svelte';
  import TransferUI from '../apps/transfer/TransferUI.svelte';
  import { systemSettings } from './stores/systemStore.js';

  const iconMap = {
    Shield, Monitor, Files, TerminalIcon, Settings, Container, LayoutGrid, Video, Image, Search, Send
  };

  const components = {
    files: FileExplorer,
    terminal: TerminalApp,
    monitor: ResourceMonitor,
    editor: CodeEditor,
    docker: DockerManager,
    settings: SettingsApp,
    'control-panel': ControlPanel,
    transfer: TransferUI,
    player: MediaPlayer,
    'doc-viewer': DocumentViewer,
    'model-viewer': ModelViewer
  };

  let apps = $state([]);
  
  async function loadApps() {
    try {
      const res = await fetch('/api/system/apps');
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error('Invalid apps data received:', data);
        return;
      }

      // Map icon strings to components
      apps = data.map(app => ({
        ...app,
        icon: iconMap[app.icon] || LayoutGrid
      }));
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

  onMount(() => {
    updateTime();
    loadApps();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  });

  function handleKeydown(e) {
    // ESC: close active window
    if (e.key === 'Escape') {
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
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="desktop">
  <div class="wallpaper" style="background: {$systemSettings.wallpaper}"></div>

  <div class="app-grid">
    {#each apps as app}
      <button class="app-icon" ondblclick={() => openWindow(app)}>
        <div class="icon-box glass-effect">
          <svelte:component this={app.icon} size={32} />
        </div>
        <span>{app.title}</span>
      </button>
    {/each}
  </div>

  {#each visibleWindows as win (win.id)}
    <Window window={win} active={$activeWindowId === win.id}>
      {#if components[win.appId]}
        <svelte:component this={components[win.appId]} data={win.data} />
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
  <NotificationCenter bind:isOpen={isNotificationCenterOpen} />

  <Taskbar 
    {time} 
    isNotificationCenterOpen={isNotificationCenterOpen}
    onToggleNotifications={() => isNotificationCenterOpen = !isNotificationCenterOpen}
    onOpenSettings={() => openWindow({ id: 'control-panel', title: 'Settings', icon: Settings })}
  />
</div>

<style>
  .desktop { width: 100vw; height: 100vh; position: relative; background: #000; overflow: hidden; }
  .wallpaper { position: absolute; inset: 0; background: linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%); opacity: 0.8; }
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
    display: flex; 
    align-items: center; 
    justify-content: center; 
    border-radius: 14px; 
    transition: all 0.2s; 
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  .app-icon:hover .icon-box { 
    transform: scale(1.08) translateY(-2px); 
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4), 0 0 15px rgba(88, 166, 255, 0.2);
  }
  .app-icon span { 
    font-size: 11px; 
    font-weight: 500;
    text-align: center;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .taskbar { position: absolute; bottom: 0; left: 0; width: 100%; height: 48px; display: flex; align-items: center; padding: 0 10px; border-top: 1px solid var(--glass-border); z-index: 9999; gap: 10px; }
  
  .desktop-switcher { display: flex; align-items: center; gap: 8px; padding: 0 10px; border-right: 1px solid rgba(255,255,255,0.1); }
  .desktop-num { font-size: 11px; font-weight: 600; color: white; opacity: 0.6; margin-right: 2px; }
  .desktop-btn { 
    position: relative;
    width: 6px; 
    height: 6px; 
    border-radius: 50%; 
    background: rgba(255, 255, 255, 0.2); 
    border: none; 
    cursor: pointer; 
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
    margin: 0 4px;
  }
  /* Increase hit area without changing visual size */
  .desktop-btn::after {
    content: '';
    position: absolute;
    inset: -6px; /* 1.5x - 2x hit area */
  }
  .desktop-btn:hover { 
    width: 12px; /* Stretch horizontally */
    border-radius: 10px;
    background: rgba(255,255,255,0.7); 
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.6);
  }
  .desktop-btn.active { 
    width: 22px; 
    height: 8px;
    border-radius: 10px; 
    background: white; 
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.5); 
  }
  .desktop-btn.active:hover {
    width: 26px;
    box-shadow: 0 0 15px rgba(255, 255, 255, 0.8);
  }

  .taskbar-search {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 4px 12px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 13px;
    cursor: pointer;
    width: 150px;
    transition: all 0.2s;
  }
  .taskbar-search:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    color: white;
  }

  .start-menu-btn { 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    width: 36px; 
    height: 36px; 
    border-radius: 8px; 
    cursor: pointer; 
    transition: background 0.2s; 
    color: white;
  }
  .start-menu-btn:hover { background: rgba(255,255,255,0.1); }

  .active-apps { flex: 1; display: flex; justify-content: flex-start; gap: 8px; padding-left: 10px; }
  .task-item { background: transparent; border: none; color: var(--text-dim); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; position: relative; }
  .task-item:hover { background: rgba(255,255,255,0.1); }
  .task-item.active { background: rgba(255,255,255,0.1); color: var(--accent-blue); }
  .task-item.active::after { content: ''; position: absolute; bottom: 4px; width: 4px; height: 4px; background: var(--accent-blue); border-radius: 50%; }
  .system-tray { width: 100px; text-align: right; font-size: 13px; color: var(--text-dim); }

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
</style>
