<script>
  import { Clock, Activity } from 'lucide-svelte';

  let { widget } = $props();

  // Very basic grid math (assume 50px cells for simplicity, or percentages)
  const cellWidth = 100;
  const cellHeight = 100;
  
  // Convert grid coordinates to pixels, add some margins
  const style = `
    left: ${widget.x}px;
    top: ${widget.y}px;
    width: ${widget.w * cellWidth}px;
    height: ${widget.h * cellHeight}px;
  `;

  // Provide initial clock state
  let time = $state(new Date().toLocaleTimeString());
  $effect(() => {
    if (widget.type === 'clock') {
      const timer = setInterval(() => {
        time = new Date().toLocaleTimeString();
      }, 1000);
      return () => clearInterval(timer);
    }
  });

</script>

<div class="dashboard-widget glass-effect" {style}>
  {#if widget.type === 'clock'}
    <div class="widget-content clock-widget">
      <Clock size={32} color="var(--accent-blue)" />
      <h2>{time}</h2>
    </div>
  {:else if widget.type === 'monitor'}
    <div class="widget-content monitor-widget">
      <div class="header">
        <Activity size={20} color="var(--accent-blue)"/>
        <span>System Monitor</span>
      </div>
      <div class="stats">
        <div class="stat">
          <label>CPU</label>
          <div class="bar-bg"><div class="bar-fg" style="width: 34%"></div></div>
        </div>
        <div class="stat">
          <label>RAM</label>
          <div class="bar-bg"><div class="bar-fg" style="width: 68%"></div></div>
        </div>
      </div>
    </div>
  {:else}
    <div class="widget-content">
      Unknown widget type
    </div>
  {/if}
</div>

<style>
  .dashboard-widget {
    position: absolute;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(10px);
    pointer-events: auto; /* allow interaction inside */
    display: flex;
    overflow: hidden;
    transition: transform 0.2s;
  }
  .dashboard-widget:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .widget-content {
    flex: 1;
    padding: 20px;
    color: white;
    display: flex;
    flex-direction: column;
  }

  .clock-widget {
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .clock-widget h2 {
    font-size: 24px;
    font-weight: 300;
    letter-spacing: 1px;
    margin: 0;
  }

  .monitor-widget .header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 20px;
  }
  
  .stats {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  .stat label {
    font-size: 11px;
    color: var(--text-dim);
    margin-bottom: 5px;
    display: block;
  }
  .bar-bg {
    width: 100%;
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar-fg {
    height: 100%;
    background: var(--accent-blue);
    border-radius: 3px;
  }
</style>
