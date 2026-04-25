<script>
  import { onMount } from 'svelte';
  import { Settings, Image as ImageIcon, Palette, Info, Monitor, Shield, Heart, Folder, Upload, Play, Check, ExternalLink, Save, Trash2 } from 'lucide-svelte';
  import { addToast } from '../../../core/stores/toastStore.js';
  import { systemSettings } from '../../../core/stores/systemStore.js';
  import { themePresets } from '../../../core/stores/themePresetStore.js';
  import { contextMenuSettings } from '../../../core/stores/contextMenuStore.js';
  import { taskbarSettings } from '../../../core/stores/taskbarStore.js';
  import { windowDefaultsSettings } from '../../../core/stores/windowDefaultsStore.js';
  import { apiFetch } from '../../../utils/api.js';
  import { startMenuState, setStartMenuLayout, initStartMenuState } from '../../../core/stores/startMenuStore.js';
  import FilePicker from '../../../core/components/FilePicker.svelte';
  import { fetchWallpaperLibraryItems, uploadWallpaperFile, importWallpaperFromLocalPath } from './api.js';

  let activeTab = $state('personalization');
  let wallpaperList = $state([]);
  let isLoadingList = $state(false);
  let showFilePicker = $state(false);
  let newPresetName = $state('');
  let appBackgroundTarget = $state('files');
  let appBackgroundValue = $state('rgba(10, 14, 22, 0.82)');
  let openWithExtension = $state('');
  let openWithAppId = $state('');
  let desktopApps = $state([]);
  let fileInput = $state(null);
  
  const tabs = [
    { id: 'personalization', title: 'Personalization', icon: Palette },
    { id: 'system', title: 'System', icon: Monitor },
    { id: 'about', title: 'About', icon: Info }
  ];

  async function fetchWallpapers() {
    isLoadingList = true;
    try {
      wallpaperList = await fetchWallpaperLibraryItems();
    } catch (e) {
      console.error(e);
    } finally {
      isLoadingList = false;
    }
  }

  async function uploadWallpaper(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await uploadWallpaperFile(file);
      addToast('Wallpaper uploaded successfully', 'success');
      fetchWallpapers();
    } catch (e) {
      addToast('Upload failed', 'error');
    }
  }

  function selectWallpaper(item) {
    if (!item?.url) return;
    systemSettings.updateSettings({ wallpaper: item.url, wallpaperId: item.id });
  }

  async function handleFileSelected(path) {
    try {
      const imported = await importWallpaperFromLocalPath(path, $systemSettings.wallpaperType);
      systemSettings.updateSettings({ wallpaper: imported.url, wallpaperId: imported.id });
      await fetchWallpapers();
      addToast('Imported to Media Library and applied', 'success');
    } catch (e) {
      addToast(e?.message || 'Import to Media Library failed', 'error');
    } finally {
      showFilePicker = false;
    }
  }

  function buildThemeSettingsSnapshot() {
    return {
      blurIntensity: Number($systemSettings.blurIntensity),
      transparency: Number($systemSettings.transparency),
      accentColor: String($systemSettings.accentColor || '#58a6ff'),
      wallpaperType: String($systemSettings.wallpaperType || 'css'),
      wallpaper: String($systemSettings.wallpaper || ''),
      wallpaperId: String($systemSettings.wallpaperId || ''),
      wallpaperFit: String($systemSettings.wallpaperFit || 'cover')
    };
  }

  function saveCurrentAsThemePreset() {
    const name = String(newPresetName || '').trim();
    if (!name) {
      addToast('Preset name is required', 'error');
      return;
    }
    const created = themePresets.addPreset(name, buildThemeSettingsSnapshot());
    if (!created) {
      addToast('Failed to save preset', 'error');
      return;
    }
    newPresetName = '';
    addToast(`Theme preset "${created.name}" saved`, 'success');
  }

  function applyThemePreset(preset) {
    if (!preset?.settings) return;
    systemSettings.updateSettings({
      blurIntensity: Number(preset.settings.blurIntensity),
      transparency: Number(preset.settings.transparency),
      accentColor: String(preset.settings.accentColor || '#58a6ff'),
      wallpaperType: String(preset.settings.wallpaperType || 'css'),
      wallpaper: String(preset.settings.wallpaper || ''),
      wallpaperId: String(preset.settings.wallpaperId || ''),
      wallpaperFit: String(preset.settings.wallpaperFit || 'cover')
    });
    addToast(`Applied "${preset.name}"`, 'success');
  }

  function removeThemePreset(preset) {
    if (!preset?.id) return;
    themePresets.removePreset(preset.id);
    addToast(`Deleted "${preset.name}"`, 'info');
  }

  function applyAppWindowBackground() {
    const appId = String(appBackgroundTarget || '').trim();
    const background = String(appBackgroundValue || '').trim();
    if (!appId || !background) {
      addToast('App id and background are required', 'error');
      return;
    }
    windowDefaultsSettings.setAppBackground(appId, background);
    addToast(`Window background set for "${appId}"`, 'success');
  }

  function removeAppWindowBackground(appId) {
    windowDefaultsSettings.removeAppBackground(appId);
    addToast(`Window background removed for "${appId}"`, 'info');
  }

  async function loadDesktopApps() {
    try {
      const data = await apiFetch('/api/system/apps');
      desktopApps = (Array.isArray(data) ? data : []).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
      if (!openWithAppId && desktopApps.length > 0) {
        openWithAppId = desktopApps[0].id;
      }
    } catch (error) {
      console.error('Failed to load desktop apps:', error);
      desktopApps = [];
    }
  }

  function setOpenWithMapping() {
    const ext = String(openWithExtension || '').trim().toLowerCase().replace(/^\./, '');
    const appId = String(openWithAppId || '').trim();
    if (!ext || !appId) {
      addToast('Extension and app are required', 'error');
      return;
    }
    const next = {
      ...($contextMenuSettings.openWithByExtension || {}),
      [ext]: appId
    };
    contextMenuSettings.updateSettings({ openWithByExtension: next });
    addToast(`Open With default updated for .${ext}`, 'success');
  }

  function removeOpenWithMapping(ext) {
    const target = String(ext || '').trim().toLowerCase();
    if (!target) return;
    const next = { ...($contextMenuSettings.openWithByExtension || {}) };
    delete next[target];
    contextMenuSettings.updateSettings({ openWithByExtension: next });
    addToast(`Removed Open With default for .${target}`, 'info');
  }

  onMount(() => {
    fetchWallpapers();
    themePresets.init();
    loadDesktopApps();
    initStartMenuState();
  });

  const gradientPresets = [
    { id: 'default', name: 'Standard Blue', color: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)' },
    { id: 'neon', name: 'Cyber Neon', color: 'linear-gradient(135deg, #2a1e3a 0%, #0d1117 100%)' },
    { id: 'nature', name: 'Deep Forest', color: 'linear-gradient(135deg, #1e3a2a 0%, #0d1117 100%)' },
    { id: 'sunset', name: 'Golden Hour', color: 'linear-gradient(135deg, #3a2a1e 0%, #0d1117 100%)' }
  ];
  const windowBackgroundAppOptions = ['files', 'terminal', 'monitor', 'editor', 'docker', 'settings', 'control-panel', 'package-center', 'logs'];
</script>

<div class="control-panel">
  <aside class="sidebar glass-effect">
    <div class="sidebar-header">
      <Settings size={20} />
      <span>Control Panel</span>
    </div>
    <nav>
      {#each tabs as tab}
        {@const TabIcon = tab.icon}
        <button 
          class="tab-btn {activeTab === tab.id ? 'active' : ''}" 
          onclick={() => activeTab = tab.id}
        >
          <TabIcon size={18} />
          <span>{tab.title}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="content-area">
    {#if activeTab === 'personalization'}
      <section class="settings-section">
        <h2>Personalization</h2>
        <p class="panel-note">Desktop appearance lives here. Server/runtime operations are managed in the Settings app.</p>
        
        <div class="setting-group">
          <div class="setting-label">Background Source</div>
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
            <div class="setting-label">Presets</div>
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
              <div class="setting-label">Media Library</div>
              <div class="header-actions">
                <button class="action-btn-outline" onclick={() => showFilePicker = true}>
                  <ExternalLink size={14} /> Browse Local Files
                </button>
                <button class="upload-action-btn" onclick={() => fileInput.click()}>
                  <Upload size={14} /> Upload New
                </button>
              </div>
              <input type="file" bind:this={fileInput} hidden onchange={uploadWallpaper} accept={$systemSettings.wallpaperType === 'video' ? 'video/*' : 'image/*'} />
            </div>

            <div class="gallery-grid">
              {#each wallpaperList as item}
                {#if ($systemSettings.wallpaperType === 'video' && item.kind === 'video') || ($systemSettings.wallpaperType === 'image' && item.kind === 'image')}
                  <button 
                    class="gallery-item {$systemSettings.wallpaperId === item.id ? 'active' : ''}"
                    onclick={() => selectWallpaper(item)}
                  >
                    {#if $systemSettings.wallpaperType === 'video'}
                      <div class="video-preview">
                        <Play size={20} />
                      </div>
                    {:else}
                      <img src={item.url} alt={item.name} loading="lazy" />
                    {/if}
                    
                    {#if $systemSettings.wallpaperId === item.id}
                      <div class="active-check"><Check size={16} /></div>
                    {/if}
                    <span class="wp-name">{item.name}</span>
                  </button>
                {/if}
              {/each}
              
              {#if wallpaperList.length === 0 && !isLoadingList}
                <div class="empty-gallery">
                  <Folder size={32} />
                  <p>No {$systemSettings.wallpaperType === 'video' ? 'videos' : 'images'} found in Media Library</p>
                </div>
              {/if}
            </div>
          </div>

          <div class="setting-group">
            <label for="wallpaperUrl">Or manually enter URL</label>
            <div class="url-input-container">
              <input 
                id="wallpaperUrl"
                type="text" 
                placeholder="https://example.com/custom.png"
                value={$systemSettings.wallpaper}
                onchange={(e) => systemSettings.updateSettings({ wallpaper: e.target.value, wallpaperId: 'custom' })}
              />
            </div>
          </div>

          <div class="setting-group">
            <div class="setting-label">Display Mode</div>
            <div class="type-selector">
              <button class:active={$systemSettings.wallpaperFit === 'cover' || !$systemSettings.wallpaperFit} onclick={() => systemSettings.updateSettings({ wallpaperFit: 'cover' })}>Fill</button>
              <button class:active={$systemSettings.wallpaperFit === 'contain'} onclick={() => systemSettings.updateSettings({ wallpaperFit: 'contain' })}>Fit</button>
              <button class:active={$systemSettings.wallpaperFit === 'stretch'} onclick={() => systemSettings.updateSettings({ wallpaperFit: 'stretch' })}>Stretch</button>
              <button class:active={$systemSettings.wallpaperFit === 'center'} onclick={() => systemSettings.updateSettings({ wallpaperFit: 'center' })}>Original</button>
              <button class:active={$systemSettings.wallpaperFit === 'tile'} onclick={() => systemSettings.updateSettings({ wallpaperFit: 'tile' })}>Tile</button>
            </div>
          </div>
        {/if}

        <div class="setting-divider"></div>

        <div class="setting-group">
          <label for="glassBlur">Glassmorphism Blur ({$systemSettings.blurIntensity}px)</label>
          <input 
            id="glassBlur"
            type="range" min="0" max="40" 
            value={$systemSettings.blurIntensity} 
            oninput={(e) => systemSettings.updateSettings({ blurIntensity: parseInt(e.target.value) })} 
          />
        </div>

        <div class="setting-group">
          <label for="transparency">Transparency ({Math.round($systemSettings.transparency * 100)}%)</label>
          <input 
            id="transparency"
            type="range" min="0.05" max="0.5" step="0.01" 
            value={$systemSettings.transparency} 
            oninput={(e) => systemSettings.updateSettings({ transparency: parseFloat(e.target.value) })} 
          />
        </div>

        <div class="setting-group">
          <label for="accentColor">Accent Color</label>
          <div class="color-picker">
            <input 
              id="accentColor"
              type="color" 
              value={$systemSettings.accentColor} 
              oninput={(e) => systemSettings.updateSettings({ accentColor: e.target.value })} 
            />
            <span class="color-value">{$systemSettings.accentColor}</span>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">Theme Presets</div>
          <div class="taskbar-settings glass-effect theme-preset-panel">
            <div class="theme-preset-create">
              <input
                type="text"
                placeholder="Preset name"
                value={newPresetName}
                oninput={(e) => newPresetName = e.target.value}
              />
              <button class="btn-save-preset" onclick={saveCurrentAsThemePreset}>
                <Save size={14} />
                Save Current
              </button>
            </div>
            {#if $themePresets.length === 0}
              <div class="theme-preset-empty">No saved presets.</div>
            {:else}
              <div class="theme-preset-list">
                {#each $themePresets as preset}
                  <div class="theme-preset-row">
                    <div class="theme-preset-meta">
                      <strong>{preset.name}</strong>
                      <span>{new Date(preset.createdAt || Date.now()).toLocaleString()}</span>
                    </div>
                    <div class="theme-preset-actions">
                      <button class="pill-btn active" onclick={() => applyThemePreset(preset)}>Apply</button>
                      <button class="pill-btn danger" onclick={() => removeThemePreset(preset)}>
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="setting-divider"></div>

        <div class="setting-group">
          <div class="setting-label">Start Menu</div>
          <div class="taskbar-settings glass-effect">
            <div class="taskbar-row">
              <span>Layout</span>
              <div class="size-segment">
                <button
                  class:active={$startMenuState.layout === 'default'}
                  onclick={() => setStartMenuLayout('default')}
                >
                  Default
                </button>
                <button
                  class:active={$startMenuState.layout === 'compact'}
                  onclick={() => setStartMenuLayout('compact')}
                >
                  Compact
                </button>
                <button
                  class:active={$startMenuState.layout === 'wide'}
                  onclick={() => setStartMenuLayout('wide')}
                >
                  Wide
                </button>
              </div>
            </div>
            <div class="taskbar-row">
              <span>Pinned apps</span>
              <span>{Array.isArray($startMenuState.pinnedAppIds) ? $startMenuState.pinnedAppIds.length : 0}</span>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">Taskbar</div>
          <div class="taskbar-settings glass-effect">
            <div class="taskbar-row">
              <span>Compact mode</span>
              <button
                class="toggle-btn {$taskbarSettings.compactMode ? 'active' : ''}"
                onclick={() => taskbarSettings.updateSettings({ compactMode: !$taskbarSettings.compactMode })}
              >
                {$taskbarSettings.compactMode ? 'On' : 'Off'}
              </button>
            </div>

            <div class="taskbar-row">
              <span>Icon size</span>
              <div class="size-segment">
                <button
                  class:active={$taskbarSettings.iconSize === 'sm'}
                  onclick={() => taskbarSettings.updateSettings({ iconSize: 'sm' })}
                >
                  S
                </button>
                <button
                  class:active={$taskbarSettings.iconSize === 'md'}
                  onclick={() => taskbarSettings.updateSettings({ iconSize: 'md' })}
                >
                  M
                </button>
                <button
                  class:active={$taskbarSettings.iconSize === 'lg'}
                  onclick={() => taskbarSettings.updateSettings({ iconSize: 'lg' })}
                >
                  L
                </button>
              </div>
            </div>

            <div class="taskbar-row wrap">
              <span>Visible sections</span>
              <div class="pill-toggles">
                <button
                  class="pill-btn {$taskbarSettings.showStartButton ? 'active' : ''}"
                  onclick={() => taskbarSettings.updateSettings({ showStartButton: !$taskbarSettings.showStartButton })}
                >
                  Start
                </button>
                <button
                  class="pill-btn {$taskbarSettings.showDesktopSwitcher ? 'active' : ''}"
                  onclick={() => taskbarSettings.updateSettings({ showDesktopSwitcher: !$taskbarSettings.showDesktopSwitcher })}
                >
                  Desktops
                </button>
                <button
                  class="pill-btn {$taskbarSettings.showSearch ? 'active' : ''}"
                  onclick={() => taskbarSettings.updateSettings({ showSearch: !$taskbarSettings.showSearch })}
                >
                  Search
                </button>
                <button
                  class="pill-btn {$taskbarSettings.showSystemTray ? 'active' : ''}"
                  onclick={() => taskbarSettings.updateSettings({ showSystemTray: !$taskbarSettings.showSystemTray })}
                >
                  Tray
                </button>
                <button
                  class="pill-btn {$taskbarSettings.showClock ? 'active' : ''}"
                  onclick={() => taskbarSettings.updateSettings({ showClock: !$taskbarSettings.showClock })}
                  disabled={!$taskbarSettings.showSystemTray}
                >
                  Clock
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">Window Defaults</div>
          <div class="taskbar-settings glass-effect window-defaults">
            <div class="taskbar-row">
              <span>Default size</span>
              <div class="number-pair">
                <input
                  type="number"
                  min="320"
                  max="3840"
                  value={$windowDefaultsSettings.defaultWidth}
                  onchange={(e) => windowDefaultsSettings.updateSettings({ defaultWidth: Number(e.target.value) })}
                />
                <span>x</span>
                <input
                  type="number"
                  min="240"
                  max="2160"
                  value={$windowDefaultsSettings.defaultHeight}
                  onchange={(e) => windowDefaultsSettings.updateSettings({ defaultHeight: Number(e.target.value) })}
                />
              </div>
            </div>

            <div class="taskbar-row">
              <span>Minimum size</span>
              <div class="number-pair">
                <input
                  type="number"
                  min="240"
                  max="1920"
                  value={$windowDefaultsSettings.minWidth}
                  onchange={(e) => windowDefaultsSettings.updateSettings({ minWidth: Number(e.target.value) })}
                />
                <span>x</span>
                <input
                  type="number"
                  min="180"
                  max="1080"
                  value={$windowDefaultsSettings.minHeight}
                  onchange={(e) => windowDefaultsSettings.updateSettings({ minHeight: Number(e.target.value) })}
                />
              </div>
            </div>

            <div class="taskbar-row">
              <span>Title bar height</span>
              <input
                class="number-input"
                type="number"
                min="28"
                max="72"
                value={$windowDefaultsSettings.titleBarHeight}
                onchange={(e) => windowDefaultsSettings.updateSettings({ titleBarHeight: Number(e.target.value) })}
              />
            </div>

            <div class="taskbar-row wrap">
              <span>Behavior</span>
              <div class="pill-toggles">
                <button
                  class="pill-btn {$windowDefaultsSettings.rememberLastSize ? 'active' : ''}"
                  onclick={() => windowDefaultsSettings.updateSettings({ rememberLastSize: !$windowDefaultsSettings.rememberLastSize })}
                >
                  Remember size
                </button>
                <button
                  class="pill-btn {$windowDefaultsSettings.rememberLastPosition ? 'active' : ''}"
                  onclick={() => windowDefaultsSettings.updateSettings({ rememberLastPosition: !$windowDefaultsSettings.rememberLastPosition })}
                >
                  Remember position
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">Context Menu</div>
          <div class="taskbar-settings glass-effect">
            <div class="taskbar-row">
              <span>Show icons</span>
              <button
                class="toggle-btn {$contextMenuSettings.showIcons ? 'active' : ''}"
                onclick={() => contextMenuSettings.updateSettings({ showIcons: !$contextMenuSettings.showIcons })}
              >
                {$contextMenuSettings.showIcons ? 'On' : 'Off'}
              </button>
            </div>

            <div class="taskbar-row">
              <span>Confirm dangerous actions</span>
              <button
                class="toggle-btn {$contextMenuSettings.confirmDanger ? 'active' : ''}"
                onclick={() => contextMenuSettings.updateSettings({ confirmDanger: !$contextMenuSettings.confirmDanger })}
              >
                {$contextMenuSettings.confirmDanger ? 'On' : 'Off'}
              </button>
            </div>

            <div class="taskbar-row">
              <span>Density</span>
              <div class="size-segment">
                <button
                  class:active={$contextMenuSettings.density === 'compact'}
                  onclick={() => contextMenuSettings.updateSettings({ density: 'compact' })}
                >
                  Compact
                </button>
                <button
                  class:active={$contextMenuSettings.density === 'cozy'}
                  onclick={() => contextMenuSettings.updateSettings({ density: 'cozy' })}
                >
                  Cozy
                </button>
              </div>
            </div>

            <div class="taskbar-row wrap">
              <span>Open With Defaults</span>
              <div class="ops-inline">
                <input
                  type="text"
                  value={openWithExtension}
                  placeholder="extension (e.g. fbx)"
                  oninput={(e) => openWithExtension = e.currentTarget.value}
                />
                <select value={openWithAppId} onchange={(e) => openWithAppId = e.currentTarget.value}>
                  {#each desktopApps as app}
                    <option value={app.id}>{app.title} ({app.id})</option>
                  {/each}
                </select>
                <button class="btn-save-preset" onclick={setOpenWithMapping}>Set</button>
              </div>
            </div>
            {#if Object.keys($contextMenuSettings.openWithByExtension || {}).length > 0}
              <div class="theme-preset-list">
                {#each Object.entries($contextMenuSettings.openWithByExtension || {}) as [ext, appId]}
                  <div class="theme-preset-row">
                    <div class="theme-preset-meta">
                      <strong>.{ext}</strong>
                      <span>{appId}</span>
                    </div>
                    <div class="theme-preset-actions">
                      <button class="pill-btn danger" onclick={() => removeOpenWithMapping(ext)}>
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="setting-group">
          <div class="setting-label">App-specific Window Backgrounds</div>
          <div class="taskbar-settings glass-effect">
            <div class="taskbar-row wrap">
              <span>Target app</span>
              <div class="ops-inline">
                <select value={appBackgroundTarget} onchange={(e) => appBackgroundTarget = e.currentTarget.value}>
                  {#each windowBackgroundAppOptions as appId}
                    <option value={appId}>{appId}</option>
                  {/each}
                </select>
                <input
                  type="text"
                  value={appBackgroundValue}
                  placeholder="rgba(...) or linear-gradient(...)"
                  oninput={(e) => appBackgroundValue = e.currentTarget.value}
                />
                <button class="btn-save-preset" onclick={applyAppWindowBackground}>Apply</button>
              </div>
            </div>

            {#if Object.keys($windowDefaultsSettings.appBackgrounds || {}).length === 0}
              <div class="theme-preset-empty">No app-specific backgrounds.</div>
            {:else}
              <div class="theme-preset-list">
                {#each Object.entries($windowDefaultsSettings.appBackgrounds || {}) as [appId, background]}
                  <div class="theme-preset-row">
                    <div class="theme-preset-meta">
                      <strong>{appId}</strong>
                      <span>{background}</span>
                    </div>
                    <div class="theme-preset-actions">
                      <button
                        class="pill-btn"
                        onclick={() => {
                          appBackgroundTarget = appId;
                          appBackgroundValue = background;
                        }}
                      >
                        Load
                      </button>
                      <button class="pill-btn danger" onclick={() => removeAppWindowBackground(appId)}>
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
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
    filter={$systemSettings.wallpaperType === 'video' ? ['mp4', 'webm'] : ['jpg', 'jpeg', 'png', 'webp', 'gif']} 
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
  .panel-note { margin: -10px 0 16px; color: var(--text-dim); font-size: 13px; }
  
  .setting-group { margin-bottom: 24px; display: flex; flex-direction: column; gap: 10px; }
  .setting-group label,
  .setting-label { font-size: 14px; font-weight: 600; color: var(--text-secondary); }
  
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

  .taskbar-settings {
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .taskbar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .taskbar-row.wrap {
    align-items: flex-start;
  }
  .toggle-btn {
    border: 1px solid var(--glass-border);
    background: transparent;
    color: var(--text-dim);
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .toggle-btn.active {
    color: white;
    border-color: rgba(88, 166, 255, 0.6);
    background: rgba(88, 166, 255, 0.2);
  }
  .size-segment {
    display: inline-flex;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .size-segment button {
    border: none;
    background: transparent;
    color: var(--text-dim);
    width: 34px;
    height: 28px;
    font-size: 12px;
    cursor: pointer;
  }
  .size-segment button.active {
    background: rgba(88, 166, 255, 0.2);
    color: white;
  }
  .pill-toggles {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }
  .pill-btn {
    border: 1px solid var(--glass-border);
    border-radius: 999px;
    padding: 4px 10px;
    background: transparent;
    color: var(--text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .pill-btn.active {
    color: white;
    border-color: rgba(88, 166, 255, 0.6);
    background: rgba(88, 166, 255, 0.18);
  }
  .pill-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .window-defaults .number-pair {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .window-defaults .number-pair input,
  .window-defaults .number-input {
    width: 72px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--glass-border);
    color: white;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .ops-inline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .ops-inline select,
  .ops-inline input {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--glass-border);
    color: white;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
    min-width: 140px;
  }
  .theme-preset-panel {
    gap: 12px;
  }
  .theme-preset-create {
    display: flex;
    gap: 8px;
  }
  .theme-preset-create input {
    flex: 1;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--glass-border);
    color: white;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
  }
  .btn-save-preset {
    border: 1px solid rgba(88, 166, 255, 0.55);
    background: rgba(88, 166, 255, 0.2);
    color: white;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .theme-preset-empty {
    font-size: 12px;
    color: var(--text-dim);
  }
  .theme-preset-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .theme-preset-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.02);
  }
  .theme-preset-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .theme-preset-meta strong {
    font-size: 12px;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .theme-preset-meta span {
    font-size: 11px;
    color: var(--text-dim);
  }
  .theme-preset-actions {
    display: inline-flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .pill-btn.danger {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-color: rgba(248, 81, 73, 0.4);
    color: #fca5a5;
  }

  /* Custom Scrollbar */
  .content-area::-webkit-scrollbar { width: 6px; }
  .content-area::-webkit-scrollbar-track { background: transparent; }
  .content-area::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 3px; }
</style>
