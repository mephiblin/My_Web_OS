import { writable } from 'svelte/store';

const DEFAULT_TASKBAR_SETTINGS = {
  showStartButton: true,
  showDesktopSwitcher: true,
  showSearch: true,
  showSystemTray: true,
  showClock: true,
  compactMode: false,
  iconSize: 'md'
};

function normalizeTaskbarSettings(value = {}) {
  return {
    showStartButton: value?.showStartButton !== false,
    showDesktopSwitcher: value?.showDesktopSwitcher !== false,
    showSearch: value?.showSearch !== false,
    showSystemTray: value?.showSystemTray !== false,
    showClock: value?.showClock !== false,
    compactMode: value?.compactMode === true,
    iconSize: ['sm', 'md', 'lg'].includes(value?.iconSize) ? value.iconSize : 'md'
  };
}

const createTaskbarStore = () => {
  const { subscribe, set, update } = writable(DEFAULT_TASKBAR_SETTINGS);
  let isInitialized = false;
  let saveTimeout;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/system/state/taskbar', { headers });
      if (res.ok) {
        const json = await res.json();
        set(normalizeTaskbarSettings(json?.data || {}));
      } else {
        set(DEFAULT_TASKBAR_SETTINGS);
      }
    } catch (error) {
      console.error('Error initializing taskbar settings:', error);
      set(DEFAULT_TASKBAR_SETTINGS);
    } finally {
      isInitialized = true;
    }
  };

  subscribe((settings) => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/taskbar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify(settings)
      }).catch((error) => console.error('Error saving taskbar settings:', error));
    }, 500);
  });

  return {
    subscribe,
    init,
    updateSettings: (newSettings) =>
      update((current) => normalizeTaskbarSettings({ ...current, ...newSettings })),
    reset: () => set(DEFAULT_TASKBAR_SETTINGS)
  };
};

export const taskbarSettings = createTaskbarStore();
