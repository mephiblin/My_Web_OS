<script>
  import { widgets } from '../../../core/stores/widgetStore.js';
  import { widgetLibrary } from '../../../core/stores/widgetLibraryStore.js';
  import { 
    Clock, Activity, Globe, Code, Plus, Trash2, LayoutGrid, 
    Cpu, Wifi, HardDrive, Edit3, Save, ArrowLeft, Send, CalendarDays
  } from 'lucide-svelte';

  let activeTab = $state('presets'); // 'presets' | 'system' | 'url' | 'custom'
  
  // Editor State
  let editorMode = $state('list'); // 'list' | 'create' | 'edit'
  let editingId = $state(null);
  let deleteTemplateId = $state('');
  
  let tempTitle = $state('');
  let tempSource = $state('');

  const presets = [
    { source: 'clock', title: 'Clock', icon: Clock, desc: 'Real-time clock display', w: 200, h: 200 },
  ];

  const systemWidgets = [
    { source: 'sys-calendar', title: 'Calendar Agenda', icon: CalendarDays, desc: 'Monthly calendar events', w: 280, h: 220 },
    { source: 'sys-cpu', title: 'CPU Monitor', icon: Cpu, desc: 'Live CPU usage & temp', w: 220, h: 200 },
    { source: 'sys-mem', title: 'Memory Monitor', icon: Activity, desc: 'Live RAM usage', w: 220, h: 200 },
    { source: 'sys-net', title: 'Network Monitor', icon: Wifi, desc: 'Live net TX/RX stats', w: 240, h: 200 },
    { source: 'sys-storage', title: 'Storage Overview', icon: HardDrive, desc: 'Disk usage overview', w: 260, h: 200 },
  ];

  function addPreset(preset) {
    widgets.addWidget({ type: 'preset', source: preset.source, title: preset.title, w: preset.w, h: preset.h });
  }

  function addSystemWidget(sw) {
    widgets.addWidget({ type: 'system', source: sw.source, title: sw.title, w: sw.w, h: sw.h });
  }

  function openCreate() {
    editorMode = 'create';
    editingId = null;
    tempTitle = '';
    tempSource = activeTab === 'custom' ? '<html>\n<body style="margin:0;color:white;background:transparent;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">\n  <h1>Hello Widget!</h1>\n</body>\n</html>' : '';
  }

  function openEdit(item) {
    editorMode = 'edit';
    editingId = item.id;
    tempTitle = item.title;
    tempSource = item.source;
  }

  function saveItem() {
    if (!tempTitle.trim()) return;
    const type = activeTab === 'url' ? 'url' : 'custom';
    
    if (editorMode === 'create') {
      widgetLibrary.addTemplate({ type, title: tempTitle, source: tempSource });
    } else {
      widgetLibrary.updateTemplate(editingId, { title: tempTitle, source: tempSource });
    }
    
    editorMode = 'list';
  }

  function instantiate(item) {
    widgets.addWidget({ 
      type: item.type, 
      source: item.source, 
      title: item.title, 
      w: item.type === 'url' ? 350 : 300, 
      h: item.type === 'url' ? 280 : 250 
    });
  }

  function removeTemplate(id) {
    deleteTemplateId = String(id || '');
  }

  function confirmRemoveTemplate() {
    const id = deleteTemplateId;
    deleteTemplateId = '';
    if (id) widgetLibrary.removeTemplate(id);
  }

  const filteredLibrary = $derived($widgetLibrary.filter(i => i.type === (activeTab === 'url' ? 'url' : 'custom')));
</script>

{#if deleteTemplateId}
  <div class="widget-modal-backdrop" role="presentation">
    <div class="widget-confirm" role="dialog" aria-modal="true" aria-labelledby="widgetDeleteTitle">
      <h3 id="widgetDeleteTitle">Delete Template</h3>
      <p>This removes the local widget template from the library.</p>
      <div class="widget-confirm-actions">
        <button onclick={() => { deleteTemplateId = ''; }}>Cancel</button>
        <button class="danger" onclick={confirmRemoveTemplate}>Delete</button>
      </div>
    </div>
  </div>
{/if}

<div class="widget-store">
  <div class="store-header">
    <LayoutGrid size={20} />
    <h2>Widget Store</h2>
  </div>

  <div class="tabs">
    <button class:active={activeTab === 'presets'} onclick={() => {activeTab = 'presets'; editorMode = 'list'}}>Presets</button>
    <button class:active={activeTab === 'system'} onclick={() => {activeTab = 'system'; editorMode = 'list'}}>
      System <span class="badge">Live</span>
    </button>
    <button class:active={activeTab === 'url'} onclick={() => {activeTab = 'url'; editorMode = 'list'}}>URL</button>
    <button class:active={activeTab === 'custom'} onclick={() => {activeTab = 'custom'; editorMode = 'list'}}>Code</button>
  </div>

  <div class="tab-content">
    {#if activeTab === 'presets'}
      <div class="preset-grid">
        {#each presets as p}
          {@const PresetIcon = p.icon}
          <div class="card">
            <div class="icon-box"><PresetIcon size={24} color="var(--accent-blue)" /></div>
            <div class="info"><span class="title">{p.title}</span><span class="desc">{p.desc}</span></div>
            <button class="add-btn" onclick={() => addPreset(p)}><Plus size={14} /> Add</button>
          </div>
        {/each}
      </div>

    {:else if activeTab === 'system'}
      <div class="preset-grid">
        {#each systemWidgets as s}
          {@const SystemIcon = s.icon}
          <div class="card sys-card">
            <div class="icon-box sys"><SystemIcon size={20} color="#34d399" /></div>
            <div class="info"><span class="title">{s.title}</span><span class="desc">{s.desc}</span></div>
            <button class="add-btn sys-btn" onclick={() => addSystemWidget(s)}><Plus size={14} /> Add</button>
          </div>
        {/each}
      </div>

    {:else if editorMode === 'list'}
      <button class="create-hero-btn" onclick={openCreate}>
        <Plus size={18} /> <span>Create New {activeTab === 'url' ? 'URL' : 'Custom'} Widget</span>
      </button>

      <div class="lib-grid">
        {#each filteredLibrary as item}
          <div class="card lib-card">
            <div class="icon-box lib">
              {#if item.type === 'url'}<Globe size={20} />{:else}<Code size={20} />{/if}
            </div>
            <div class="info">
              <span class="title">{item.title}</span>
              <span class="desc">{item.type === 'url' ? item.source : 'Custom Script'}</span>
            </div>
            <div class="actions">
              <button class="icon-action" onclick={() => instantiate(item)} title="Add to Desktop"><Plus size={16} /></button>
              <button class="icon-action" onclick={() => openEdit(item)} title="Edit"><Edit3 size={16} /></button>
              <button class="icon-action del" onclick={() => removeTemplate(item.id)} title="Delete"><Trash2 size={16} /></button>
            </div>
          </div>
        {/each}
        {#if filteredLibrary.length === 0}
          <div class="empty-state">No saved widgets yet.</div>
        {/if}
      </div>

    {:else}
      <div class="editor-view">
        <div class="editor-header">
          <button class="back-btn" onclick={() => editorMode = 'list'}><ArrowLeft size={16} /></button>
          <h3>{editorMode === 'create' ? 'New' : 'Edit'} Widget</h3>
        </div>
        
        <div class="form-group">
          <label for="widgetTitle">Widget Title</label>
          <input id="widgetTitle" type="text" bind:value={tempTitle} placeholder="e.g. My Website" />
        </div>

        <div class="form-group">
          <label for="widgetSource">{activeTab === 'url' ? 'URL' : 'HTML / JS Content'}</label>
          {#if activeTab === 'url'}
            <input id="widgetSource" type="text" bind:value={tempSource} placeholder="https://example.com" />
          {:else}
            <textarea id="widgetSource" bind:value={tempSource} rows="10" spellcheck="false"></textarea>
          {/if}
        </div>

        <button class="save-btn" onclick={saveItem}>
          <Save size={14} /> {editorMode === 'create' ? 'Create Widget' : 'Save Changes'}
        </button>
      </div>
    {/if}
  </div>

  <div class="active-footer">
    <div class="footer-info">
      <span>Active on Desktop: <strong>{$widgets.length}</strong></span>
    </div>
  </div>
</div>

<style>
  .widget-store { height: 100%; display: flex; flex-direction: column; color: var(--text-main); background: rgba(0,0,0,0.2); }
  .store-header { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-bottom: 1px solid var(--glass-border); }
  .store-header h2 { margin: 0; font-size: 15px; font-weight: 600; }

  .tabs { display: flex; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--glass-border); }
  .tabs button { flex: 1; padding: 10px 4px; background: none; border: none; color: var(--text-dim); font-size: 11px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; }
  .tabs button.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); background: rgba(255,255,255,0.03); }
  .badge { background: rgba(52, 211, 153, 0.2); color: #34d399; font-size: 9px; padding: 1px 4px; border-radius: 10px; margin-left: 4px; }

  .tab-content { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }

  /* Cards */
  .preset-grid, .lib-grid { display: flex; flex-direction: column; gap: 8px; }
  .card { 
    display: flex; align-items: center; gap: 12px; padding: 12px; 
    background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); border-radius: 10px; transition: all 0.2s;
  }
  .card:hover { background: rgba(255,255,255,0.07); transform: translateX(2px); }
  .icon-box { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(88,166,255,0.1); border-radius: 8px; flex-shrink: 0; }
  .icon-box.sys { background: rgba(52, 211, 153, 0.1); }
  .icon-box.lib { background: rgba(255,255,255,0.05); color: var(--text-dim); }
  
  .info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .title { font-size: 13px; font-weight: 600; color: white; }
  .desc { font-size: 10.5px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .add-btn { padding: 6px 12px; background: rgba(88,166,255,0.15); border: 1px solid rgba(88,166,255,0.3); border-radius: 6px; color: var(--accent-blue); font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; }
  .add-btn:hover { background: rgba(88,166,255,0.25); }
  .sys-btn { background: rgba(52,211,153,0.12); border-color: rgba(52,211,153,0.3); color: #34d399; }
  .sys-btn:hover { background: rgba(52,211,153,0.22); }

  /* Library Actions */
  .actions { display: flex; gap: 4px; }
  .icon-action { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 6px; color: var(--text-dim); cursor: pointer; transition: all 0.2s; }
  .icon-action:hover { color: white; background: rgba(255,255,255,0.1); border-color: var(--accent-blue); }
  .icon-action.del:hover { color: #ff5858; border-color: #ff585844; }

  .create-hero-btn { 
    width: 100%; padding: 12px; background: rgba(88,166,255,0.08); border: 1px dashed rgba(88,166,255,0.3); 
    border-radius: 10px; color: var(--accent-blue); font-weight: 600; font-size: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;
  }
  .create-hero-btn:hover { background: rgba(88,166,255,0.12); border-color: var(--accent-blue); }

  /* Editor */
  .editor-view { display: flex; flex-direction: column; gap: 16px; animation: fadeIn 0.2s ease-out; }
  .editor-header { display: flex; align-items: center; gap: 12px; }
  .editor-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--accent-blue); }
  .back-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; display: flex; border-radius: 4px; }
  .back-btn:hover { background: rgba(255,255,255,0.05); color: white; }

  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  .form-group input, .form-group textarea { 
    background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 8px; 
    color: white; padding: 10px 12px; font-size: 13px; outline: none; transition: border-color 0.2s;
  }
  .form-group input:focus, .form-group textarea:focus { border-color: var(--accent-blue); }
  .form-group textarea { font-family: monospace; font-size: 11.5px; line-height: 1.5; resize: vertical; }

  .save-btn { width: 100%; padding: 12px; background: var(--accent-blue); color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: filter 0.2s; }
  .save-btn:hover { filter: brightness(1.2); }

  .empty-state { text-align: center; padding: 40px 0; color: var(--text-dim); font-size: 12px; opacity: 0.6; }

  .active-footer { padding: 12px 20px; border-top: 1px solid var(--glass-border); background: rgba(0,0,0,0.15); font-size: 11px; color: var(--text-dim); }
  .widget-modal-backdrop { position: fixed; inset: 0; z-index: 13000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.42); }
  .widget-confirm { width: min(360px, calc(100vw - 32px)); border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(16, 20, 30, 0.97); padding: 16px; display: grid; gap: 10px; color: var(--text-main); }
  .widget-confirm h3, .widget-confirm p { margin: 0; }
  .widget-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .widget-confirm-actions button { border: 1px solid var(--glass-border); border-radius: 6px; padding: 8px 10px; background: rgba(255,255,255,0.08); color: var(--text-main); cursor: pointer; }
  .widget-confirm-actions button.danger { color: #ff5858; }

  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
</style>
