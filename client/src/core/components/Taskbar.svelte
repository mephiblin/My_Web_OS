<script>
  import { Shield, Search, Settings, Bell, LayoutGrid } from 'lucide-svelte';
  import { windows, activeWindowId, focusWindow, toggleMinimize } from '../stores/windowStore.js';
  import { desktops, currentDesktopId, switchDesktop } from '../stores/desktopStore.js';
  import { notifications } from '../stores/notificationStore.js';
  import { openSpotlight } from '../stores/spotlightStore.js';
  import { taskbarSettings } from '../stores/taskbarStore.js';

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

  function resolveWindowIcon(win) {
    if (win.iconComponent) return win.iconComponent;
    if (typeof win.icon === 'function') return win.icon;
    return LayoutGrid;
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
    </div>
  {/if}

  {#if $taskbarSettings.showSearch}
    <div class="taskbar-search" onclick={openSpotlight}>
      <Search size={$taskbarSettings.compactMode ? 13 : 14} />
      <span>Search...</span>
    </div>
  {/if}

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
        {#if win.iconType === 'image' && win.iconUrl}
          <img class="task-icon-image" style:width={`${iconPixel}px`} style:height={`${iconPixel}px`} src={win.iconUrl} alt={win.title} loading="lazy" />
        {:else}
          <svelte:component this={resolveWindowIcon(win)} size={iconPixel} />
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
        <div class="time-container" onclick={onToggleNotifications}>
          <span class="time">{time}</span>
        </div>
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
  }
  .start-menu-btn:hover { background: rgba(255,255,255,0.1); }
  .start-menu-btn.active {
    background: rgba(88, 166, 255, 0.2);
    color: var(--accent-blue);
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

  .time-container { padding: 0 10px; cursor: pointer; border-radius: 6px; transition: background 0.2s; }
  .taskbar.compact .time-container { padding: 0 8px; }
  .time-container:hover { background: rgba(255,255,255,0.1); }
  .time { font-size: 13px; font-weight: 500; color: white; }
</style>
