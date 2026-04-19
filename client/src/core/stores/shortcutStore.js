import { writable, get } from 'svelte/store';
import { addToast } from './toastStore.js';

export const shortcuts = writable([]);
let isInitialized = false;

export const initShortcuts = async () => {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    if (!token) return;

    const res = await fetch('/api/system/state/shortcuts', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status === 404) {
        isInitialized = true; // No shortcuts yet, that's fine
      }
      return;
    }

    const json = await res.json();
    if (json.data && json.data.shortcuts) {
      shortcuts.set(json.data.shortcuts);
    }
    isInitialized = true;
  } catch (e) {
    console.error('Failed to load shortcuts state', e);
  }
};

let saveTimeout;
const saveState = (items) => {
  if (!isInitialized) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    fetch('/api/system/state/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ shortcuts: items })
    }).catch(console.error);
  }, 1000);
};

shortcuts.subscribe(items => saveState(items));

export function addShortcut(item) {
  const current = get(shortcuts);
  if (current.find(s => s.path === item.path)) {
    addToast('Shortcut already exists on desktop', 'info');
    return;
  }
  
  const newShortcut = {
    id: `shortcut-${Date.now()}`,
    name: item.name,
    path: item.path,
    isDirectory: item.isDirectory,
    ext: item.name.split('.').pop().toLowerCase()
  };
  
  shortcuts.update(items => [...items, newShortcut]);
  addToast('Shortcut added to desktop', 'success');
}

export function removeShortcut(id) {
  shortcuts.update(items => items.filter(s => s.id !== id));
}
