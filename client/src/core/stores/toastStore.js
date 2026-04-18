import { writable } from 'svelte/store';

export const toasts = writable([]);

export function addToast(message, type = 'info', duration = 3000) {
  const id = Math.random().toString(36).substring(2, 9);
  toasts.update(all => [...all, { id, message, type }]);
  
  if (duration > 0) {
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }
}

export function removeToast(id) {
  toasts.update(all => all.filter(t => t.id !== id));
}
