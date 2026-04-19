import { writable } from 'svelte/store';

// Default initial widgets layout
const DEFAULT_WIDGETS = [
  { id: 'widget-clock', type: 'clock', x: 20, y: 30, w: 2, h: 2 },
  { id: 'widget-monitor', type: 'monitor', x: 20, y: 150, w: 2, h: 3 }
];

const createWidgetStore = () => {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_widgets') : null;
  const initial = saved ? JSON.parse(saved) : DEFAULT_WIDGETS;
  
  const { subscribe, set, update } = writable(initial);

  // Persistence logic
  let saveTimeout;
  if (typeof localStorage !== 'undefined') {
    subscribe(items => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        localStorage.setItem('web_os_widgets', JSON.stringify(items));
      }, 500);
    });
  }

  return {
    subscribe,
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
