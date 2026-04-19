import { writable } from 'svelte/store';

const DEFAULT_WIDGETS = [
  { id: 'widget-clock', type: 'preset', source: 'clock', title: 'Clock', x: 20, y: 30, w: 200, h: 200, locked: true },
  { id: 'widget-monitor', type: 'system', source: 'sys-cpu', title: 'CPU Monitor', x: 20, y: 250, w: 220, h: 200, locked: true }
];

const createWidgetStore = () => {
  const { subscribe, set, update } = writable([]);
  let isInitialized = false;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      if (!token) return; // Wait for login

      const res = await fetch('/api/system/state/widgets', { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      
      if (!res.ok) {
        console.error('Failed to fetch widgets:', res.status);
        return; // Don't allow saving if we can't load
      }

      const json = await res.json();
      // Only set if we actually got data or empty array back
      if (json.data !== undefined) {
        set(json.data || DEFAULT_WIDGETS);
        isInitialized = true; // Mark as ready to save now
      } else {
        set(DEFAULT_WIDGETS);
        isInitialized = true;
      }
    } catch (e) {
      console.error('Error initializing widgets:', e);
      // Don't set isInitialized = true here, so we don't overwrite server with defaults
    }
  };

  let saveTimeout;
  subscribe(items => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/widgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(items)
      }).catch(console.error);
    }, 500);
  });

  return {
    subscribe,
    init,
    addWidget: (widget) => {
      update(items => {
        const newId = `widget-${Date.now()}`;
        return [...items, { 
          id: newId, 
          type: widget.type || 'preset',
          source: widget.source || 'clock',
          title: widget.title || 'Widget',
          x: 100 + Math.random() * 200, 
          y: 100 + Math.random() * 200, 
          w: widget.w || 250, 
          h: widget.h || 200, 
          locked: true 
        }];
      });
    },
    removeWidget: (id) => update(items => items.filter(w => w.id !== id)),
    updateWidget: (id, data) => update(items => items.map(w => w.id === id ? { ...w, ...data } : w)),
    toggleLock: (id) => update(items => items.map(w => w.id === id ? { ...w, locked: !w.locked } : w)),
    reset: () => set(DEFAULT_WIDGETS)
  };
};

export const widgets = createWidgetStore();
