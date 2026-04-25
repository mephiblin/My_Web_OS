<script>
  import { X, Minus, Square, LayoutGrid } from 'lucide-svelte';
  import { closeWindow, focusWindow, toggleMinimize, toggleMaximize } from './stores/windowStore.js';
  import { setSnapGhost, hideSnapGhost } from './stores/snapStore.js';
  import { taskbarSettings } from './stores/taskbarStore.js';
  import { windowDefaultsSettings } from './stores/windowDefaultsStore.js';

  let { window: win, active = false, children } = $props();

  let dragging = $state(false);
  let resizing = $state(false);
  let startX = 0;
  let startY = 0;
  let rafId = null;
  let winEl;

  let localX = $state(0);
  let localY = $state(0);
  let localWidth = $state(0);
  let localHeight = $state(0);

  let snapZone = $state(null); // 'left', 'right', 'top', null
  const iconComponent = $derived(win.iconComponent || (typeof win.icon === 'function' ? win.icon : LayoutGrid));
  const taskbarHeight = $derived($taskbarSettings.compactMode ? 42 : 48);
  const appBackground = $derived($windowDefaultsSettings.appBackgrounds?.[win.appId] || '');
  const titleBarHeight = $derived(
    Number.isFinite(Number(win.window?.titleBarHeight))
      ? Number(win.window.titleBarHeight)
      : $windowDefaultsSettings.titleBarHeight
  );

  $effect(() => {
    if (!dragging && !resizing) {
      localX = win.x;
      localY = win.y;
      localWidth = win.width;
      localHeight = win.height;
    }
  });

  function handleMouseDown(e) {
    focusWindow(win.id);
    if (e.target.closest('.title-bar') && !e.target.closest('.controls')) {
      dragging = true;
      startX = e.clientX - localX;
      startY = e.clientY - localY;
      e.preventDefault();
    }
  }

  function handleResizeStart(e) {
    focusWindow(win.id);
    e.stopPropagation();
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
  }

  function handleMouseMove(e) {
    if (!dragging && !resizing) return;
    e.preventDefault();

    if (rafId) return;

    const cx = e.clientX;
    const cy = e.clientY;

    rafId = requestAnimationFrame(() => {
      if (dragging && !win.maximized) {
        const maxX = globalThis.innerWidth - 50;
        const maxY = globalThis.innerHeight - 50;
        localX = Math.max(-localWidth + 50, Math.min(cx - startX, maxX));
        localY = Math.max(0, Math.min(cy - startY, maxY));
        
        // Snap detection
        const edgeThreshold = 20;
        const availableHeight = globalThis.innerHeight - taskbarHeight;

        if (cx < edgeThreshold) {
          snapZone = 'left';
          setSnapGhost({ visible: true, x: 0, y: 0, width: globalThis.innerWidth / 2, height: availableHeight });
        } else if (cx > globalThis.innerWidth - edgeThreshold) {
          snapZone = 'right';
          setSnapGhost({ visible: true, x: globalThis.innerWidth / 2, y: 0, width: globalThis.innerWidth / 2, height: availableHeight });
        } else if (cy < edgeThreshold) {
          snapZone = 'top';
          setSnapGhost({ visible: true, x: 0, y: 0, width: globalThis.innerWidth, height: availableHeight });
        } else {
          snapZone = null;
          hideSnapGhost();
        }

        win.x = localX;
        win.y = localY;
      } else if (resizing && !win.maximized) {
        const dx = cx - startX;
        const dy = cy - startY;
        const minWidth = Number.isFinite(Number(win.window?.minWidth))
          ? Number(win.window.minWidth)
          : $windowDefaultsSettings.minWidth;
        const minHeight = Number.isFinite(Number(win.window?.minHeight))
          ? Number(win.window.minHeight)
          : $windowDefaultsSettings.minHeight;
        localWidth = Math.max(minWidth, localWidth + dx);
        localHeight = Math.max(minHeight, localHeight + dy);
        win.width = localWidth;
        win.height = localHeight;
        startX = cx;
        startY = cy;
      }
      rafId = null;
    });
  }

  function handleMouseUp() {
    if (dragging && snapZone) {
      const availableHeight = globalThis.innerHeight - taskbarHeight;

      if (snapZone === 'left') {
        win.x = localX = 0;
        win.y = localY = 0;
        win.width = localWidth = globalThis.innerWidth / 2;
        win.height = localHeight = availableHeight;
      } else if (snapZone === 'right') {
        win.x = localX = globalThis.innerWidth / 2;
        win.y = localY = 0;
        win.width = localWidth = globalThis.innerWidth / 2;
        win.height = localHeight = availableHeight;
      } else if (snapZone === 'top') {
        toggleMaximize(win.id);
      }
    }

    dragging = false;
    resizing = false;
    snapZone = null;
    hideSnapGhost();

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<div
  bind:this={winEl}
  class="window glass-effect window-shadow {active ? 'active' : ''} {win.minimized ? 'minimized' : ''} {win.maximized ? 'maximized' : ''} {dragging || resizing ? 'interacting' : ''}"
  style="transform: {win.maximized ? 'none' : `translate3d(${localX}px, ${localY}px, 0)`}; width: {win.maximized ? '100%' : localWidth + 'px'}; height: {win.maximized ? `calc(100% - ${taskbarHeight}px)` : localHeight + 'px'}; z-index: {win.zIndex}"
  role="dialog"
  aria-label={win.title}
  tabindex="-1"
  onmousedown={handleMouseDown}
>
  <div
    class="title-bar"
    style:height={`${titleBarHeight}px`}
    role="button"
    tabindex="-1"
    ondblclick={() => toggleMaximize(win.id)}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMaximize(win.id);
      }
    }}
  >
    <div class="title">
      {#if win.iconType === 'image' && win.iconUrl}
        <img class="title-icon-image" src={win.iconUrl} alt={win.title} loading="lazy" />
      {:else}
        {@const TitleIcon = iconComponent}
        <TitleIcon size={16} />
      {/if}
      <span>{win.title}</span>
    </div>
    <div class="controls">
      <button onclick={(e) => { e.stopPropagation(); toggleMinimize(win.id); }}><Minus size={14} /></button>
      <button onclick={(e) => { e.stopPropagation(); toggleMaximize(win.id); }}><Square size={14} /></button>
      <button class="close" onclick={(e) => { e.stopPropagation(); closeWindow(win.id); }}><X size={14} /></button>
    </div>
  </div>

  <div class="content" style:background={appBackground || undefined}>
    {@render children()}
    {#if dragging || resizing}
      <div class="drag-overlay"></div>
    {/if}
  </div>
  {#if !win.maximized}
    <div
      class="resize-handle"
      role="button"
      aria-label="Resize window"
      tabindex="-1"
      onmousedown={handleResizeStart}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
        }
      }}
    ></div>
  {/if}
</div>

<style>
  .window {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    overflow: hidden;
    will-change: transform;
    contain: layout style;
    backface-visibility: hidden;
  }

  .window:not(.interacting) {
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .window.interacting {
    user-select: none;
    cursor: grabbing;
  }

  .window.interacting .content {
    pointer-events: none;
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    cursor: grabbing;
    background: transparent;
  }

  .window.minimized {
    opacity: 0;
    transform: scale(0.9) translateY(40px) !important;
    pointer-events: none;
  }

  .window.maximized {
    border-radius: 0;
    border-top: none;
    border-left: none;
    border-right: none;
    box-shadow: none;
  }

  .window.active {
    border-color: var(--accent-blue);
    box-shadow: 0 12px 48px 0 rgba(0, 0, 0, 0.9);
  }

  .title-bar {
    height: 32px;
    background: rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    cursor: default;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
  }
  .title-icon-image {
    width: 16px;
    height: 16px;
    object-fit: contain;
    border-radius: 4px;
  }

  .controls {
    display: flex;
    gap: 4px;
  }

  .controls button {
    background: transparent;
    border: none;
    color: var(--text-dim);
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    cursor: pointer;
  }

  .controls button:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }

  .controls button.close:hover {
    background: var(--accent-red);
  }

  .content {
    flex: 1;
    overflow: auto;
    background: rgba(0,0,0,0.2);
  }

  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 15px;
    height: 15px;
    cursor: nwse-resize;
    z-index: 10;
  }
</style>
