import { writable } from 'svelte/store';

const createLibraryStore = () => {
  const { subscribe, set, update } = writable([]);
  let isInitialized = false;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      if (!token) return;

      const res = await fetch('/api/system/widget-library', { 
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

  const saveToBackend = async (item) => {
    try {
      const token = localStorage.getItem('web_os_token') || '';
      await fetch(`/api/system/widget-library/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(item)
      });
    } catch (e) { console.error('Failed to save widget template:', e); }
  };

  const deleteFromBackend = async (id) => {
    try {
      const token = localStorage.getItem('web_os_token') || '';
      await fetch(`/api/system/widget-library/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) { console.error('Failed to delete widget template:', e); }
  };

  return {
    subscribe,
    init,
    addTemplate: async (item) => {
      const newId = `tpl-${Date.now()}`;
      const newItem = { ...item, id: newId };
      update(items => [...items, newItem]);
      await saveToBackend(newItem);
    },
    updateTemplate: async (id, data) => {
      let updatedItem;
      update(items => items.map(i => {
        if (i.id === id) {
          updatedItem = { ...i, ...data };
          return updatedItem;
        }
        return i;
      }));
      if (updatedItem) await saveToBackend(updatedItem);
    },
    removeTemplate: async (id) => {
      update(items => items.filter(i => i.id !== id));
      await deleteFromBackend(id);
    }
  };
};

export const widgetLibrary = createLibraryStore();
