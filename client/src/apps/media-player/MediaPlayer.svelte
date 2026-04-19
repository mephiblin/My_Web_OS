<script>
  import { onMount } from 'svelte';
  import { Play, Pause, Volume2, Maximize, Music, Video, Info, RefreshCw } from 'lucide-svelte';
  import { addToast } from '../../core/stores/toastStore.js';
  import { activeWindowId, windows, updateWindowTitle } from '../../core/stores/windowStore.js';
  import { apiFetch } from '../../utils/api.js';
  import { API_BASE } from '../../utils/constants.js';

  let { data = {} } = $props();
  
  // Synchronized state for navigation
  let currentPath = $state(data.path || '');
  let lastPropPath = $state(data.path || '');
  let mediaPath = $derived(currentPath);
  
  let isVideo = $derived(mediaPath.match(/\.(mp4|webm|mkv|mov|avi)$/i));
  let isAudio = $derived(mediaPath.match(/\.(mp3|wav|ogg|flac|m4a)$/i));
  let isImage = $derived(mediaPath.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i));
 
  let videoEl = $state(null);
  let audioEl = $state(null);
  let playing = $state(false);
  let progress = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let metadata = $state(null);
  let loadingMeta = $state(false);
  let subtitleUrl = $state(null);
  let neighbors = $state({ prev: null, next: null });
  let zoomed = $state(false);
  let lastFetchedPath = $state('');

  // Sync prop path to local state ONLY if it changes from outside (e.g. double click new file)
  $effect(() => {
    if (data.path && data.path !== lastPropPath) {
      currentPath = data.path;
      lastPropPath = data.path;
    }
  });

  // Automatically focus the player when it becomes the active window
  $effect(() => {
    if ($activeWindowId === 'player') {
      const el = document.querySelector('.media-player-app');
      if (el) el.focus();
    }
  });

  // Use relative URLs (proxied via Vite) with token auth
  let mediaUrl = $derived(mediaPath ? `/api/fs/raw?path=${encodeURIComponent(mediaPath)}&token=${localStorage.getItem('web_os_token')}` : '');

  async function fetchMetadata() {
    if (!mediaPath) return;
    try {
      loadingMeta = true;
      // Reset neighbors to ensure UI reflects loading state or current absence
      neighbors = { prev: null, next: null };
      
      const [info, subs, neighborData] = await Promise.all([
        apiFetch(`/api/media/info?path=${encodeURIComponent(mediaPath)}`),
        isVideo ? apiFetch(`/api/media/subtitles?path=${encodeURIComponent(mediaPath)}`) : Promise.resolve(null),
        apiFetch(`/api/media/neighbors?path=${encodeURIComponent(mediaPath)}&type=${isImage ? 'image' : 'media'}`)
      ]);
      
      metadata = info;
      if (subs && subs.path) {
        subtitleUrl = `/api/fs/raw?path=${encodeURIComponent(subs.path)}&token=${localStorage.getItem('web_os_token')}`;
      } else {
        subtitleUrl = null;
      }
      neighbors = neighborData;
    } catch (err) {
      console.error('Failed to load metadata', err);
    } finally {
      loadingMeta = false;
    }
  }

  function handleKeydown(e) {
    if ($activeWindowId !== 'player') return;

    if (isVideo || isAudio) {
      const el = isVideo ? videoEl : audioEl;
      if (!el) return;

      if (e.key === 'ArrowLeft') {
        el.currentTime = Math.max(0, el.currentTime - 10);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        el.currentTime = Math.min(el.duration, el.currentTime + 10);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        volume = Math.min(1, volume + 0.05);
        el.volume = volume;
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        volume = Math.max(0, volume - 0.05);
        el.volume = volume;
        e.preventDefault();
      } else if (e.code === 'Space') {
        togglePlay();
        e.preventDefault();
      }
    } else if (isImage) {
      if (e.key === 'ArrowLeft' && neighbors.prev) {
        navigate(neighbors.prev);
        e.preventDefault();
      } else if (e.key === 'ArrowRight' && neighbors.next) {
        navigate(neighbors.next);
        e.preventDefault();
      }
    }
  }

  function navigate(path) {
    currentPath = path;
    zoomed = false;
    // Keep focus after navigation
    const el = document.querySelector('.media-player-app');
    if (el) el.focus();
  }

  function togglePlay() {
    const el = isVideo ? videoEl : audioEl;
    if (!el) return;
    if (playing) el.pause(); else el.play();
    playing = !playing;
  }

  function handleTimeUpdate(e) {
    const el = e.target;
    progress = (el.currentTime / (el.duration || 1)) * 100;
  }

  function handleLoadedMetadata(e) {
    duration = e.target.duration;
  }

  function handleSeek(e) {
    const el = isVideo ? videoEl : audioEl;
    if (!el) return;
    const seekTime = (e.target.value / 100) * el.duration;
    el.currentTime = seekTime;
  }

  function toggleFullscreen() {
    if (videoEl && videoEl.requestFullscreen) {
      videoEl.requestFullscreen();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    // Initial focus request
    setTimeout(() => {
      const el = document.querySelector('.media-player-app');
      if (el) el.focus();
    }, 100);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  $effect(() => {
    if (mediaPath && mediaPath !== lastFetchedPath) {
      lastFetchedPath = mediaPath;
      fetchMetadata();
      // Synchronize window title
      const fileName = mediaPath.split('/').pop();
      updateWindowTitle('player', `Viewer - ${fileName}`);
    }
  });
</script>

<div class="media-player-app" oncontextmenu={(e) => e.preventDefault()} tabindex="-1">
  <div class="player-container glass-effect">
    {#if isVideo}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video 
        bind:this={videoEl}
        src={mediaUrl}
        onplay={() => playing = true}
        onpause={() => playing = false}
        ontimeupdate={handleTimeUpdate}
        onloadedmetadata={handleLoadedMetadata}
        onclick={togglePlay}
        crossorigin="anonymous"
      >
        {#if subtitleUrl}
          <track kind="subtitles" src={subtitleUrl} srclang="ko" label="자막" default />
        {/if}
      </video>
    {:else if isAudio}
      <div class="audio-visual">
        <Music size={120} class="music-icon" />
        <audio 
          bind:this={audioEl}
          src={mediaUrl}
          onplay={() => playing = true}
          onpause={() => playing = false}
          ontimeupdate={handleTimeUpdate}
          onloadedmetadata={handleLoadedMetadata}
        ></audio>
      </div>
    {:else if isImage}
      <div class="image-viewer" ontouchstart={() => zoomed = !zoomed} ondblclick={() => zoomed = !zoomed} tabindex="0">
        <img 
          src={mediaUrl} 
          alt={mediaPath} 
          class={zoomed ? 'zoomed' : ''} 
          style={zoomed ? 'cursor: zoom-out' : 'cursor: zoom-in'}
        />
        
        <div class="nav-overlay">
          {#if neighbors.prev}
            <button 
              class="nav-btn left" 
              onclick={(e) => { e.stopPropagation(); navigate(neighbors.prev); }}
              ondblclick={(e) => e.stopPropagation()}
            >
              <Play size={48} style="transform: rotate(180deg)" />
            </button>
          {/if}
          {#if neighbors.next}
            <button 
              class="nav-btn right" 
              onclick={(e) => { e.stopPropagation(); navigate(neighbors.next); }}
              ondblclick={(e) => e.stopPropagation()}
            >
              <Play size={48} />
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="error-state">
        <Video size={48} />
        <p>Unsupported media format or no file selected.</p>
      </div>
    {/if}

    {#if !isImage}
      <div class="controls-overlay">
        <div class="progress-bar">
          <input type="range" min="0" max="100" step="0.1" value={progress} oninput={handleSeek} />
        </div>
        
        <div class="control-bottom">
          <div class="left">
            <button class="icon-btn" onclick={togglePlay}>
              {#if playing} <Pause size={20} /> {:else} <Play size={20} /> {/if}
            </button>
            <div class="time-info">
              {Math.floor((progress * (duration || 0)) / 100 / 60)}:{Math.floor(((progress * (duration || 0)) / 100) % 60).toString().padStart(2, '0')} / 
              {Math.floor((duration || 0) / 60)}:{Math.floor((duration || 0) % 60).toString().padStart(2, '0')}
            </div>
          </div>

          <div class="right">
            <div class="volume-control">
              <Volume2 size={18} />
              <input type="range" min="0" max="1" step="0.1" bind:value={volume} oninput={() => { if (videoEl) videoEl.volume = volume; if (audioEl) audioEl.volume = volume; }} />
            </div>
            {#if isVideo}
              <button class="icon-btn" onclick={toggleFullscreen}><Maximize size={18} /></button>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="metadata-panel glass-effect">
    <div class="meta-header">
      <Info size={16} /> <span>File Information</span>
    </div>
    {#if loadingMeta}
      <div class="loading"><RefreshCw size={16} class="spin" /> Reading info...</div>
    {:else if metadata}
      <div class="meta-grid">
        <div class="meta-item"><span class="label">Format:</span> {metadata.format}</div>
        <div class="meta-item"><span class="label">Size:</span> {(metadata.size / (1024 * 1024)).toFixed(2)} MB</div>
        {#if metadata.video}
          <div class="meta-item"><span class="label">Resolution:</span> {metadata.video.width}x{metadata.video.height}</div>
          <div class="meta-item"><span class="label">Video Codec:</span> {metadata.video.codec}</div>
        {/if}
        {#if metadata.audio}
          <div class="meta-item"><span class="label">Audio Codec:</span> {metadata.audio.codec}</div>
        {/if}
      </div>
    {:else}
      <p class="no-meta">Select a file to view properties.</p>
    {/if}
  </div>
</div>

<style>
  .media-player-app { display: flex; flex-direction: column; height: 100%; background: #000; color: white; gap: 1px; }
  
  .player-container { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: contain; }
  
  .image-viewer { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #111; }
  .image-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .image-viewer img.zoomed { transform: scale(2); }

  .nav-overlay { position: absolute; inset: 0; pointer-events: none; display: grid; grid-template-columns: 100px 1fr 100px; align-items: center; padding: 0 20px; opacity: 0; transition: opacity 0.3s; z-index: 10; }
  .image-viewer:hover .nav-overlay { opacity: 1; }
  .nav-btn { pointer-events: auto; background: rgba(0,0,0,0.5); border: none; color: white; width: 64px; height: 64px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: background 0.2s; }
  .nav-btn.right { grid-column: 3; }
  .nav-btn:hover { background: var(--accent-blue); }

  .audio-visual { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; color: var(--accent-blue); }
  .music-icon { opacity: 0.5; filter: drop-shadow(0 0 20px rgba(88, 166, 255, 0.3)); }

  .controls-overlay { position: absolute; bottom: 0; left: 0; width: 100%; background: linear-gradient(transparent, rgba(0,0,0,0.8)); padding: 20px; display: flex; flex-direction: column; gap: 12px; opacity: 0; transition: opacity 0.3s; }
  .player-container:hover .controls-overlay { opacity: 1; }

  .progress-bar { width: 100%; }
  input[type="range"] { width: 100%; accent-color: var(--accent-blue); height: 4px; border-radius: 2px; cursor: pointer; }

  .control-bottom { display: flex; justify-content: space-between; align-items: center; }
  .left, .right { display: flex; align-items: center; gap: 16px; }
  .icon-btn { background: transparent; border: none; color: white; cursor: pointer; display: flex; align-items: center; transition: transform 0.1s; }
  .icon-btn:hover { transform: scale(1.1); color: var(--accent-blue); }

  .time-info { font-size: 13px; font-family: monospace; color: var(--text-dim); }
  .volume-control { display: flex; align-items: center; gap: 8px; width: 120px; }
  .volume-control input { flex: 1; }

  .metadata-panel { padding: 16px 20px; background: rgba(255, 255, 255, 0.05); border-top: 1px solid var(--glass-border); }
  .meta-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 12px; }
  .meta-item .label { color: var(--text-dim); margin-right: 4px; }
  
  .spin { animation: spin 2s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  
  .error-state { text-align: center; color: var(--text-dim); }
</style>
