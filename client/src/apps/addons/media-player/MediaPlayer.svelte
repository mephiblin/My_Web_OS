<script>
  import { onMount } from 'svelte';
  import {
    Play,
    Pause,
    Volume2,
    Maximize,
    Music,
    Video,
    Info,
    RefreshCw,
    Repeat,
    Shuffle
  } from 'lucide-svelte';
  import { addToast } from '../../../core/stores/toastStore.js';
  import { activeWindowId, windows, updateWindowTitle } from '../../../core/stores/windowStore.js';
  import { fetchRawFileTicketUrl, fetchRawMediaLeaseUrl, redactSensitiveText } from '../../../utils/api.js';
  import {
    fetchMediaInfo,
    fetchMediaSubtitles,
    fetchMediaNeighbors,
    fetchMediaPlaylist
  } from './api.js';

  let { data = {} } = $props();
  
  // Synchronized state for navigation
  let currentPath = $state('');
  let lastPropPath = $state('');
  let mediaPath = $derived(currentPath);
  
  let isVideo = $derived(mediaPath.match(/\.(mp4|webm|mkv|mov|avi)$/i));
  let isAudio = $derived(mediaPath.match(/\.(mp3|wav|ogg|flac|m4a)$/i));
  let isImage = $derived(mediaPath.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i));
 
  let videoEl = $state(null);
  let audioEl = $state(null);
  let playing = $state(false);
  let progress = $state(0);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let metadata = $state(null);
  let loadingMeta = $state(false);
  let subtitleUrl = $state(null);
  let subtitlePath = $state('');
  let neighbors = $state({ prev: null, next: null });
  let zoomed = $state(false);
  let lastFetchedPath = $state('');
  let playlist = $state([]);
  let playlistLoading = $state(false);
  let playlistError = $state('');
  let shuffleEnabled = $state(false);
  let repeatMode = $state('off');
  let backgroundAudioEnabled = $state(true);
  let pendingAutoplay = $state(false);
  let mediaUrl = $state('');
  let mediaUrlError = $state('');
  let mediaRecoveryAttempted = $state(false);
  let pendingRecoveryTime = $state(null);
  let pendingRecoveryPlay = $state(false);

  const currentWindow = $derived(
    $windows.find((win) => win.appId === 'player' && win.data === data) || null
  );
  const currentWindowId = $derived(currentWindow?.id || null);
  const isWindowActive = $derived(Boolean(currentWindow && $activeWindowId === currentWindow.id));
  const isWindowMinimized = $derived(Boolean(currentWindow?.minimized));
  const repeatLabel = $derived(
    repeatMode === 'one' ? 'Repeat: One' : repeatMode === 'all' ? 'Repeat: All' : 'Repeat: Off'
  );

  function isCloudPath(path) {
    return String(path || '').trim().startsWith('cloud://');
  }

  // Sync prop path to local state ONLY if it changes from outside (e.g. double click new file)
  $effect(() => {
    if (data?.path && data?.path !== lastPropPath) {
      currentPath = data.path;
      lastPropPath = data.path;
    }
  });

  // Automatically focus the player when it becomes the active window
  $effect(() => {
    if (isWindowActive) {
      const el = document.querySelector('.media-player-app');
      if (el) el.focus();
    }
  });

  // Background audio policy
  $effect(() => {
    if (backgroundAudioEnabled || !(isVideo || isAudio)) return;
    const el = isVideo ? videoEl : audioEl;
    if (!el) return;
    if ((!isWindowActive || isWindowMinimized) && !el.paused) {
      el.pause();
      playing = false;
    }
  });

  function parsePlaylistPayload(payload) {
    const source = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.playlist)
      ? payload.playlist
      : [];

    const normalized = source
      .map((item) => {
        if (typeof item === 'string') {
          return { path: item, name: item.split('/').pop() || item };
        }
        const itemPath = item?.path || item?.filePath || item?.fullPath || '';
        if (!itemPath) return null;
        return {
          path: itemPath,
          name: item?.name || item?.filename || itemPath.split('/').pop() || itemPath
        };
      })
      .filter(Boolean)
      .filter((item) => /\.(mp4|webm|mkv|mov|avi|mp3|wav|ogg|flac|m4a)$/i.test(item.path));

    if (!normalized.some((item) => item.path === mediaPath) && mediaPath) {
      normalized.push({ path: mediaPath, name: mediaPath.split('/').pop() || mediaPath });
    }

    return normalized;
  }

  async function fetchMetadata() {
    if (!mediaPath) return;
    if (isCloudPath(mediaPath)) {
      metadata = null;
      subtitlePath = '';
      neighbors = { prev: null, next: null };
      playlist = (isVideo || isAudio)
        ? [{ path: mediaPath, name: mediaPath.split('/').pop() || mediaPath }]
        : [];
      playlistError = '';
      loadingMeta = false;
      playlistLoading = false;
      return;
    }
    try {
      loadingMeta = true;
      playlistLoading = isVideo || isAudio;
      playlistError = '';
      // Reset neighbors to ensure UI reflects loading state or current absence
      neighbors = { prev: null, next: null };
      
      const [info, subs, neighborData, playlistData] = await Promise.all([
        fetchMediaInfo(mediaPath),
        isVideo ? fetchMediaSubtitles(mediaPath) : Promise.resolve(null),
        fetchMediaNeighbors(mediaPath, isImage ? 'image' : 'media'),
        isVideo || isAudio ? fetchMediaPlaylist(mediaPath).catch(() => null) : Promise.resolve(null)
      ]);
      
      metadata = info;
      if (subs && subs.path) {
        subtitlePath = subs.path;
      } else {
        subtitlePath = '';
      }
      neighbors = neighborData;
      if (isVideo || isAudio) {
        playlist = parsePlaylistPayload(playlistData);
        if (!playlistData) {
          playlistError = 'Playlist endpoint unavailable.';
        }
      } else {
        playlist = [];
      }
    } catch (err) {
      console.error('Failed to load metadata', err);
      playlist = [];
      playlistError = redactSensitiveText(err?.message || 'Failed to load playlist.');
    } finally {
      loadingMeta = false;
      playlistLoading = false;
    }
  }

  function handleKeydown(e) {
    if (!isWindowActive) return;

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

  function navigate(path, options = {}) {
    if (!path || path === currentPath) return;
    pendingAutoplay = options.autoplay === true;
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
    currentTime = el.currentTime || 0;
    progress = (el.currentTime / (el.duration || 1)) * 100;
  }

  function handleLoadedMetadata(e) {
    duration = e.target.duration || 0;
    if (pendingRecoveryTime !== null && Number.isFinite(pendingRecoveryTime)) {
      e.target.currentTime = Math.min(pendingRecoveryTime, e.target.duration || pendingRecoveryTime);
      currentTime = e.target.currentTime || 0;
      pendingRecoveryTime = null;
    }

    if (pendingRecoveryPlay) {
      pendingRecoveryPlay = false;
      e.target.play().then(() => {
        playing = true;
      }).catch(() => {
        playing = false;
      });
    } else if (pendingAutoplay) {
      pendingAutoplay = false;
      e.target.play().then(() => {
        playing = true;
      }).catch(() => {
        playing = false;
        addToast('Autoplay was blocked by the browser policy.', 'error');
      });
    }
  }

  async function handleMediaError() {
    if (!(isVideo || isAudio || isImage) || !mediaPath) return;
    if (mediaRecoveryAttempted) {
      mediaUrlError = 'Media playback could not be recovered. Reopen the file to try again.';
      return;
    }

    const el = isVideo ? videoEl : audioEl;
    const recoveryPath = mediaPath;
    const resumeTime = (isVideo || isAudio) && Number.isFinite(el?.currentTime) ? el.currentTime : currentTime;
    const resumePlaying = Boolean((isVideo || isAudio) && el && !el.paused && !el.ended);
    mediaRecoveryAttempted = true;
    pendingRecoveryTime = resumeTime;
    pendingRecoveryPlay = resumePlaying;

    try {
      const nextUrl = await fetchRawMediaLeaseUrl(recoveryPath, { appId: 'media-player' });
      if (mediaPath !== recoveryPath) return;
      mediaUrlError = '';
      mediaUrl = nextUrl;
    } catch (err) {
      pendingRecoveryTime = null;
      pendingRecoveryPlay = false;
      mediaUrlError = redactSensitiveText(err?.message || 'Failed to recover media playback.');
    }
  }

  function handleSeek(e) {
    const el = isVideo ? videoEl : audioEl;
    if (!el) return;
    const seekTime = (e.target.value / 100) * el.duration;
    el.currentTime = seekTime;
    currentTime = seekTime;
  }

  function toggleFullscreen() {
    if (videoEl && videoEl.requestFullscreen) {
      videoEl.requestFullscreen();
    }
  }

  function cycleRepeatMode() {
    if (repeatMode === 'off') {
      repeatMode = 'all';
      return;
    }
    if (repeatMode === 'all') {
      repeatMode = 'one';
      return;
    }
    repeatMode = 'off';
  }

  function pickNextPath() {
    if (repeatMode === 'one') {
      return mediaPath;
    }

    const paths = playlist.map((item) => item.path).filter(Boolean);
    if (!paths.length) {
      return null;
    }

    const currentIndex = paths.indexOf(mediaPath);
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;

    if (shuffleEnabled) {
      if (paths.length === 1) {
        return repeatMode === 'all' ? paths[0] : null;
      }
      const candidates = paths.filter((path) => path !== mediaPath);
      if (!candidates.length) return null;
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    const nextIndex = safeCurrentIndex + 1;
    if (nextIndex < paths.length) {
      return paths[nextIndex];
    }
    if (repeatMode === 'all') {
      return paths[0];
    }
    return null;
  }

  function handleMediaEnded() {
    const nextPath = pickNextPath();
    if (!nextPath) {
      playing = false;
      return;
    }
    if (nextPath === mediaPath) {
      const el = isVideo ? videoEl : audioEl;
      if (!el) return;
      el.currentTime = 0;
      el.play().catch(() => {
        playing = false;
      });
      return;
    }
    navigate(nextPath, { autoplay: true });
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
      playing = false;
      currentTime = 0;
      progress = 0;
      duration = 0;
      mediaRecoveryAttempted = false;
      pendingRecoveryTime = null;
      pendingRecoveryPlay = false;
      fetchMetadata();
      // Synchronize window title
      const fileName = mediaPath.split('/').pop();
      if (currentWindowId) {
        updateWindowTitle(currentWindowId, `Viewer - ${fileName}`);
      }
    }
  });

  $effect(() => {
    const path = mediaPath;
    mediaUrl = '';
    mediaUrlError = '';
    if (!path) return;

    const controller = new AbortController();
    const loadMediaUrl = isVideo || isAudio
      ? (targetPath, options) => fetchRawMediaLeaseUrl(targetPath, { ...options, appId: 'media-player' })
      : fetchRawFileTicketUrl;
    loadMediaUrl(path, { signal: controller.signal })
      .then((url) => {
        if (controller.signal.aborted) return;
        mediaRecoveryAttempted = false;
        mediaUrl = url;
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        mediaUrlError = redactSensitiveText(err?.message || 'Failed to load media.');
      });

    return () => {
      controller.abort();
    };
  });

  $effect(() => {
    const path = subtitlePath;
    subtitleUrl = null;
    if (!path) return;

    const controller = new AbortController();
    fetchRawFileTicketUrl(path, { signal: controller.signal })
      .then((url) => {
        if (controller.signal.aborted) return;
        subtitleUrl = url;
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load subtitles', err);
      });

    return () => {
      controller.abort();
    };
  });
</script>

<div class="media-player-app" role="button" aria-label="Media player" oncontextmenu={(e) => e.preventDefault()} tabindex="-1">
  <div class="player-container glass-effect">
    {#if isVideo}
      {#if mediaUrlError}
        <div class="error-state"><p>{mediaUrlError}</p></div>
      {/if}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video 
        bind:this={videoEl}
        src={mediaUrl}
        onplay={() => playing = true}
        onpause={() => playing = false}
        onended={handleMediaEnded}
        ontimeupdate={handleTimeUpdate}
        onloadedmetadata={handleLoadedMetadata}
        onerror={handleMediaError}
        onclick={togglePlay}
        crossorigin="anonymous"
      >
        {#if subtitleUrl}
          <track kind="subtitles" src={subtitleUrl} srclang="ko" label="Korean subtitles" default />
        {/if}
      </video>
    {:else if isAudio}
      {#if mediaUrlError}
        <div class="error-state"><p>{mediaUrlError}</p></div>
      {/if}
      <div class="audio-visual">
        <span class="music-icon"><Music size={120} /></span>
        <audio 
          bind:this={audioEl}
          src={mediaUrl}
          onplay={() => playing = true}
          onpause={() => playing = false}
          onended={handleMediaEnded}
          ontimeupdate={handleTimeUpdate}
          onloadedmetadata={handleLoadedMetadata}
          onerror={handleMediaError}
        ></audio>
      </div>
    {:else if isImage}
      {#if mediaUrlError}
        <div class="error-state"><p>{mediaUrlError}</p></div>
      {/if}
      <div
        class="image-viewer"
        role="button"
        aria-label="Toggle image zoom"
        ontouchstart={() => zoomed = !zoomed}
        ondblclick={() => zoomed = !zoomed}
        tabindex="0"
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            zoomed = !zoomed;
          }
        }}
      >
        <img 
          src={mediaUrl} 
          alt={mediaPath} 
          class={zoomed ? 'zoomed' : ''} 
          style={zoomed ? 'cursor: zoom-out' : 'cursor: zoom-in'}
          onerror={handleMediaError}
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
              {Math.floor((currentTime || 0) / 60)}:{Math.floor((currentTime || 0) % 60).toString().padStart(2, '0')} /
              {Math.floor((duration || 0) / 60)}:{Math.floor((duration || 0) % 60).toString().padStart(2, '0')}
            </div>
          </div>

          <div class="right">
            <button class="mode-btn {shuffleEnabled ? 'active' : ''}" onclick={() => shuffleEnabled = !shuffleEnabled} title="Shuffle">
              <Shuffle size={16} />
            </button>
            <button class="mode-btn {repeatMode !== 'off' ? 'active' : ''}" onclick={cycleRepeatMode} title={repeatLabel}>
              <Repeat size={16} />
              <span>{repeatMode === 'one' ? '1' : ''}</span>
            </button>
            <button class="mode-btn {backgroundAudioEnabled ? 'active' : ''}" onclick={() => backgroundAudioEnabled = !backgroundAudioEnabled}>
              BG Audio
            </button>
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
      <div class="loading"><span class="spin"><RefreshCw size={16} /></span> Reading info...</div>
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

    {#if isVideo || isAudio}
      <div class="playlist-panel">
        <div class="meta-header">Playlist</div>
        {#if playlistLoading}
          <div class="loading"><span class="spin"><RefreshCw size={16} /></span> Loading playlist...</div>
        {:else if playlist.length > 0}
          <div class="playlist-list">
            {#each playlist as item, index (item.path)}
              <button
                class="playlist-item {item.path === mediaPath ? 'active' : ''}"
                onclick={() => navigate(item.path, { autoplay: true })}
                title={item.path}
              >
                <span class="playlist-index">{index + 1}</span>
                <span class="playlist-name">{item.name}</span>
                {#if item.path === mediaPath && playing}
                  <span class="playlist-state">Playing</span>
                {/if}
              </button>
            {/each}
          </div>
        {:else}
          <p class="no-meta">{playlistError || 'No playlist entries found.'}</p>
        {/if}
      </div>
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
  .mode-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-dim);
    border-radius: 999px;
    height: 26px;
    padding: 0 10px;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .mode-btn.active {
    color: white;
    border-color: rgba(88, 166, 255, 0.75);
    background: rgba(88, 166, 255, 0.26);
  }
  .mode-btn:hover { color: white; border-color: rgba(88, 166, 255, 0.7); }

  .time-info { font-size: 13px; font-family: monospace; color: var(--text-dim); }
  .volume-control { display: flex; align-items: center; gap: 8px; width: 120px; }
  .volume-control input { flex: 1; }

  .metadata-panel { padding: 16px 20px; background: rgba(255, 255, 255, 0.05); border-top: 1px solid var(--glass-border); }
  .meta-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 12px; }
  .meta-item .label { color: var(--text-dim); margin-right: 4px; }
  .playlist-panel { margin-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px; }
  .playlist-list {
    max-height: 160px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 2px;
  }
  .playlist-item {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-dim);
    padding: 8px 10px;
    cursor: pointer;
    text-align: left;
  }
  .playlist-item:hover {
    border-color: rgba(255, 255, 255, 0.14);
    color: white;
  }
  .playlist-item.active {
    border-color: rgba(88, 166, 255, 0.8);
    background: rgba(88, 166, 255, 0.17);
    color: white;
  }
  .playlist-index {
    opacity: 0.7;
    font-size: 11px;
    font-family: monospace;
  }
  .playlist-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .playlist-state {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #8bd5ff;
  }
  
  .spin { animation: spin 2s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  
  .error-state { text-align: center; color: var(--text-dim); }
</style>
