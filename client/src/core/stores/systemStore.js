import { writable } from 'svelte/store';

const DEFAULT_SETTINGS = {
  blurIntensity: 20,
  transparency: 0.05,
  accentColor: '#58a6ff',
  wallpaperType: 'css', // can be 'css', 'image', 'video'
  wallpaper: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)',
  wallpaperId: 'default',
  wallpaperFit: 'cover'
};

const createSystemStore = () => {
  const { subscribe, set, update } = writable(DEFAULT_SETTINGS);
  let isInitialized = false;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      if (!token) return;

      const res = await fetch('/api/system/state/settings', { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) return;

      const json = await res.json();
      if (json.data !== undefined) {
        set(json.data || DEFAULT_SETTINGS);
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
    updateSettings: (newSettings) => update(s => ({ ...s, ...newSettings })),
    reset: () => set(DEFAULT_SETTINGS)
  };
};

export const systemSettings = createSystemStore();
