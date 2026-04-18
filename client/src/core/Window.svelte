<script>
  import { X, Minus, Square } from 'lucide-svelte';
  import { closeWindow, focusWindow, toggleMinimize } from './stores/windowStore.js';

  let { window: win, active = false, children } = $props();

  let dragging = $state(false);
  let resizing = $state(false);
  let startX = 0;
  let startY = 0;
  let rafId = null;
  let winEl;

  function handleMouseDown(e) {
    focusWindow(win.id);
    if (e.target.closest('.title-bar') && !e.target.closest('.controls')) {
      dragging = true;
      startX = e.clientX - win.x;
      startY = e.clientY - win.y;
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
        win.x = Math.max(-win.width + 50, Math.min(cx - startX, maxX));
        win.y = Math.max(0, Math.min(cy - startY, maxY));
      } else if (resizing && !win.maximized) {
        const dx = cx - startX;
        const dy = cy - startY;
        win.width = Math.max(300, win.width + dx);
        win.height = Math.max(200, win.height + dy);
        startX = cx;
        startY = cy;
      }
      rafId = null;
    });
  }

  function handleMouseUp() {
    dragging = false;
    resizing = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<div
  bind:this={winEl}
  class="window glass-effect window-shadow {active ? 'active' : ''} {win.minimized ? 'minimized' : ''} {dragging || resizing ? 'interacting' : ''}"
  style="transform: translate3d({win.x}px, {win.y}px, 0); width: {win.width}px; height: {win.height}px; z-index: {win.zIndex}"
  onmousedown={handleMouseDown}
>
  <div class="title-bar">
    <div class="title">
      <svelte:component this={win.icon} size={16} />
      <span>{win.title}</span>
    </div>
    <div class="controls">
      <button onclick={() => toggleMinimize(win.id)}><Minus size={14} /></button>
      <button><Square size={14} /></button>
      <button class="close" onclick={() => closeWindow(win.id)}><X size={14} /></button>
    </div>
  </div>

  <div class="content">
    {@render children()}
  </div>
  <div class="resize-handle" onmousedown={handleResizeStart}></div>
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

  .window.minimized {
    opacity: 0;
    transform: scale(0.9) !important;
    pointer-events: none;
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
