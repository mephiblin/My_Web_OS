<script>
  import { Shield, Search, Settings, Bell, LayoutGrid, Bot, AlertTriangle, XCircle, CheckCircle, Loader, Terminal, Ear, Play } from 'lucide-svelte';
  import { windows, activeWindowId, focusWindow, toggleMinimize } from '../stores/windowStore.js';
  import { desktops, currentDesktopId, switchDesktop, layoutEditMode, toggleLayoutEditMode } from '../stores/desktopStore.js';
  import { notifications } from '../stores/notificationStore.js';
  import { openSpotlight } from '../stores/spotlightStore.js';
  import { taskbarSettings } from '../stores/taskbarStore.js';
  import { agentStore } from '../stores/agentStore.js';

  let {
    time,
    onOpenSettings,
    onToggleNotifications,
    isNotificationCenterOpen,
    onToggleStartMenu,
    isStartMenuOpen = false,
    onStartButtonReady
  } = $props();

  let startButtonEl = $state(null);

  const visibleWindows = $derived($windows.filter(w => w.desktopId === $currentDesktopId));
  const unreadCount = $derived($notifications.filter(n => !n.read).length);
  const iconPixel = $derived(
    $taskbarSettings.iconSize === 'sm' ? 16 : $taskbarSettings.iconSize === 'lg' ? 20 : 18
  );
  const taskbarHeight = $derived($taskbarSettings.compactMode ? 42 : 48);
  const agentStatusColor = $derived(
    $agentStore.status === 'listening' ? '#38bdf8' :
    $agentStore.status === 'thinking' ? '#a78bfa' :
    $agentStore.status === 'executing' ? '#60a5fa' :
    $agentStore.status === 'success' ? '#10b981' :
    $agentStore.status === 'warning' ? '#f59e0b' :
    $agentStore.status === 'error' ? '#ef4444' :
    $agentStore.status === 'terminal' ? '#eab308' :
    'var(--accent-blue)'
  );
  const agentIcon = $derived(resolveAgentIcon());

  function resolveWindowIcon(win) {
    if (win.iconComponent) return win.iconComponent;
    if (typeof win.icon === 'function') return win.icon;
    return LayoutGrid;
  }

  function resolveAgentIcon() {
    if ($agentStore.status === 'listening') return Ear;
    if ($agentStore.status === 'thinking') return Loader;
    if ($agentStore.status === 'executing') return Play;
    if ($agentStore.status === 'success') return CheckCircle;
    if ($agentStore.status === 'warning') return AlertTriangle;
    if ($agentStore.status === 'error') return XCircle;
    if ($agentStore.status === 'terminal') return Terminal;
    return Bot;
  }

  $effect(() => {
    onStartButtonReady?.(startButtonEl);
  });
</script>

<div class="taskbar glass-effect {$taskbarSettings.compactMode ? 'compact' : ''}" style:height={`${taskbarHeight}px`}>
  {#if $taskbarSettings.showStartButton}
    <button
      class="start-menu-btn {isStartMenuOpen ? 'active' : ''}"
      onclick={onToggleStartMenu}
      title="Start Menu"
      aria-label="Start Menu"
      bind:this={startButtonEl}
    >
      <Shield size={iconPixel + 2} />
    </button>
  {/if}
  {#if $agentStore.visible}
    <button
      class="start-menu-btn agent-task-btn {$agentStore.isOpen ? 'active' : ''}"
      onclick={() => agentStore.togglePanel()}
      title="Agent Chat"
      aria-label="Agent Chat"
      style="--agent-status-color: {agentStatusColor};"
    >
      <span class:spin={$agentStore.status === 'thinking'}>
        {#if agentIcon === Ear}
          <Ear size={iconPixel + 1} />
        {:else if agentIcon === Loader}
          <Loader size={iconPixel + 1} />
        {:else if agentIcon === Play}
          <Play size={iconPixel + 1} />
        {:else if agentIcon === CheckCircle}
          <CheckCircle size={iconPixel + 1} />
        {:else if agentIcon === AlertTriangle}
          <AlertTriangle size={iconPixel + 1} />
        {:else if agentIcon === XCircle}
          <XCircle size={iconPixel + 1} />
        {:else if agentIcon === Terminal}
          <Terminal size={iconPixel + 1} />
        {:else}
          <Bot size={iconPixel + 1} />
        {/if}
      </span>
    </button>
  {/if}

  {#if $taskbarSettings.showDesktopSwitcher}
    <div class="desktop-switcher">
      <span class="desktop-num">{$currentDesktopId}</span>
      {#each $desktops as desktop}
        <button 
          class="desktop-btn {$currentDesktopId === desktop.id ? 'active' : ''}"
          onclick={() => switchDesktop(desktop.id)}
          title={desktop.name}
        >
        </button>
      {/each}
      <button
        class="layout-edit-btn {$layoutEditMode ? 'active' : ''}"
        onclick={toggleLayoutEditMode}
        title="Desktop layout edit mode"
      >
        Edit
      </button>
    </div>
  {/if}

  {#if $taskbarSettings.showSearch}
    <button class="taskbar-search" type="button" onclick={openSpotlight}>
      <Search size={$taskbarSettings.compactMode ? 13 : 14} />
      <span>Search...</span>
    </button>
  {/if}

  <div class="active-apps">
    {#each visibleWindows as win}
      {@const WindowIcon = resolveWindowIcon(win)}
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
        {#if win.iconType === 'image' && win.iconUrl}
          <img class="task-icon-image" style:width={`${iconPixel}px`} style:height={`${iconPixel}px`} src={win.iconUrl} alt={win.title} loading="lazy" />
        {:else}
          <WindowIcon size={iconPixel} />
        {/if}
      </button>
    {/each}
  </div>

  {#if $taskbarSettings.showSystemTray}
    <div class="system-tray">
      <button class="tray-btn" onclick={onOpenSettings} title="Settings">
        <Settings size={iconPixel} />
      </button>
      
      <button class="tray-btn {isNotificationCenterOpen ? 'active' : ''}" onclick={onToggleNotifications} title="Notifications">
        <div class="icon-wrapper">
          <Bell size={iconPixel} />
          {#if unreadCount > 0}
            <span class="badge">{unreadCount}</span>
          {/if}
        </div>
      </button>

      {#if $taskbarSettings.showClock}
        <button class="time-container" type="button" onclick={onToggleNotifications}>
          <span class="time">{time}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .taskbar { 
    position: absolute; 
    bottom: 0; 
    left: 0; 
    width: 100%; 
    height: 48px; 
    display: flex; 
    align-items: center; 
    padding: 0 10px; 
    border-top: 1px solid var(--glass-border); 
    z-index: 9999; 
    gap: 10px; 
  }
  .taskbar.compact {
    padding: 0 8px;
    gap: 8px;
  }
  
  .start-menu-btn { 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    width: 40px; 
    height: 40px; 
    border-radius: 8px; 
    cursor: pointer; 
    transition: background 0.2s, color 0.2s;
    color: white;
    border: none;
    background: transparent;
    position: relative;
  }
  .start-menu-btn:hover { background: rgba(255,255,255,0.1); }
  .start-menu-btn.active {
    background: rgba(88, 166, 255, 0.2);
    color: var(--accent-blue);
  }
  .agent-task-btn {
    border: 1px solid color-mix(in srgb, var(--agent-status-color) 55%, transparent);
  }
  .agent-task-btn.active::after {
    content: '';
    position: absolute;
    bottom: 4px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--agent-status-color);
  }
  .spin {
    animation: spinArea 1.5s linear infinite;
  }
  @keyframes spinArea {
    100% { transform: rotate(360deg); }
  }

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
  .desktop-btn:hover { 
    width: 12px;
    border-radius: 10px;
    background: rgba(255,255,255,0.7); 
  }
  .desktop-btn.active { 
    width: 22px; 
    height: 8px;
    border-radius: 10px; 
    background: white; 
  }
  .layout-edit-btn {
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .layout-edit-btn.active {
    color: white;
    border-color: rgba(88, 166, 255, 0.6);
    background: rgba(88, 166, 255, 0.2);
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
    font: inherit;
  }
  .taskbar-search:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    color: white;
  }

  .active-apps { flex: 1; display: flex; justify-content: flex-start; gap: 8px; padding-left: 10px; }
  .taskbar.compact .active-apps { padding-left: 6px; gap: 6px; }
  .task-item { background: transparent; border: none; color: var(--text-dim); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; position: relative; }
  .taskbar.compact .task-item { width: 34px; height: 34px; }
  .task-item:hover { background: rgba(255,255,255,0.1); }
  .task-item.active { background: rgba(255,255,255,0.1); color: var(--accent-blue); }
  .task-item.active::after { content: ''; position: absolute; bottom: 4px; width: 4px; height: 4px; background: var(--accent-blue); border-radius: 50%; }
  .task-icon-image { width: 18px; height: 18px; object-fit: contain; border-radius: 4px; }
  .taskbar.compact .task-icon-image { width: 16px; height: 16px; }

  .system-tray { display: flex; align-items: center; gap: 4px; }
  .tray-btn { background: transparent; border: none; color: var(--text-dim); padding: 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; position: relative; }
  .tray-btn:hover, .tray-btn.active { background: rgba(255,255,255,0.1); color: white; }
  
  .icon-wrapper { position: relative; display: flex; align-items: center; justify-content: center; }
  .badge { position: absolute; top: -6px; right: -6px; background: var(--accent-blue); color: white; font-size: 9px; font-weight: 700; min-width: 14px; height: 14px; border-radius: 7px; display: flex; align-items: center; justify-content: center; border: 1px solid #000; }

  .time-container { padding: 0 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; border: none; background: transparent; font: inherit; }
  .taskbar.compact .time-container { padding: 0 8px; }
  .time-container:hover { background: rgba(255,255,255,0.1); }
  .time { font-size: 13px; font-weight: 500; color: white; }
</style>
