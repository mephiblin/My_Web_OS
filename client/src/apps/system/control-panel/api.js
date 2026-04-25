import { apiFetch } from '../../../utils/api.js';

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

function isHttp404(error) {
  const message = String(error?.message || '');
  return message.includes('404');
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

function pickLanguagePackArray(payload) {
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.packs)) return payload.data.packs;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.packs)) return payload.packs;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeLanguagePackMeta(rawPack) {
  if (!rawPack || typeof rawPack !== 'object') return null;
  const code = String(rawPack.code || rawPack.locale || rawPack.id || '').trim().toLowerCase();
  if (!code) return null;
  const name = String(rawPack.name || rawPack.label || code.toUpperCase()).trim() || code.toUpperCase();
  const nativeName = String(rawPack.nativeName || rawPack.displayName || name).trim() || name;
  return { code, name, nativeName };
}

export async function fetchLanguagePackList() {
  try {
    const payload = await apiFetch('/api/system/language-packs');
    return pickLanguagePackArray(payload).map(normalizeLanguagePackMeta).filter(Boolean);
  } catch (error) {
    if (isHttp404(error)) return [];
    throw error;
  }
}

function normalizeLanguagePackMessages(payload) {
  const candidates = [
    payload?.data?.messages,
    payload?.messages,
    payload?.data?.pack?.messages,
    payload?.pack?.messages
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return {};
}

export async function fetchLanguagePackMessages(code) {
  try {
    const payload = await apiFetch(`/api/system/language-packs/${encodeURIComponent(String(code || '').trim().toLowerCase())}`);
    return normalizeLanguagePackMessages(payload);
  } catch (error) {
    if (isHttp404(error)) return {};
    throw error;
  }
}

export async function uploadLanguagePackFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch('/api/system/language-packs/upload', {
    method: 'POST',
    body: formData
  });
}
