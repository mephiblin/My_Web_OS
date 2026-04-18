<script>
  import { X, Minus, Square } from 'lucide-svelte';
  import { closeWindow, focusWindow, toggleMinimize } from './windowStore.js';

  let { window: win, active = false, children } = $props();

  let dragging = $state(false);
  let startX = $state(0);
  let startY = $state(0);

  function handleMouseDown(e) {
    focusWindow(win.id);
    if (e.target.closest('.title-bar')) {
      dragging = true;
      startX = e.clientX - win.x;
      startY = e.clientY - win.y;
    }
  }

  function handleMouseMove(e) {
    if (dragging && !win.maximized) {
      win.x = e.clientX - startX;
      win.y = e.clientY - startY;
    }
  }

  function handleMouseUp() {
    dragging = false;
  }
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<div
  class="window glass-effect window-shadow {active ? 'active' : ''} {win.minimized ? 'minimized' : ''}"
  style="left: {win.x}px; top: {win.y}px; width: {win.width}px; height: {win.height}px; z-index: {win.zIndex}"
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
</div>

<style>
  .window {
    position: absolute;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    overflow: hidden;
    transition: opacity 0.2s;
  }

  .window.minimized {
    display: none;
  }

  .window.active {
    border-color: var(--accent-blue);
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
</style>
