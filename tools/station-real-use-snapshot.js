#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const serverConfig = require('../server/config/serverConfig');
const mediaService = require('../server/services/mediaService');

const MAX_SCAN_ITEMS = 600;
const MAX_DEPTH = 4;
const MAX_SCAN_DIRS = 120;
const MAX_METADATA_ITEMS = 40;
const MAX_METADATA_CACHE_ENTRIES = 1200;
const METADATA_CACHE_TTL_MS = 15 * 60 * 1000;
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.git', '.cache', '.next']);
const METADATA_FETCHABLE_KINDS = new Set(['audio', 'video', 'image', 'document']);

const stationMetadataCache = new Map();

function extname(value) {
  const name = String(value || '');
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx + 1).toLowerCase();
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
  for (const [filePath, entry] of stationMetadataCache.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      stationMetadataCache.delete(filePath);
    }
  }
  if (stationMetadataCache.size <= MAX_METADATA_CACHE_ENTRIES) return;
  const rows = [...stationMetadataCache.entries()]
    .map(([filePath, entry]) => ({
      filePath,
      lastAccessAt: Number(entry?.lastAccessAt || 0)
    }))
    .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  const overflow = stationMetadataCache.size - MAX_METADATA_CACHE_ENTRIES;
  for (const row of rows.slice(0, overflow)) {
    stationMetadataCache.delete(row.filePath);
  }
}

function readMetadataCache(item, now = Date.now()) {
  const filePath = String(item?.path || '').trim();
  if (!filePath) return null;
  const cached = stationMetadataCache.get(filePath);
  if (!cached) return null;
  if (Number(cached.expiresAt || 0) <= now) {
    stationMetadataCache.delete(filePath);
    return null;
  }
  if (String(cached.fingerprint || '') !== itemFingerprint(item)) {
    stationMetadataCache.delete(filePath);
    return null;
  }
  stationMetadataCache.set(filePath, {
    ...cached,
    lastAccessAt: now
  });
  return cached.metadata ?? null;
}

function writeMetadataCache(item, metadata, now = Date.now()) {
  const filePath = String(item?.path || '').trim();
  if (!filePath) return;
  stationMetadataCache.set(filePath, {
    fingerprint: itemFingerprint(item),
    metadata: metadata ?? null,
    lastAccessAt: now,
    expiresAt: now + METADATA_CACHE_TTL_MS
  });
  pruneMetadataCache(now);
}

async function safeStat(target) {
  try {
    return await fs.stat(target);
  } catch (_err) {
    return null;
  }
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

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (_err) {
    return;
  }

  for (const entry of entries) {
    if (bucket.length >= MAX_SCAN_ITEMS || state.scannedDirs >= MAX_SCAN_DIRS) {
      state.truncated = true;
      state.reason = bucket.length >= MAX_SCAN_ITEMS
        ? `File scan limit reached (${MAX_SCAN_ITEMS}).`
        : `Directory scan limit reached (${MAX_SCAN_DIRS}).`;
      break;
    }

    const name = String(entry?.name || '').trim();
    if (!name) continue;
    const fullPath = path.join(dirPath, name);

    if (entry.isDirectory()) {
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

    const stat = await safeStat(fullPath);
    state.scannedFiles += 1;
    const ext = extname(name);
    bucket.push({
      name,
      path: fullPath,
      ext,
      kind: inferKindByExtension(ext),
      size: Number(stat?.size || 0),
      mtime: stat?.mtime ? stat.mtime.toISOString() : null
    });
  }
}

function dirname(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx);
}

function pickMetadataCandidates(files) {
  const recents = [...files]
    .sort((a, b) => new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime())
    .slice(0, 20);

  const grouped = new Map();
  for (const item of files) {
    const folder = dirname(item.path);
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder).push(item);
  }

  const groupedRows = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .map(([folder, rows]) => ({
      folder,
      rows: rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en')).slice(0, 10)
    }))
    .slice(0, 30);

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

  for (const group of groupedRows) {
    if (picked.length >= MAX_METADATA_ITEMS) break;
    for (const item of group.rows) {
      if (picked.length >= MAX_METADATA_ITEMS) break;
      pushCandidate(item);
    }
  }

  return picked;
}

async function fetchMetadataBatch(candidates) {
  const now = Date.now();
  pruneMetadataCache(now);

  const stats = {
    cached: 0,
    requested: 0,
    fetched: 0,
    failed: 0,
    lastBatchMs: 0
  };

  for (const item of candidates) {
    const cached = readMetadataCache(item, now);
    if (cached !== null && cached !== undefined) {
      stats.cached += 1;
    }
  }

  const missing = candidates.filter((item) => readMetadataCache(item) === null);
  stats.requested = missing.length;

  const started = Date.now();
  for (const item of missing) {
    try {
      const metadata = await mediaService.getStationMetadata(item.path);
      writeMetadataCache(item, metadata);
      stats.fetched += 1;
    } catch (_err) {
      writeMetadataCache(item, { unavailable: true });
      stats.failed += 1;
    }
  }
  stats.lastBatchMs = Date.now() - started;
  return stats;
}

async function run() {
  const paths = await serverConfig.getPaths();
  const root = String(process.argv[2] || paths?.allowedRoots?.[0] || '').trim();
  if (!root) {
    throw new Error('No allowed root found.');
  }

  const state = {
    scannedDirs: 0,
    scannedFiles: 0,
    skippedDirs: 0,
    truncated: false,
    reason: ''
  };
  const bucket = [];
  const scanStarted = Date.now();
  await scanDirectory(root, 0, bucket, state);
  const scanMs = Date.now() - scanStarted;

  const candidates = pickMetadataCandidates(bucket);
  const cold = await fetchMetadataBatch(candidates);
  const warm = await fetchMetadataBatch(candidates);

  const result = {
    timestamp: new Date().toISOString(),
    root,
    limits: {
      maxScanItems: MAX_SCAN_ITEMS,
      maxScanDirs: MAX_SCAN_DIRS,
      maxDepth: MAX_DEPTH,
      maxMetadataItems: MAX_METADATA_ITEMS
    },
    scan: {
      durationMs: scanMs,
      ...state,
      collectedFiles: bucket.length
    },
    metadataCandidates: candidates.length,
    metadata: {
      cold,
      warm,
      cacheSize: stationMetadataCache.size
    }
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
