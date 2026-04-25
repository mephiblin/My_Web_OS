<script>
  import { onMount } from 'svelte';
  import { RefreshCw, Search, FolderOpen, ExternalLink } from 'lucide-svelte';
  import { listDir, fetchConfig } from '../file-explorer/api.js';
  import { fetchStationInfo } from './api.js';
  import { openWindow } from '../../../core/stores/windowStore.js';

  const MAX_SCAN_ITEMS = 600;
  const MAX_DEPTH = 4;
  const MAX_SCAN_DIRS = 120;
  const MAX_METADATA_ITEMS = 40;
  const MAX_METADATA_CONCURRENCY = 4;
  const MAX_METADATA_CACHE_ENTRIES = 1200;
  const METADATA_CACHE_TTL_MS = 15 * 60 * 1000;
  const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.git', '.cache', '.next']);
  const METADATA_FETCHABLE_KINDS = new Set(['audio', 'video', 'image', 'document']);
  const stationMetadataCache = new Map();

  let {
    title = 'Station',
    subtitle = '',
    extensions = [],
    launchAppId = 'files',
    launchTitle = 'Open'
  } = $props();

  let loading = $state(false);
  let error = $state('');
  let roots = $state([]);
  let selectedRoot = $state('');
  let sortMode = $state('recent');
  let files = $state([]);
  let metadataByPath = $state({});
  let metadataLoading = $state(false);
  let metadataStats = $state({
    cached: 0,
    requested: 0,
    fetched: 0,
    failed: 0,
    lastBatchMs: 0
  });
  let search = $state('');
  let lastScannedAt = $state('');
  let scanInfo = $state({
    scannedDirs: 0,
    scannedFiles: 0,
    skippedDirs: 0,
    truncated: false,
    reason: ''
  });
  let activeScanToken = 0;
  const metadataPendingPaths = new Set();

  const normalizedExtensions = $derived(new Set(
    (Array.isArray(extensions) ? extensions : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  ));

  const filtered = $derived(files
    .filter((item) => {
      if (normalizedExtensions.size === 0) return true;
      return normalizedExtensions.has(item.ext);
    })
    .filter((item) => {
      const q = String(search || '').trim().toLowerCase();
      if (!q) return true;
      return String(item.name || '').toLowerCase().includes(q) || String(item.path || '').toLowerCase().includes(q);
    })
  );

  const recents = $derived([...filtered]
    .sort((a, b) => new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime())
    .slice(0, 20)
  );

  const groupedByFolder = $derived(() => {
    const map = new Map();
    for (const item of filtered) {
      const parent = dirname(item.path);
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent).push(item);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'en'))
      .map(([folder, rows]) => ({
        folder,
        rows: rows.sort(compareRows)
      }))
      .slice(0, 30);
  });

  const metadataCandidates = $derived(() => {
    const picked = [];
    const seen = new Set();
    const pushCandidate = (item) => {
      if (!item?.path) return;
      if (!METADATA_FETCHABLE_KINDS.has(item.kind)) return;
      if (seen.has(item.path)) return;
      seen.add(item.path);
      picked.push(item);
    };

    for (const item of recents) {
      if (picked.length >= MAX_METADATA_ITEMS) break;
      pushCandidate(item);
    }

    for (const group of groupedByFolder()) {
      if (picked.length >= MAX_METADATA_ITEMS) break;
      for (const item of group.rows.slice(0, 10)) {
        if (picked.length >= MAX_METADATA_ITEMS) break;
        pushCandidate(item);
      }
    }
    return picked;
  });

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function formatShortDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function formatDuration(seconds) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return '';
    const rounded = Math.floor(total);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function compareRows(a, b) {
    if (sortMode === 'name') {
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'en');
    }
    if (sortMode === 'size') {
      const diff = Number(b?.size || 0) - Number(a?.size || 0);
      if (diff !== 0) return diff;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'en');
    }
    const timeDiff = new Date(b?.mtime || 0).getTime() - new Date(a?.mtime || 0).getTime();
    if (timeDiff !== 0) return timeDiff;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'en');
  }

  function inferKindByExtension(ext = '') {
    const key = String(ext || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif'].includes(key)) return 'image';
    if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'].includes(key)) return 'video';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'].includes(key)) return 'audio';
    if (['pdf', 'txt', 'md', 'markdown', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'json', 'log'].includes(key)) return 'document';
    if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(key)) return 'archive';
    return 'file';
  }

  function dirname(value) {
    const normalized = String(value || '').replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    if (idx <= 0) return '/';
    return normalized.slice(0, idx);
  }

  function extname(value) {
    const name = String(value || '');
    const idx = name.lastIndexOf('.');
    if (idx < 0) return '';
    return name.slice(idx + 1).toLowerCase();
  }

  function shouldSkipDirectory(name = '') {
    const safe = String(name || '').trim().toLowerCase();
    if (!safe) return true;
    if (safe.startsWith('.')) return true;
    return SKIP_DIR_NAMES.has(safe);
  }

  function itemFingerprint(item) {
    const size = Number(item?.size || 0);
    const mtime = String(item?.mtime || '');
    return `${size}:${mtime}`;
  }

  function pruneMetadataCache(now = Date.now()) {
    for (const [path, entry] of stationMetadataCache.entries()) {
      if (!entry || Number(entry.expiresAt || 0) <= now) {
        stationMetadataCache.delete(path);
      }
    }
    if (stationMetadataCache.size <= MAX_METADATA_CACHE_ENTRIES) return;
    const rows = [...stationMetadataCache.entries()]
      .map(([path, entry]) => ({
        path,
        lastAccessAt: Number(entry?.lastAccessAt || 0)
      }))
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
    const overflow = stationMetadataCache.size - MAX_METADATA_CACHE_ENTRIES;
    for (const row of rows.slice(0, overflow)) {
      stationMetadataCache.delete(row.path);
    }
  }

  function readMetadataCache(item, now = Date.now()) {
    const path = String(item?.path || '').trim();
    if (!path) return null;
    const cached = stationMetadataCache.get(path);
    if (!cached) return null;
    if (Number(cached.expiresAt || 0) <= now) {
      stationMetadataCache.delete(path);
      return null;
    }
    if (String(cached.fingerprint || '') !== itemFingerprint(item)) {
      stationMetadataCache.delete(path);
      return null;
    }
    stationMetadataCache.set(path, {
      ...cached,
      lastAccessAt: now
    });
    return cached.metadata ?? null;
  }

  function writeMetadataCache(item, metadata, now = Date.now()) {
    const path = String(item?.path || '').trim();
    if (!path) return;
    stationMetadataCache.set(path, {
      fingerprint: itemFingerprint(item),
      metadata: metadata ?? null,
      lastAccessAt: now,
      expiresAt: now + METADATA_CACHE_TTL_MS
    });
    pruneMetadataCache(now);
  }

  function joinPath(base, leaf) {
    const left = String(base || '').trim();
    const right = String(leaf || '').trim();
    if (!left) return right;
    if (!right) return left;
    if (left.endsWith('/') || left.endsWith('\\')) return left + right;
    return `${left}/${right}`;
  }

  function markError(message) {
    error = String(message || '').trim() || 'Failed to load station files.';
  }

  function hasMetadata(path) {
    return Object.prototype.hasOwnProperty.call(metadataByPath, String(path || ''));
  }

  function formatFileMetadata(item) {
    const path = String(item?.path || '');
    if (!path || !hasMetadata(path)) return '';
    const metadata = metadataByPath[path];
    if (!metadata || metadata.unavailable) return '';
    const parts = [];
    const width = Number(metadata?.resolution?.width);
    const height = Number(metadata?.resolution?.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      parts.push(`${Math.round(width)}x${Math.round(height)}`);
    }
    const durationText = formatDuration(metadata?.durationSeconds);
    if (durationText) parts.push(durationText);
    const pages = Number(metadata?.pages);
    if (Number.isFinite(pages) && pages > 0) {
      parts.push(`${Math.round(pages)} pages`);
    }
    return parts.join(' · ');
  }

  function describeRecentRow(item) {
    const parts = [item.kind, formatBytes(item.size)];
    const meta = formatFileMetadata(item);
    if (meta) parts.push(meta);
    parts.push(formatShortDate(item.mtime));
    return parts.join(' · ');
  }

  function describeFolderRow(item) {
    const parts = [item.kind, formatBytes(item.size)];
    const meta = formatFileMetadata(item);
    if (meta) parts.push(meta);
    return parts.join(' · ');
  }

  function openFile(item) {
    if (!item?.path) return;
    openWindow(
      {
        id: launchAppId,
        title: launchTitle,
        singleton: launchAppId === 'player' || launchAppId === 'doc-viewer'
      },
      { path: item.path }
    );
  }

  async function scanDirectory(dirPath, depth, bucket, state) {
    if (bucket.length >= MAX_SCAN_ITEMS || state.scannedDirs >= MAX_SCAN_DIRS) {
      state.truncated = true;
      state.reason = bucket.length >= MAX_SCAN_ITEMS
        ? `File scan limit reached (${MAX_SCAN_ITEMS}).`
        : `Directory scan limit reached (${MAX_SCAN_DIRS}).`;
      return;
    }
    state.scannedDirs += 1;

    const payload = await listDir(dirPath);
    const basePath = String(payload?.path || dirPath);
    const items = Array.isArray(payload?.items) ? payload.items : [];

    for (const item of items) {
      if (bucket.length >= MAX_SCAN_ITEMS || state.scannedDirs >= MAX_SCAN_DIRS) {
        state.truncated = true;
        state.reason = bucket.length >= MAX_SCAN_ITEMS
          ? `File scan limit reached (${MAX_SCAN_ITEMS}).`
          : `Directory scan limit reached (${MAX_SCAN_DIRS}).`;
        break;
      }
      const name = String(item?.name || '').trim();
      if (!name) continue;
      const fullPath = joinPath(basePath, name);
      if (item?.isDirectory) {
        const skipByDepth = depth >= MAX_DEPTH;
        const skipByPolicy = shouldSkipDirectory(name);
        if (skipByDepth || skipByPolicy) {
          state.skippedDirs += 1;
        }
        if (!skipByDepth && !skipByPolicy) {
          await scanDirectory(fullPath, depth + 1, bucket, state);
        }
        continue;
      }

      const ext = extname(name);
      state.scannedFiles += 1;
      bucket.push({
        name,
        path: fullPath,
        ext,
        kind: inferKindByExtension(ext),
        size: Number(item?.size) || 0,
        mtime: item?.mtime || null
      });
    }
  }

  async function loadRoots() {
    const config = await fetchConfig();
    const allowedRoots = Array.isArray(config?.allowedRoots) ? config.allowedRoots : [];
    roots = allowedRoots;
    if (!selectedRoot || !allowedRoots.includes(selectedRoot)) {
      selectedRoot = String(allowedRoots[0] || '');
    }
  }

  async function scanNow() {
    activeScanToken += 1;
    const scanToken = activeScanToken;
    metadataPendingPaths.clear();
    loading = true;
    metadataLoading = false;
    error = '';
    try {
      if (!roots.length) await loadRoots();
      if (!selectedRoot) {
        markError('No allowed root configured.');
        files = [];
        metadataByPath = {};
        metadataStats = {
          cached: 0,
          requested: 0,
          fetched: 0,
          failed: 0,
          lastBatchMs: 0
        };
        return;
      }
      const bucket = [];
      const state = {
        scannedDirs: 0,
        scannedFiles: 0,
        skippedDirs: 0,
        truncated: false,
        reason: ''
      };
      await scanDirectory(selectedRoot, 0, bucket, state);
      if (scanToken !== activeScanToken) return;
      const now = Date.now();
      pruneMetadataCache(now);
      const cachedMetadata = {};
      let cacheHitCount = 0;
      for (const item of bucket) {
        const metadata = readMetadataCache(item, now);
        if (metadata === null || metadata === undefined) continue;
        cachedMetadata[item.path] = metadata;
        cacheHitCount += 1;
      }
      files = bucket;
      metadataByPath = cachedMetadata;
      metadataStats = {
        cached: cacheHitCount,
        requested: 0,
        fetched: 0,
        failed: 0,
        lastBatchMs: 0
      };
      scanInfo = state;
      lastScannedAt = new Date().toLocaleString();
    } catch (err) {
      markError(err?.message);
      files = [];
      metadataByPath = {};
      metadataStats = {
        cached: 0,
        requested: 0,
        fetched: 0,
        failed: 0,
        lastBatchMs: 0
      };
      scanInfo = {
        scannedDirs: 0,
        scannedFiles: 0,
        skippedDirs: 0,
        truncated: false,
        reason: ''
      };
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    await loadRoots();
    await scanNow();
  });

  $effect(() => {
    const candidates = metadataCandidates();
    if (!Array.isArray(candidates) || candidates.length === 0) return;

    const missing = candidates.filter((item) => (
      !hasMetadata(item.path) &&
      !metadataPendingPaths.has(item.path)
    ));
    if (missing.length === 0) return;

    const currentScanToken = activeScanToken;
    let canceled = false;
    metadataLoading = true;
    for (const item of missing) {
      metadataPendingPaths.add(item.path);
    }
    metadataStats = {
      ...metadataStats,
      requested: metadataStats.requested + missing.length
    };
    const startedAt = Date.now();

    (async () => {
      const updates = {};
      let successCount = 0;
      let failedCount = 0;
      let cursor = 0;

      const worker = async () => {
        while (true) {
          if (canceled) return;
          if (cursor >= missing.length) return;
          const item = missing[cursor];
          cursor += 1;
          try {
            const payload = await fetchStationInfo(item.path);
            const metadata = payload?.metadata || null;
            updates[item.path] = metadata;
            writeMetadataCache(item, metadata);
            successCount += 1;
          } catch (_err) {
            const fallback = { unavailable: true };
            updates[item.path] = fallback;
            writeMetadataCache(item, fallback);
            failedCount += 1;
          }
        }
      };

      const concurrency = Math.max(1, Math.min(MAX_METADATA_CONCURRENCY, missing.length));
      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      for (const item of missing) {
        metadataPendingPaths.delete(item.path);
      }

      if (!canceled && currentScanToken === activeScanToken && Object.keys(updates).length > 0) {
        metadataByPath = {
          ...metadataByPath,
          ...updates
        };
      }
      if (!canceled && currentScanToken === activeScanToken) {
        metadataStats = {
          ...metadataStats,
          fetched: metadataStats.fetched + successCount,
          failed: metadataStats.failed + failedCount,
          lastBatchMs: Date.now() - startedAt
        };
      }
      if (!canceled && currentScanToken === activeScanToken) {
        metadataLoading = metadataPendingPaths.size > 0;
      }
    })();

    return () => {
      canceled = true;
      if (currentScanToken === activeScanToken) {
        metadataLoading = metadataPendingPaths.size > 0;
      }
    };
  });
</script>

<div class="station">
  <div class="header">
    <div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
    <button class="icon-btn" title="Refresh" onclick={scanNow} disabled={loading}>
      <RefreshCw size={14} class={loading ? 'spin' : ''} />
    </button>
  </div>

  <div class="toolbar">
    <select bind:value={selectedRoot} onchange={() => scanNow()} disabled={loading || roots.length === 0}>
      {#if roots.length === 0}
        <option value="">no allowed roots</option>
      {:else}
        {#each roots as root}
          <option value={root}>{root}</option>
        {/each}
      {/if}
    </select>
    <div class="search">
      <Search size={14} />
      <input type="text" placeholder="Search station library" bind:value={search} />
    </div>
    <select bind:value={sortMode} disabled={loading}>
      <option value="recent">sort: recent</option>
      <option value="name">sort: name</option>
      <option value="size">sort: size</option>
    </select>
  </div>

  <div class="summary">
    <div class="card"><span>Library</span><strong>{filtered.length}</strong></div>
    <div class="card"><span>Recents</span><strong>{recents.length}</strong></div>
    <div class="card"><span>Scanned Files</span><strong>{scanInfo.scannedFiles}</strong></div>
    <div class="card"><span>Folders</span><strong>{groupedByFolder().length}</strong></div>
    <div class="card"><span>Scanned Dirs</span><strong>{scanInfo.scannedDirs}</strong></div>
  </div>
  <div class="scan-line">
    <span>Last Scan: {lastScannedAt || '-'}</span>
    <div class="scan-state">
      <span>Metadata: cache {metadataStats.cached} · fetched {metadataStats.fetched} · failed {metadataStats.failed}</span>
      <span>Skipped Dirs: {scanInfo.skippedDirs}</span>
      {#if metadataStats.lastBatchMs > 0}
        <span>Batch: {metadataStats.lastBatchMs}ms</span>
      {/if}
      {#if metadataLoading}
        <span>Loading metadata...</span>
      {/if}
      {#if scanInfo.truncated}
        <span class="warn">{scanInfo.reason || 'Scan truncated.'}</span>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="panes">
    <section class="pane">
      <h3>Recents</h3>
      {#if recents.length === 0}
        <div class="empty">No matched files.</div>
      {:else}
        <div class="rows">
          {#each recents as item}
            <button class="row" onclick={() => openFile(item)}>
              <div class="meta">
                <strong>{item.name}</strong>
                <span>{dirname(item.path)}</span>
                <span>{describeRecentRow(item)}</span>
              </div>
              <div class="tags">
                {#if item.size > 500 * 1024 * 1024}
                  <span class="tag warn">large</span>
                {/if}
                <ExternalLink size={12} />
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <section class="pane">
      <h3>By Folder</h3>
      {#if groupedByFolder().length === 0}
        <div class="empty">No grouped library data.</div>
      {:else}
        <div class="groups">
          {#each groupedByFolder() as group}
            <details>
              <summary><FolderOpen size={12} /> {group.folder} ({group.rows.length})</summary>
              <div class="rows">
                {#each group.rows.slice(0, 15) as item}
                  <button class="row" onclick={() => openFile(item)}>
                    <div class="meta">
                      <strong>{item.name}</strong>
                      <span>{describeFolderRow(item)}</span>
                    </div>
                    <ExternalLink size={12} />
                  </button>
                {/each}
              </div>
            </details>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .station { height: 100%; display: grid; gap: 10px; padding: 12px; overflow: auto; }
  .header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h2 { margin: 0; font-size: 17px; }
  p { margin: 4px 0 0; color: var(--text-dim); font-size: 12px; }
  .toolbar { display: grid; grid-template-columns: 1fr 1.4fr minmax(140px, 180px); gap: 8px; }
  select, input { border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.22); color: var(--text-main); padding: 8px; }
  .search { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--glass-border); border-radius: 8px; padding: 0 8px; }
  .search input { border: 0; background: transparent; padding: 8px 0; width: 100%; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
  .card { border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.24); padding: 9px; display: grid; gap: 2px; }
  .card span { color: var(--text-dim); font-size: 11px; text-transform: uppercase; }
  .card strong { font-size: 13px; }
  .scan-line { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--text-dim); }
  .scan-state { display: inline-flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .scan-line .warn { color: #fcd34d; }
  .error { border: 1px solid rgba(239,68,68,0.5); background: rgba(127,29,29,0.2); color: #fecaca; border-radius: 8px; padding: 8px; font-size: 12px; }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; min-height: 260px; }
  .pane { border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.22); padding: 10px; display: grid; gap: 8px; }
  .pane h3 { margin: 0; font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .rows { display: grid; gap: 6px; max-height: 320px; overflow: auto; }
  .row { width: 100%; border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.25); color: var(--text-main); padding: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; text-align: left; cursor: pointer; }
  .meta { display: grid; gap: 2px; min-width: 0; }
  .meta strong { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta span { font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
  .groups { display: grid; gap: 8px; max-height: 320px; overflow: auto; }
  details { border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.2); padding: 6px; }
  summary { list-style: none; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-main); }
  .empty { font-size: 12px; color: var(--text-dim); }
  .tag { border: 1px solid var(--glass-border); border-radius: 999px; font-size: 10px; padding: 2px 6px; text-transform: uppercase; }
  .tag.warn { color: #fcd34d; border-color: rgba(245,158,11,0.6); }
  .tags { display: inline-flex; gap: 6px; align-items: center; color: var(--text-dim); }
  .icon-btn { border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(0,0,0,0.2); color: var(--text-main); width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  :global(.spin) { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  @media (max-width: 960px) {
    .toolbar { grid-template-columns: 1fr; }
    .summary { grid-template-columns: 1fr 1fr; }
    .panes { grid-template-columns: 1fr; }
  }
</style>
