<script>
  import { widgets } from '../../core/stores/widgetStore.js';
  import { Clock, Activity, Globe, Code, Plus, Trash2, LayoutGrid, Cpu, Wifi, HardDrive } from 'lucide-svelte';

  let activeTab = $state('presets'); // 'presets' | 'system' | 'url' | 'custom'
  let urlInput = $state('');
  let urlTitle = $state('');
  let customCode = $state('<html>\n<body style="margin:0;color:white;background:transparent;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">\n  <h1>Hello Widget!</h1>\n</body>\n</html>');
  let customTitle = $state('My Widget');

  const presets = [
    { source: 'clock', title: 'Clock', icon: Clock, desc: 'Real-time clock display', w: 200, h: 200 },
  ];

  const systemWidgets = [
    { source: 'sys-cpu', title: 'CPU Monitor', icon: Cpu, desc: 'Live CPU usage & temperature', w: 220, h: 200 },
    { source: 'sys-mem', title: 'Memory Monitor', icon: Activity, desc: 'Live RAM usage', w: 220, h: 200 },
    { source: 'sys-net', title: 'Network Monitor', icon: Wifi, desc: 'Live network TX/RX stats', w: 240, h: 200 },
    { source: 'sys-storage', title: 'Storage Overview', icon: HardDrive, desc: 'Disk usage overview', w: 260, h: 200 },
  ];

  function addPreset(preset) {
    widgets.addWidget({ type: 'preset', source: preset.source, title: preset.title, w: preset.w, h: preset.h });
  }

  function addSystemWidget(sw) {
    widgets.addWidget({ type: 'system', source: sw.source, title: sw.title, w: sw.w, h: sw.h });
  }

  function addUrlWidget() {
    if (!urlInput.trim()) return;
    widgets.addWidget({ type: 'url', source: urlInput, title: urlTitle || 'Web Widget', w: 350, h: 280 });
    urlInput = '';
    urlTitle = '';
  }

  function addCustomWidget() {
    if (!customCode.trim()) return;
    widgets.addWidget({ type: 'custom', source: customCode, title: customTitle || 'Custom Widget', w: 300, h: 250 });
  }
</script>

<div class="widget-store">
  <div class="store-header">
    <LayoutGrid size={20} />
    <h2>Widget Store</h2>
  </div>

  <div class="tabs">
    <button class:active={activeTab === 'presets'} onclick={() => activeTab = 'presets'}>Presets</button>
    <button class:active={activeTab === 'system'} onclick={() => activeTab = 'system'}>
      System <span class="badge">Live</span>
    </button>
    <button class:active={activeTab === 'url'} onclick={() => activeTab = 'url'}>URL</button>
    <button class:active={activeTab === 'custom'} onclick={() => activeTab = 'custom'}>Custom Code</button>
  </div>

  <div class="tab-content">
    {#if activeTab === 'presets'}
      <div class="preset-grid">
        {#each presets as preset}
          <div class="preset-card">
            <div class="card-icon">
              <svelte:component this={preset.icon} size={28} color="var(--accent-blue)" />
            </div>
            <div class="card-info">
              <span class="card-title">{preset.title}</span>
              <span class="card-desc">{preset.desc}</span>
            </div>
            <button class="add-btn" onclick={() => addPreset(preset)}>
              <Plus size={14} /> Add
            </button>
          </div>
        {/each}
      </div>

    {:else if activeTab === 'system'}
      <p class="section-desc">Live data polled from the OS backend every 3 seconds.</p>
      <div class="preset-grid">
        {#each systemWidgets as sw}
          <div class="preset-card system-card">
            <div class="card-icon sys">
              <svelte:component this={sw.icon} size={24} color="#34d399" />
            </div>
            <div class="card-info">
              <span class="card-title">{sw.title}</span>
              <span class="card-desc">{sw.desc}</span>
            </div>
            <button class="add-btn sys-btn" onclick={() => addSystemWidget(sw)}>
              <Plus size={14} /> Add
            </button>
          </div>
        {/each}
      </div>

    {:else if activeTab === 'url'}
      <div class="form-section">
        <label>Widget Title</label>
        <input type="text" bind:value={urlTitle} placeholder="e.g. Weather" />
        <label>URL</label>
        <input type="text" bind:value={urlInput} placeholder="https://example.com" />
        <button class="submit-btn" onclick={addUrlWidget}>
          <Globe size={14} /> Add URL Widget
        </button>
        <p class="hint">Enter any webpage URL. It will be embedded as an iframe widget on your desktop.</p>
      </div>

    {:else if activeTab === 'custom'}
      <div class="form-section">
        <label>Widget Title</label>
        <input type="text" bind:value={customTitle} placeholder="My Widget" />
        <label>HTML / CSS / JS</label>
        <textarea bind:value={customCode} rows="12" spellcheck="false"></textarea>
        <button class="submit-btn" onclick={addCustomWidget}>
          <Code size={14} /> Add Custom Widget
        </button>
        <p class="hint">Write raw HTML/CSS/JS. It runs sandboxed inside an iframe on your desktop.</p>
      </div>
    {/if}
  </div>

  <!-- Active Widgets List -->
  <div class="active-section">
    <h3>Active Widgets ({$widgets.length})</h3>
    <div class="active-list">
      {#each $widgets as w (w.id)}
        <div class="active-item">
          <span class="a-type" class:sys={w.type === 'system'}>{w.type}</span>
          <span class="a-title">{w.title}</span>
          <button class="a-remove" onclick={() => widgets.removeWidget(w.id)}>
            <Trash2 size={12} />
          </button>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .widget-store {
    height: 100%;
    display: flex;
    flex-direction: column;
    color: var(--text-main);
    overflow: hidden;
  }

  .store-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(0,0,0,0.2);
  }
  .store-header h2 { margin: 0; font-size: 16px; font-weight: 600; }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(0,0,0,0.1);
  }
  .tabs button {
    flex: 1;
    padding: 10px 6px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .tabs button:hover { color: white; background: rgba(255,255,255,0.03); }
  .tabs button.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }

  .badge {
    background: rgba(52, 211, 153, 0.2);
    color: #34d399;
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 10px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-desc { font-size: 11px; color: var(--text-dim); margin: 0; line-height: 1.5; }

  /* Cards */
  .preset-grid { display: flex; flex-direction: column; gap: 10px; }
  .preset-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    transition: background 0.2s;
  }
  .preset-card:hover { background: rgba(255,255,255,0.06); }
  .system-card { border-color: rgba(52, 211, 153, 0.1); }
  .system-card:hover { background: rgba(52, 211, 153, 0.04); }

  .card-icon { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: rgba(88,166,255,0.1); border-radius: 10px; flex-shrink: 0; }
  .card-icon.sys { background: rgba(52, 211, 153, 0.1); }
  .card-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .card-title { font-size: 13px; font-weight: 600; }
  .card-desc { font-size: 11px; color: var(--text-dim); }

  .add-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: rgba(88,166,255,0.15);
    border: 1px solid rgba(88,166,255,0.3);
    border-radius: 6px;
    color: var(--accent-blue);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  .add-btn:hover { background: rgba(88,166,255,0.25); }
  .sys-btn {
    background: rgba(52,211,153,0.12);
    border-color: rgba(52,211,153,0.3);
    color: #34d399;
  }
  .sys-btn:hover { background: rgba(52,211,153,0.22); }

  /* Forms */
  .form-section { display: flex; flex-direction: column; gap: 10px; }
  .form-section label { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .form-section input, .form-section textarea {
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    color: white;
    padding: 10px 12px;
    font-size: 13px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.2s;
  }
  .form-section input:focus, .form-section textarea:focus { border-color: var(--accent-blue); }
  .form-section textarea { font-family: monospace; font-size: 12px; resize: vertical; min-height: 120px; }
  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    background: var(--accent-blue);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.2s;
  }
  .submit-btn:hover { filter: brightness(1.15); }
  .hint { font-size: 11px; color: var(--text-dim); margin: 0; line-height: 1.4; }

  /* Active Widgets */
  .active-section {
    border-top: 1px solid var(--glass-border);
    padding: 12px 16px;
    background: rgba(0,0,0,0.15);
    max-height: 180px;
    overflow-y: auto;
  }
  .active-section h3 { font-size: 12px; margin: 0 0 10px 0; color: var(--text-dim); }
  .active-list { display: flex; flex-direction: column; gap: 6px; }
  .active-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(255,255,255,0.03);
    border-radius: 6px;
    font-size: 12px;
  }
  .a-type {
    background: rgba(88,166,255,0.15);
    color: var(--accent-blue);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .a-type.sys {
    background: rgba(52,211,153,0.15);
    color: #34d399;
  }
  .a-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .a-remove {
    background: none;
    border: none;
    color: rgba(239,68,68,0.5);
    cursor: pointer;
    padding: 2px;
    display: flex;
    transition: color 0.2s;
  }
  .a-remove:hover { color: #ef4444; }
</style>
