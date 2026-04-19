import { writable } from 'svelte/store';

// Default initial widgets layout
const DEFAULT_WIDGETS = [
  { id: 'widget-clock', type: 'clock', x: 20, y: 30, w: 2, h: 2 },
  { id: 'widget-monitor', type: 'monitor', x: 20, y: 150, w: 2, h: 3 }
];

const createWidgetStore = () => {
  const { subscribe, set, update } = writable([]);
  let isInitialized = false;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      const res = await fetch('/api/system/state/widgets', { headers: { 'Authorization': `Bearer ${token}` } });
      const json = await res.json();
      set(json.data || DEFAULT_WIDGETS);
    } catch (e) {
      set(DEFAULT_WIDGETS);
    }
    isInitialized = true;
  };

  // Persistence logic
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
        const newId = `${widget.type}-${Date.now()}`;
        return [...items, { ...widget, id: newId }];
      });
    },
    removeWidget: (id) => update(items => items.filter(w => w.id !== id)),
    updateWidgetPosition: (id, x, y) => update(items => items.map(w => w.id === id ? { ...w, x, y } : w)),
    reset: () => set(DEFAULT_WIDGETS)
  };
};

export const widgets = createWidgetStore();
