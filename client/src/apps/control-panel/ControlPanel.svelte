<script>
  import { onMount } from 'svelte';
  import { Settings, Image as ImageIcon, Palette, Info, Monitor, Shield, Trash2, Heart, Plus, Folder, Upload, Play, Check, ExternalLink } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import { systemSettings } from '../../core/stores/systemStore.js';
  import FilePicker from '../../core/components/FilePicker.svelte';

  let activeTab = $state('personalization');
  let wallpaperList = $state([]);
  let isLoadingList = $state(false);
  let showFilePicker = $state(false);
  let fileInput;
  
  const tabs = [
    { id: 'personalization', title: 'Personalization', icon: Palette },
    { id: 'system', title: 'System', icon: Monitor },
    { id: 'security', title: 'Security', icon: Shield },
    { id: 'about', title: 'About', icon: Info }
  ];

  async function fetchWallpapers() {
    isLoadingList = true;
    try {
      const token = localStorage.getItem('web_os_token') || '';
      const res = await fetch('/api/system/wallpapers/list', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        wallpaperList = json.data;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingList = false;
    }
  }

  async function uploadWallpaper(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('web_os_token') || '';
      const res = await fetch('/api/system/wallpapers/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const json = await res.json();
      if (json.success) {
        addToast('Wallpaper uploaded successfully', 'success');
        fetchWallpapers();
      }
    } catch (e) {
      addToast('Upload failed', 'error');
    }
  }

  function selectWallpaper(file) {
    const url = `/api/inventory-files/wallpapers/${file}`;
    systemSettings.updateSettings({ wallpaper: url, wallpaperId: file });
  }

  function handleFileSelected(path) {
    // Convert absolute path to a URL the browser can access
    const url = `/api/fs/raw?path=${encodeURIComponent(path)}`;
    systemSettings.updateSettings({ wallpaper: url, wallpaperId: path });
    showFilePicker = false;
    addToast('Wallpaper applied from Inventory', 'success');
  }

  onMount(() => {
    fetchWallpapers();
  });

  const gradientPresets = [
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
          <label>Background Source</label>
          <div class="type-selector">
            <button class:active={$systemSettings.wallpaperType === 'css'} onclick={() => systemSettings.updateSettings({ wallpaperType: 'css' })}>
              <Palette size={14} /> Gradient
            </button>
            <button class:active={$systemSettings.wallpaperType === 'image'} onclick={() => systemSettings.updateSettings({ wallpaperType: 'image' })}>
              <ImageIcon size={14} /> My Images
            </button>
            <button class:active={$systemSettings.wallpaperType === 'video'} onclick={() => systemSettings.updateSettings({ wallpaperType: 'video' })}>
              <Play size={14} /> My Videos
            </button>
          </div>
        </div>

        {#if $systemSettings.wallpaperType === 'css'}
          <div class="setting-group">
            <label>Presets</label>
            <div class="wallpaper-grid">
              {#each gradientPresets as wp}
                <button 
                  class="wallpaper-item {$systemSettings.wallpaperId === wp.id ? 'active' : ''}"
                  style="background: {wp.color}"
                  onclick={() => systemSettings.updateSettings({ wallpaper: wp.color, wallpaperId: wp.id })}
                >
                  {#if $systemSettings.wallpaperId === wp.id}
                    <div class="active-check"><Check size={16} /></div>
                  {/if}
                  <span class="wp-name">{wp.name}</span>
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <div class="setting-group">
            <div class="lib-header">
              <label>Inventory Gallery</label>
              <div class="header-actions">
                <button class="action-btn-outline" onclick={() => showFilePicker = true}>
                  <ExternalLink size={14} /> Browse from Files
                </button>
                <button class="upload-action-btn" onclick={() => fileInput.click()}>
                  <Upload size={14} /> Upload New
                </button>
              </div>
              <input type="file" bind:this={fileInput} hidden onchange={uploadWallpaper} accept={$systemSettings.wallpaperType === 'video' ? 'video/*' : 'image/*'} />
            </div>

            <div class="gallery-grid">
              {#each wallpaperList as file}
                {#if ($systemSettings.wallpaperType === 'video' && /\.(mp4|webm)$/i.test(file)) || ($systemSettings.wallpaperType === 'image' && /\.(jpg|jpeg|png|webp|gif)$/i.test(file))}
                  <button 
                    class="gallery-item {$systemSettings.wallpaperId === file ? 'active' : ''}"
                    onclick={() => selectWallpaper(file)}
                  >
                    {#if $systemSettings.wallpaperType === 'video'}
                      <div class="video-preview">
                        <Play size={20} />
                      </div>
                    {:else}
                      <img src="/api/inventory-files/wallpapers/{file}" alt={file} loading="lazy" />
                    {/if}
                    
                    {#if $systemSettings.wallpaperId === file}
                      <div class="active-check"><Check size={16} /></div>
                    {/if}
                    <span class="wp-name">{file}</span>
                  </button>
                {/if}
              {/each}
              
              {#if wallpaperList.length === 0 && !isLoadingList}
                <div class="empty-gallery">
                  <Folder size={32} />
                  <p>No {$systemSettings.wallpaperType === 'video' ? 'videos' : 'images'} found in Inventory/wallpapers</p>
                </div>
              {/if}
            </div>
          </div>

          <div class="setting-group">
            <label>Or manually enter URL</label>
            <div class="url-input-container">
              <input 
                type="text" 
                placeholder="https://example.com/custom.png"
                value={$systemSettings.wallpaper}
                onchange={(e) => systemSettings.updateSettings({ wallpaper: e.target.value, wallpaperId: 'custom' })}
              />
            </div>
          </div>
        {/if}

        <div class="setting-divider"></div>

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

{#if showFilePicker}
  <FilePicker 
    filter={$systemSettings.wallpaperType === 'video' ? ['mp4', 'webm', 'mov'] : ['jpg', 'jpeg', 'png', 'webp', 'gif']} 
    onSelect={handleFileSelected} 
    onCancel={() => showFilePicker = false} 
  />
{/if}

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
  
  .setting-divider { height: 1px; background: var(--glass-border); margin: 30px 0; }

  input[type="range"] { width: 100%; accent-color: var(--accent-blue); height: 6px; border-radius: 3px; cursor: pointer; }
  
  .wallpaper-grid, .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; }
  
  .wallpaper-item, .gallery-item { 
    height: 90px; border-radius: 10px; border: 2px solid transparent; cursor: pointer; 
    position: relative; overflow: hidden; transition: all 0.2s; background: rgba(0,0,0,0.3);
  }
  
  .gallery-item img { width: 100%; height: 100%; object-fit: cover; }
  .video-preview { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(88,166,255,0.1); color: var(--accent-blue); }

  .wallpaper-item:hover, .gallery-item:hover { transform: translateY(-3px); box-shadow: 0 8px 16px rgba(0,0,0,0.4); }
  .wallpaper-item.active, .gallery-item.active { border-color: var(--accent-blue); box-shadow: 0 0 15px rgba(88, 166, 255, 0.4); }
  
  .active-check { position: absolute; top: 8px; right: 8px; background: var(--accent-blue); color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 2px solid rgba(255,255,255,0.2); z-index: 2; }

  .wp-name { position: absolute; bottom: 0; left: 0; width: 100%; padding: 6px; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); font-size: 10px; color: white; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .lib-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .header-actions { display: flex; gap: 8px; }
  .upload-action-btn { background: rgba(88,166,255,0.1); border: 1px dashed var(--accent-blue); color: var(--accent-blue); padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
  .upload-action-btn:hover { background: rgba(88,166,255,0.2); transform: translateY(-1px); }
  
  .action-btn-outline { background: transparent; border: 1px solid var(--glass-border); color: var(--text-secondary); padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
  .action-btn-outline:hover { background: rgba(255,255,255,0.05); color: white; }

  .color-picker { display: flex; align-items: center; gap: 12px; }
  input[type="color"] { border: none; width: 40px; height: 40px; border-radius: 8px; background: transparent; cursor: pointer; }
  .color-value { font-family: monospace; font-size: 14px; color: var(--text-dim); }

  .type-selector { display: flex; gap: 8px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 10px; border: 1px solid var(--glass-border); }
  .type-selector button { flex: 1; padding: 10px; border: none; background: transparent; color: var(--text-dim); border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .type-selector button:hover { color: white; background: rgba(255,255,255,0.05); }
  .type-selector button.active { background: var(--accent-blue); color: white; box-shadow: 0 2px 8px rgba(88, 166, 255, 0.3); }

  .url-input-container { display: flex; gap: 8px; }
  .url-input-container input { flex: 1; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: white; padding: 10px 14px; border-radius: 8px; font-size: 13px; font-family: monospace; outline: none; }
  
  .empty-gallery { grid-column: 1 / -1; padding: 40px; border: 2px dashed var(--glass-border); border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-dim); opacity: 0.6; }
  .empty-gallery p { margin: 0; font-size: 13px; }

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
