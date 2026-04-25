import { writable } from 'svelte/store';

const DEFAULT_SETTINGS = {
  blurIntensity: 20,
  transparency: 0.05,
  accentColor: '#58a6ff',
  language: 'en',
  wallpaperType: 'css', // can be 'css', 'image', 'video'
  wallpaper: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)',
  wallpaperId: 'default',
  wallpaperFit: 'cover',
  desktopIconScale: 1
};

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function normalizeSettings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const wallpaperType = ['css', 'image', 'video'].includes(source.wallpaperType)
    ? source.wallpaperType
    : DEFAULT_SETTINGS.wallpaperType;
  const wallpaperFit = ['cover', 'contain', 'stretch', 'center', 'tile'].includes(source.wallpaperFit)
    ? source.wallpaperFit
    : DEFAULT_SETTINGS.wallpaperFit;

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    blurIntensity: clampNumber(source.blurIntensity, DEFAULT_SETTINGS.blurIntensity, 0, 40),
    transparency: clampNumber(source.transparency, DEFAULT_SETTINGS.transparency, 0.05, 0.5),
    accentColor: typeof source.accentColor === 'string' && source.accentColor.trim()
      ? source.accentColor
      : DEFAULT_SETTINGS.accentColor,
    language: typeof source.language === 'string' && source.language.trim()
      ? source.language.trim().toLowerCase()
      : DEFAULT_SETTINGS.language,
    wallpaperType,
    wallpaper: typeof source.wallpaper === 'string' && source.wallpaper.trim()
      ? source.wallpaper
      : DEFAULT_SETTINGS.wallpaper,
    wallpaperId: typeof source.wallpaperId === 'string' && source.wallpaperId.trim()
      ? source.wallpaperId
      : DEFAULT_SETTINGS.wallpaperId,
    wallpaperFit,
    desktopIconScale: clampNumber(source.desktopIconScale, DEFAULT_SETTINGS.desktopIconScale, 0.8, 1.25)
  };
}

const createSystemStore = () => {
  const { subscribe, set, update } = writable(normalizeSettings(DEFAULT_SETTINGS));
  let isInitialized = false;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      if (!token) return;

      const res = await fetch('/api/system/state/settings', { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) return;

      const json = await res.json();
      if (json.data !== undefined) {
        set(normalizeSettings(json.data || DEFAULT_SETTINGS));
        isInitialized = true;
      }
    } catch (e) {
      console.error('Error initializing system settings:', e);
    }
  };

  // Persistence logic
  let saveTimeout;
  subscribe(settings => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--glass-blur', `${settings.blurIntensity}px`);
      document.documentElement.style.setProperty('--glass-opacity', `${settings.transparency}`);
      document.documentElement.style.setProperty('--accent-blue', settings.accentColor);
    }

    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(settings)
      }).catch(console.error);
    }, 500);
  });

  return {
    subscribe,
    init,
    updateSettings: (newSettings) => update(s => normalizeSettings({ ...s, ...newSettings })),
    reset: () => set(normalizeSettings(DEFAULT_SETTINGS))
  };
};

export const systemSettings = createSystemStore();
