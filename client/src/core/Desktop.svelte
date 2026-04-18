<script>
  import { onMount } from 'svelte';
  import { Shield, Monitor, Files, Terminal as TerminalIcon, Settings, Container, LayoutGrid } from 'lucide-svelte';
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
  import Spotlight from './Spotlight.svelte';
  import { openSpotlight, toggleSpotlight } from './stores/spotlightStore.js';

  const components = {
    files: FileExplorer,
    terminal: TerminalApp,
    monitor: ResourceMonitor,
    editor: CodeEditor,
    docker: DockerManager,
    settings: SettingsApp,
    player: MediaPlayer
  };

  const apps = [
    { id: 'files', title: 'File Station', icon: Files },
    { id: 'terminal', title: 'Terminal', icon: TerminalIcon },
    { id: 'monitor', title: 'Resource Monitor', icon: Monitor },
    { id: 'docker', title: 'Docker', icon: Container },
    { id: 'settings', title: 'Settings', icon: Settings },
    { id: 'player', title: 'Media', icon: Video }
  ];

  let time = $state('');
  function updateTime() {
    const now = new Date();
    time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => {
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  });

  function handleKeydown(e) {
    // ESC: close active window
    if (e.key === 'Escape' && $activeWindowId) {
      closeWindow($activeWindowId);
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
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="desktop">
  <div class="wallpaper"></div>

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
      {#if components[win.id]}
        <svelte:component this={components[win.id]} data={win.data} />
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

  <div class="taskbar glass-effect svelte-fo09mr">
    <div class="start-menu icon-box">
      <Shield size={20} />
    </div>

    <div class="desktop-switcher">
      {#each $desktops as desktop}
        <button 
          class="desktop-btn {$currentDesktopId === desktop.id ? 'active' : ''}"
          onclick={() => switchDesktop(desktop.id)}
          title={desktop.name}
        >
          {desktop.id}
        </button>
      {/each}
    </div>

    <div class="active-apps">
      {#each visibleWindows as win}
        <button
          class="task-item {$activeWindowId === win.id && !win.minimized ? 'active' : ''}"
          onclick={() => {
            if ($activeWindowId === win.id && !win.minimized) {
              toggleMinimize(win.id);
            } else {
              focusWindow(win.id);
            }
          }}
        >
          <svelte:component this={win.icon} size={18} />
        </button>
      {/each}
    </div>

    <div class="system-tray">
      <span class="time">{time}</span>
    </div>
  </div>
</div>

<style>
  .desktop { width: 100vw; height: 100vh; position: relative; background: #000; overflow: hidden; }
  .wallpaper { position: absolute; inset: 0; background: linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%); opacity: 0.8; }
  .app-grid { position: absolute; top: 20px; left: 20px; display: grid; grid-template-rows: repeat(auto-fill, 100px); gap: 20px; }
  .app-icon { background: transparent; border: none; color: white; display: flex; flex-direction: column; align-items: center; gap: 8px; width: 80px; cursor: pointer; }
  .icon-box { width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; border-radius: 12px; transition: transform 0.2s; }
  .app-icon:hover .icon-box { transform: scale(1.05); background: rgba(255,255,255,0.1); }
  .app-icon span { font-size: 12px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
  
  .taskbar { position: absolute; bottom: 0; left: 0; width: 100%; height: 48px; display: flex; align-items: center; padding: 0 10px; border-top: 1px solid var(--glass-border); z-index: 9999; gap: 10px; }
  
  .desktop-switcher { display: flex; gap: 4px; padding: 0 10px; border-right: 1px solid rgba(255,255,255,0.1); }
  .desktop-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-dim); width: 24px; height: 24px; border-radius: 4px; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
  .desktop-btn:hover { background: rgba(255,255,255,0.15); color: white; }
  .desktop-btn.active { background: var(--accent-blue); color: white; border-color: var(--accent-blue); box-shadow: 0 0 10px rgba(0, 120, 215, 0.5); }

  .active-apps { flex: 1; display: flex; justify-content: center; gap: 8px; }
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
