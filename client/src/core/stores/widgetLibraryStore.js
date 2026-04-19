import { writable } from 'svelte/store';

const createLibraryStore = () => {
  const { subscribe, set, update } = writable([]);
  let isInitialized = false;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      if (!token) return;

      const res = await fetch('/api/system/state/widget_library', { 
        headers: { 'Authorization': `Bearer ${token}` } 
      });
      
      if (!res.ok) return;

      const json = await res.json();
      if (json.data !== undefined) {
        set(json.data || []);
        isInitialized = true;
      }
    } catch (e) {
      console.error('Error initializing widget library:', e);
    }
  };

  let saveTimeout;
  subscribe(items => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/widget_library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(items)
      }).catch(console.error);
    }, 500);
  });

  return {
    subscribe,
    init,
    addTemplate: (item) => update(items => {
      const newId = `tpl-${Date.now()}`;
      return [...items, { ...item, id: newId }];
    }),
    updateTemplate: (id, data) => update(items => items.map(i => i.id === id ? { ...i, ...data } : i)),
    removeTemplate: (id) => update(items => items.filter(i => i.id !== id))
  };
};

export const widgetLibrary = createLibraryStore();
