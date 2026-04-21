import { writable } from 'svelte/store';

const DEFAULT_WINDOW_DEFAULTS = {
  defaultWidth: 960,
  defaultHeight: 640,
  minWidth: 480,
  minHeight: 320,
  titleBarHeight: 40,
  rememberLastSize: true,
  rememberLastPosition: true
};

function normalizeWindowDefaults(value = {}) {
  const asNumber = (input, fallback) => {
    const n = Number(input);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp = (input, fallback, min, max) => {
    const n = asNumber(input, fallback);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  return {
    defaultWidth: clamp(value?.defaultWidth, DEFAULT_WINDOW_DEFAULTS.defaultWidth, 320, 3840),
    defaultHeight: clamp(value?.defaultHeight, DEFAULT_WINDOW_DEFAULTS.defaultHeight, 240, 2160),
    minWidth: clamp(value?.minWidth, DEFAULT_WINDOW_DEFAULTS.minWidth, 240, 1920),
    minHeight: clamp(value?.minHeight, DEFAULT_WINDOW_DEFAULTS.minHeight, 180, 1080),
    titleBarHeight: clamp(value?.titleBarHeight, DEFAULT_WINDOW_DEFAULTS.titleBarHeight, 28, 72),
    rememberLastSize: typeof value?.rememberLastSize === 'boolean' ? value.rememberLastSize : DEFAULT_WINDOW_DEFAULTS.rememberLastSize,
    rememberLastPosition: typeof value?.rememberLastPosition === 'boolean' ? value.rememberLastPosition : DEFAULT_WINDOW_DEFAULTS.rememberLastPosition
  };
}

const createWindowDefaultsStore = () => {
  const { subscribe, set, update } = writable(DEFAULT_WINDOW_DEFAULTS);
  let isInitialized = false;
  let saveTimeout;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/system/state/windowDefaults', { headers });

      if (res.ok) {
        const json = await res.json();
        set(normalizeWindowDefaults(json?.data || {}));
      } else {
        set(DEFAULT_WINDOW_DEFAULTS);
      }
    } catch (error) {
      console.error('Error initializing window defaults:', error);
      set(DEFAULT_WINDOW_DEFAULTS);
    } finally {
      isInitialized = true;
    }
  };

  subscribe((settings) => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/windowDefaults', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify(settings)
      }).catch((error) => console.error('Error saving window defaults:', error));
    }, 500);
  });

  return {
    subscribe,
    init,
    updateSettings: (nextSettings) =>
      update((current) => normalizeWindowDefaults({ ...current, ...nextSettings })),
    reset: () => set(DEFAULT_WINDOW_DEFAULTS)
  };
};

export const windowDefaultsSettings = createWindowDefaultsStore();
