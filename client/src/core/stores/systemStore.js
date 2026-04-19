import { writable } from 'svelte/store';

const DEFAULT_SETTINGS = {
  blurIntensity: 20,
  transparency: 0.05,
  accentColor: '#58a6ff',
  wallpaperType: 'css', // can be 'css', 'image', 'video'
  wallpaper: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)',
  wallpaperId: 'default'
};

const createSystemStore = () => {
  // Load from localStorage
  const saved = localStorage.getItem('web_os_system_settings');
  const initial = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  
  const { subscribe, set, update } = writable(initial);

  return {
    subscribe,
    updateSettings: (newSettings) => {
      update(s => {
        const updated = { ...s, ...newSettings };
        localStorage.setItem('web_os_system_settings', JSON.stringify(updated));
        
        // Apply to CSS variables
        if (updated.blurIntensity !== undefined) {
          document.documentElement.style.setProperty('--glass-blur', `${updated.blurIntensity}px`);
        }
        if (updated.transparency !== undefined) {
          document.documentElement.style.setProperty('--glass-opacity', updated.transparency);
        }
        if (updated.accentColor !== undefined) {
          document.documentElement.style.setProperty('--accent-blue', updated.accentColor);
        }
        
        return updated;
      });
    },
    reset: () => {
      set(DEFAULT_SETTINGS);
      localStorage.removeItem('web_os_system_settings');
    }
  };
};

export const systemSettings = createSystemStore();
