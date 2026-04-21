import { writable } from 'svelte/store';

const MAX_PRESETS = 64;

function normalizeThemePreset(item, index) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').trim();
  if (!name) return null;
  return {
    id: String(item.id || `theme-preset-${index + 1}`),
    name: name.slice(0, 80),
    settings: item.settings && typeof item.settings === 'object' ? item.settings : {},
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
  };
}

function normalizePresetList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PRESETS)
    .map((item, index) => normalizeThemePreset(item, index))
    .filter(Boolean);
}

const createThemePresetStore = () => {
  const { subscribe, set, update } = writable([]);
  let isInitialized = false;
  let saveTimeout;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/system/state/themePresets', { headers });
      if (res.ok) {
        const json = await res.json();
        set(normalizePresetList(json?.data || []));
      } else {
        set([]);
      }
    } catch (error) {
      console.error('Error initializing theme presets:', error);
      set([]);
    } finally {
      isInitialized = true;
    }
  };

  subscribe((presets) => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/themePresets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify(normalizePresetList(presets))
      }).catch((error) => console.error('Error saving theme presets:', error));
    }, 500);
  });

  return {
    subscribe,
    init,
    addPreset: (name, settings) => {
      const trimmedName = String(name || '').trim();
      if (!trimmedName) return null;
      let created = null;
      update((current) => {
        const next = normalizePresetList(current);
        if (next.length >= MAX_PRESETS) {
          next.shift();
        }
        created = {
          id: `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name: trimmedName.slice(0, 80),
          settings: settings && typeof settings === 'object' ? settings : {},
          createdAt: Date.now()
        };
        return [...next, created];
      });
      return created;
    },
    removePreset: (presetId) => {
      const target = String(presetId || '').trim();
      if (!target) return;
      update((current) => current.filter((item) => String(item.id) !== target));
    },
    reset: () => set([])
  };
};

export const themePresets = createThemePresetStore();
