import { apiFetch } from '../../utils/api.js';

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

function inferWallpaperKind(name = '') {
  if (VIDEO_EXT_RE.test(name)) return 'video';
  return 'image';
}

export function buildMediaLibraryWallpaperUrl(itemId) {
  return `/api/media-library-files/wallpapers/${encodeURIComponent(String(itemId || ''))}`;
}

function normalizeWallpaperItem(rawItem) {
  if (!rawItem) return null;

  if (typeof rawItem === 'string') {
    const id = String(rawItem);
    return {
      id,
      name: id,
      kind: inferWallpaperKind(id),
      url: buildMediaLibraryWallpaperUrl(id)
    };
  }

  const id = String(
    rawItem.id ||
      rawItem.itemId ||
      rawItem.filename ||
      rawItem.name ||
      ''
  ).trim();
  if (!id) return null;

  const name = String(rawItem.name || rawItem.filename || id);
  const url =
    String(
      rawItem.url ||
        rawItem.mediaUrl ||
        rawItem.wallpaperUrl ||
        rawItem.previewUrl ||
        ''
    ).trim() || buildMediaLibraryWallpaperUrl(id);

  return {
    id,
    name,
    kind: String(rawItem.kind || rawItem.category || inferWallpaperKind(name)),
    url
  };
}

function pickArray(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

export async function fetchWallpaperLibraryItems() {
  const payload = await apiFetch('/api/system/wallpapers/list');
  return pickArray(payload).map(normalizeWallpaperItem).filter(Boolean);
}

export async function uploadWallpaperFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch('/api/system/wallpapers/upload', {
    method: 'POST',
    body: formData
  });
}

function normalizeImportedWallpaper(payload, fallbackPath = '') {
  const candidates = [
    payload?.data?.item,
    payload?.item,
    payload?.data,
    payload
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWallpaperItem(candidate);
    if (normalized) return normalized;
  }

  const fallbackId = String(payload?.data?.itemId || payload?.itemId || '').trim();
  if (fallbackId) {
    return {
      id: fallbackId,
      name: fallbackId,
      kind: inferWallpaperKind(fallbackId),
      url: buildMediaLibraryWallpaperUrl(fallbackId)
    };
  }

  throw new Error(
    `Import did not return a media item for "${String(fallbackPath || 'selected file')}".`
  );
}

export async function importWallpaperFromLocalPath(localPath, wallpaperType = 'image') {
  const payload = await apiFetch('/api/system/wallpapers/import', {
    method: 'POST',
    body: JSON.stringify({
      sourcePath: String(localPath || ''),
      kind: wallpaperType === 'video' ? 'video' : 'image'
    })
  });
  return normalizeImportedWallpaper(payload, localPath);
}
