<script>
  import { Clock, Activity, GripVertical, Lock, Unlock, X, Cpu, Wifi, HardDrive } from 'lucide-svelte';
  import { widgets } from '../stores/widgetStore.js';

  let { widget } = $props();
  
  let isDragging = $state(false);
  let isResizing = $state(false);
  let dragStart = $state({ x: 0, y: 0, wx: 0, wy: 0 });
  let resizeStart = $state({ x: 0, y: 0, ww: 0, wh: 0 });

  // Clock state
  let time = $state(new Date().toLocaleTimeString());

  // System API state (for type=system widgets)
  let sysData = $state(null);

  $effect(() => {
    if (widget.source === 'clock') {
      const timer = setInterval(() => { time = new Date().toLocaleTimeString(); }, 1000);
      return () => clearInterval(timer);
    }
    if (widget.type === 'system') {
      const fetchSys = async () => {
        try {
          const token = localStorage.getItem('web_os_token') || '';
          const res = await fetch('/api/system/overview', { headers: { Authorization: `Bearer ${token}` } });
          sysData = await res.json();
        } catch (e) { /* silently fail */ }
      };
      fetchSys();
      const timer = setInterval(fetchSys, 3000);
      return () => clearInterval(timer);
    }
  });

  // --- Lock Toggle ---
  function handleToggleLock(e) {
    e.stopPropagation();
    e.preventDefault();
    widgets.toggleLock(widget.id);
  }

  // --- Drag ---
  function startDrag(e) {
    if (widget.locked) return;
    e.preventDefault();
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY, wx: widget.x, wy: widget.y };
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
  }
  function onDrag(e) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    widgets.updateWidget(widget.id, { x: dragStart.wx + dx, y: dragStart.wy + dy });
  }
  function stopDrag() {
    isDragging = false;
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', stopDrag);
  }

  // --- Resize ---
  function startResize(e) {
    if (widget.locked) return;
    e.stopPropagation();
    e.preventDefault();
    isResizing = true;
    resizeStart = { x: e.clientX, y: e.clientY, ww: widget.w, wh: widget.h };
    window.addEventListener('mousemove', onResize);
    window.addEventListener('mouseup', stopResize);
  }
  function onResize(e) {
    const dw = e.clientX - resizeStart.x;
    const dh = e.clientY - resizeStart.y;
    widgets.updateWidget(widget.id, {
      w: Math.max(120, resizeStart.ww + dw),
      h: Math.max(80, resizeStart.wh + dh)
    });
  }
  function stopResize() {
    isResizing = false;
    window.removeEventListener('mousemove', onResize);
    window.removeEventListener('mouseup', stopResize);
  }

  function handleRemove(e) {
    e.stopPropagation();
    widgets.removeWidget(widget.id);
  }
</script>

<div 
  class="dashboard-widget" 
  class:unlocked={!widget.locked}
  class:dragging={isDragging}
  style="left:{widget.x}px; top:{widget.y}px; width:{widget.w}px; height:{widget.h}px;"
  onmousedown={startDrag}
>
  <!-- Remove button (only when unlocked) -->
  {#if !widget.locked}
    <button class="remove-btn" onclick={handleRemove} title="Remove Widget">
      <X size={12} />
    </button>
  {/if}

  <!-- Content Area -->
  <div class="widget-content">
    {#if widget.type === 'preset' && widget.source === 'clock'}
      <div class="preset clock-widget">
        <Clock size={28} color="var(--accent-blue)" />
        <h2>{time}</h2>
      </div>

    {:else if widget.type === 'system'}
      {#if !sysData}
        <div class="preset fallback"><span>Loading...</span></div>
      {:else if widget.source === 'sys-cpu'}
        <div class="preset sys-widget">
          <div class="sys-header"><Cpu size={14} color="#34d399"/><span>CPU</span><span class="sys-val">{parseFloat(sysData.cpu).toFixed(1)}%</span></div>
          <div class="bar-bg"><div class="bar-fg green" style="width:{sysData.cpu}%"></div></div>
          {#if sysData.cpuTemp?.main}
            <div class="sys-sub">Temp: {sysData.cpuTemp.main}°C  Max: {sysData.cpuTemp.max}°C</div>
          {/if}
        </div>

      {:else if widget.source === 'sys-mem'}
        <div class="preset sys-widget">
          <div class="sys-header"><Activity size={14} color="#34d399"/><span>Memory</span><span class="sys-val">{sysData.memory?.percentage}%</span></div>
          <div class="bar-bg"><div class="bar-fg green" style="width:{sysData.memory?.percentage}%"></div></div>
          <div class="sys-sub">
            {((sysData.memory?.used || 0) / 1024 / 1024 / 1024).toFixed(1)} GB / {((sysData.memory?.total || 0) / 1024 / 1024 / 1024).toFixed(1)} GB
          </div>
        </div>

      {:else if widget.source === 'sys-net'}
        <div class="preset sys-widget">
          <div class="sys-header"><Wifi size={14} color="#34d399"/><span>Network</span></div>
          {#each (sysData.network || []).slice(0, 2) as iface}
            <div class="net-row">
              <span class="iface-name">{iface.iface}</span>
              <span class="net-stat">↑ {((iface.tx_sec || 0)/1024).toFixed(1)} KB/s</span>
              <span class="net-stat">↓ {((iface.rx_sec || 0)/1024).toFixed(1)} KB/s</span>
            </div>
          {/each}
        </div>

      {:else if widget.source === 'sys-storage'}
        <div class="preset sys-widget">
          <div class="sys-header"><HardDrive size={14} color="#34d399"/><span>Storage</span></div>
          {#each (sysData.storage || []).slice(0, 3) as drive}
            <div class="drive-row">
              <span class="drive-name">{drive.fs?.split('/').pop() || drive.fs}</span>
              <div class="bar-bg small"><div class="bar-fg green" style="width:{drive.use}%"></div></div>
              <span class="drive-pct">{Math.round(drive.use)}%</span>
            </div>
          {/each}
        </div>
      {/if}

    {:else if widget.type === 'url'}
      <iframe 
        src={widget.source} 
        title={widget.title}
        sandbox="allow-scripts allow-same-origin"
        class="widget-iframe"
      ></iframe>

    {:else if widget.type === 'custom'}
      <iframe 
        srcdoc={widget.source} 
        title={widget.title}
        sandbox="allow-scripts"
        class="widget-iframe"
      ></iframe>

    {:else}
      <div class="preset fallback">
        <span>{widget.title || 'Unknown Widget'}</span>
      </div>
    {/if}
  </div>

  <!-- Lock/Unlock Handle (always visible at bottom-right) -->
  <button 
    class="handle-btn" 
    class:locked={widget.locked}
    onclick={handleToggleLock}
    title={widget.locked ? 'Unlock to move/resize' : 'Lock position'}
  >
    {#if widget.locked}
      <Lock size={10} />
    {:else}
      <Unlock size={10} />
    {/if}
  </button>

  <!-- Resize Handle (only when unlocked) -->
  {#if !widget.locked}
    <div class="resize-handle" onmousedown={startResize}>
      <GripVertical size={12} />
    </div>
  {/if}
</div>

<style>
  .dashboard-widget {
    position: absolute;
    border-radius: 14px;
    background: rgba(15, 20, 30, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(12px);
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: box-shadow 0.2s, border-color 0.2s;
    user-select: none;
  }

  .dashboard-widget.unlocked {
    border-color: rgba(88, 166, 255, 0.3);
    box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.15), 0 4px 20px rgba(0, 0, 0, 0.3);
    cursor: grab;
  }
  .dashboard-widget.dragging {
    cursor: grabbing;
    opacity: 0.85;
  }

  .widget-content {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .widget-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    border-radius: 14px;
  }

  /* Presets */
  .preset {
    flex: 1;
    padding: 16px;
    color: white;
    display: flex;
    flex-direction: column;
  }
  .clock-widget {
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .clock-widget h2 {
    font-size: 20px;
    font-weight: 300;
    letter-spacing: 1px;
    margin: 0;
  }

  .monitor-widget .header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 14px;
  }
  .stats { display: flex; flex-direction: column; gap: 12px; }
  .stat label { font-size: 10px; color: rgba(255,255,255,0.4); margin-bottom: 4px; display: block; }
  .bar-bg { width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
  .bar-fg { height: 100%; background: var(--accent-blue); border-radius: 3px; transition: width 0.5s; }
  .bar-fg.green { background: #34d399; }
  .fallback { align-items: center; justify-content: center; font-size: 13px; color: rgba(255,255,255,0.4); }

  /* System widgets */
  .sys-widget { gap: 8px; }
  .sys-header { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); margin-bottom: 4px; }
  .sys-val { margin-left: auto; font-size: 14px; font-weight: 700; color: #34d399; }
  .sys-sub { font-size: 10px; color: rgba(255,255,255,0.35); margin-top: 4px; }
  .bar-bg.small { height: 4px; }
  .net-row { display: flex; align-items: center; gap: 6px; font-size: 10px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .iface-name { font-weight: 600; color: #34d399; min-width: 50px; font-size: 10px; }
  .net-stat { color: rgba(255,255,255,0.5); flex: 1; }
  .drive-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
  .drive-name { font-size: 10px; color: rgba(255,255,255,0.6); min-width: 55px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drive-pct { font-size: 10px; color: #34d399; min-width: 30px; text-align: right; }

  /* Lock Handle */
  .handle-btn {
    position: absolute;
    bottom: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
    z-index: 10;
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.3);
  }
  .handle-btn:hover {
    background: rgba(88, 166, 255, 0.25);
    color: white;
  }
  .handle-btn.locked {
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.15);
  }

  /* Resize Handle */
  .resize-handle {
    position: absolute;
    bottom: 2px;
    right: 28px;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: se-resize;
    color: rgba(88, 166, 255, 0.5);
    z-index: 10;
    transform: rotate(45deg);
  }
  .resize-handle:hover {
    color: var(--accent-blue);
  }

  /* Remove Button */
  .remove-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: rgba(239, 68, 68, 0.15);
    color: rgba(239, 68, 68, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s;
  }
  .remove-btn:hover {
    background: rgba(239, 68, 68, 0.4);
    color: white;
  }
</style>
