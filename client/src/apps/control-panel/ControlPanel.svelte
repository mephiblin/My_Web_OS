<script>
  import { Settings, Image, Palette, Info, Monitor, Shield, Trash2, Heart } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import { systemSettings } from '../../core/stores/systemStore.js';

  let activeTab = $state('personalization');
  
  const tabs = [
    { id: 'personalization', title: 'Personalization', icon: Palette },
    { id: 'system', title: 'System', icon: Monitor },
    { id: 'security', title: 'Security', icon: Shield },
    { id: 'about', title: 'About', icon: Info }
  ];

  function applySettings() {
    // Already handled by systemSettings.updateSettings in the UI
    addToast('Settings synchronized', 'success');
  }

  const wallpapers = [
    { id: 'default', name: 'Standard Blue', color: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)' },
    { id: 'neon', name: 'Cyber Neon', color: 'linear-gradient(135deg, #2a1e3a 0%, #0d1117 100%)' },
    { id: 'nature', name: 'Deep Forest', color: 'linear-gradient(135deg, #1e3a2a 0%, #0d1117 100%)' },
    { id: 'sunset', name: 'Golden Hour', color: 'linear-gradient(135deg, #3a2a1e 0%, #0d1117 100%)' }
  ];
</script>

<div class="control-panel">
  <aside class="sidebar glass-effect">
    <div class="sidebar-header">
      <Settings size={20} />
      <span>Settings</span>
    </div>
    <nav>
      {#each tabs as tab}
        <button 
          class="tab-btn {activeTab === tab.id ? 'active' : ''}" 
          onclick={() => activeTab = tab.id}
        >
          <svelte:component this={tab.icon} size={18} />
          <span>{tab.title}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="content-area">
    {#if activeTab === 'personalization'}
      <section class="settings-section">
        <h2>Personalization</h2>
        
        <div class="setting-group">
          <label>Wallpaper Type</label>
          <div class="type-selector">
            <button class:active={$systemSettings.wallpaperType === 'css'} onclick={() => systemSettings.updateSettings({ wallpaperType: 'css' })}>Gradient</button>
            <button class:active={$systemSettings.wallpaperType === 'image'} onclick={() => systemSettings.updateSettings({ wallpaperType: 'image' })}>Image</button>
            <button class:active={$systemSettings.wallpaperType === 'video'} onclick={() => systemSettings.updateSettings({ wallpaperType: 'video' })}>Video (MP4/WebM)</button>
          </div>
        </div>

        {#if $systemSettings.wallpaperType === 'css'}
          <div class="setting-group">
            <label>Presets</label>
            <div class="wallpaper-grid">
              {#each wallpapers as wp}
                <button 
                  class="wallpaper-item {$systemSettings.wallpaperId === wp.id ? 'active' : ''}"
                  style="background: {wp.color}"
                  onclick={() => systemSettings.updateSettings({ wallpaper: wp.color, wallpaperId: wp.id })}
                >
                  <span class="wp-name">{wp.name}</span>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="setting-group">
            <label>{$systemSettings.wallpaperType === 'video' ? 'Video' : 'Image'} URL</label>
            <div class="url-input-container">
              <input 
                type="text" 
                placeholder="https://example.com/background.mp4"
                value={$systemSettings.wallpaper}
                onchange={(e) => systemSettings.updateSettings({ wallpaper: e.target.value, wallpaperId: 'custom' })}
              />
            </div>
            <p class="hint">Enter a direct URL to a {$systemSettings.wallpaperType === 'video' ? 'WebM or MP4' : 'JPG or PNG'} file.</p>
          </div>
        {/if}

        <div class="setting-group">
          <label>Glassmorphism Blur ({$systemSettings.blurIntensity}px)</label>
          <input 
            type="range" min="0" max="40" 
            value={$systemSettings.blurIntensity} 
            oninput={(e) => systemSettings.updateSettings({ blurIntensity: parseInt(e.target.value) })} 
          />
        </div>

        <div class="setting-group">
          <label>Transparency ({Math.round($systemSettings.transparency * 100)}%)</label>
          <input 
            type="range" min="0.05" max="0.5" step="0.01" 
            value={$systemSettings.transparency} 
            oninput={(e) => systemSettings.updateSettings({ transparency: parseFloat(e.target.value) })} 
          />
        </div>

        <div class="setting-group">
          <label>Accent Color</label>
          <div class="color-picker">
            <input 
              type="color" 
              value={$systemSettings.accentColor} 
              oninput={(e) => systemSettings.updateSettings({ accentColor: e.target.value })} 
            />
            <span class="color-value">{$systemSettings.accentColor}</span>
          </div>
        </div>
      </section>
    {:else if activeTab === 'system'}
      <section class="settings-section">
        <h2>System Information</h2>
        <div class="info-card glass-effect">
          <div class="info-item">
            <span class="label">OS Version:</span>
            <span class="value">Web OS v3.0 (Cyber-Zen)</span>
          </div>
          <div class="info-item">
            <span class="label">Kernel:</span>
            <span class="value">DeepMind Agent Core v1.4</span>
          </div>
          <div class="info-item">
            <span class="label">Environment:</span>
            <span class="value">Browser Hybrid Runtime</span>
          </div>
        </div>
      </section>
    {:else if activeTab === 'about'}
      <section class="settings-section about">
        <div class="logo-area">
          <Shield size={64} color="var(--accent-blue)" />
          <h1>Antigravity OS</h1>
          <p class="tagline">Next-Generation Web Operating System</p>
        </div>
        <p class="desc">A professional desktop environment built with Svelte 5 and Three.js, focusing on performance, aesthetics, and agentic workflows.</p>
        <div class="credits">
          <span>Made with</span>
          <Heart size={14} fill="#f44336" color="#f44336" />
          <span>by DeepMind Advanced Agentic Coding Team</span>
        </div>
      </section>
    {:else}
      <div class="empty-state">
        <Monitor size={48} />
        <p>Section under development</p>
      </div>
    {/if}
  </main>
</div>

<style>
  .control-panel { display: flex; height: 100%; overflow: hidden; background: rgba(0,0,0,0.2); }
  
  .sidebar { width: 200px; padding: 20px 10px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid var(--glass-border); }
  .sidebar-header { display: flex; align-items: center; gap: 10px; padding: 0 10px; font-weight: 600; color: var(--text-primary); }
  
  nav { display: flex; flex-direction: column; gap: 4px; }
  .tab-btn { 
    display: flex; align-items: center; gap: 12px; padding: 10px 15px; background: transparent; 
    border: none; color: var(--text-dim); border-radius: 8px; cursor: pointer; transition: all 0.2s;
    text-align: left;
  }
  .tab-btn:hover { background: rgba(255, 255, 255, 0.05); color: white; }
  .tab-btn.active { background: var(--accent-blue); color: white; box-shadow: 0 4px 12px rgba(88, 166, 255, 0.3); }

  .content-area { flex: 1; padding: 30px; overflow-y: auto; }
  
  h2 { font-size: 24px; font-weight: 700; margin-bottom: 24px; color: var(--text-primary); }
  
  .setting-group { margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px; }
  .setting-group label { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
  
  input[type="range"] { width: 100%; accent-color: var(--accent-blue); height: 6px; border-radius: 3px; cursor: pointer; }
  
  .wallpaper-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
  .wallpaper-item { 
    height: 80px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; 
    position: relative; overflow: hidden; transition: all 0.2s;
  }
  .wallpaper-item:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  .wallpaper-item.active { border-color: var(--accent-blue); box-shadow: 0 0 15px rgba(88, 166, 255, 0.4); }
  .wp-name { position: absolute; bottom: 0; left: 0; width: 100%; padding: 4px; background: rgba(0,0,0,0.5); font-size: 10px; color: white; text-align: center; }

  .color-picker { display: flex; align-items: center; gap: 12px; }
  input[type="color"] { border: none; width: 40px; height: 40px; border-radius: 8px; background: transparent; cursor: pointer; }
  .color-value { font-family: monospace; font-size: 14px; color: var(--text-dim); }

  .type-selector { display: flex; gap: 8px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 10px; border: 1px solid var(--glass-border); }
  .type-selector button { flex: 1; padding: 8px; border: none; background: transparent; color: var(--text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s; }
  .type-selector button:hover { color: white; background: rgba(255,255,255,0.05); }
  .type-selector button.active { background: var(--accent-blue); color: white; box-shadow: 0 2px 8px rgba(88, 166, 255, 0.3); }

  .url-input-container { display: flex; gap: 8px; }
  .url-input-container input { flex: 1; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: white; padding: 10px 14px; border-radius: 8px; font-size: 13px; font-family: monospace; outline: none; }
  .url-input-container input:focus { border-color: var(--accent-blue); }
  
  .hint { font-size: 11px; color: var(--text-dim); margin: 0; line-height: 1.4; opacity: 0.7; }

  .info-card { padding: 20px; border-radius: 12px; display: flex; flex-direction: column; gap: 12px; }
  .info-item { display: flex; gap: 10px; font-size: 14px; }
  .info-item .label { color: var(--text-dim); width: 120px; }
  .info-item .value { font-weight: 600; color: var(--text-primary); }

  .about { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 20px; padding-top: 40px; }
  .tagline { font-size: 18px; color: var(--accent-blue); font-weight: 500; }
  .desc { max-width: 500px; line-height: 1.6; color: var(--text-dim); }
  .credits { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 13px; margin-top: 20px; }

  .empty-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-dim); opacity: 0.5; gap: 16px; }

  /* Custom Scrollbar */
  .content-area::-webkit-scrollbar { width: 6px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }
</style>
