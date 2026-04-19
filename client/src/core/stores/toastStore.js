import { writable } from 'svelte/store';
import { notifications } from './notificationStore.js';

export const toasts = writable([]);

export function addToast(message, type = 'info', duration = 3000, persist = false) {
  const id = Math.random().toString(36).substring(2, 9);
  toasts.update(all => [...all, { id, message, type }]);
  
  if (persist) {
    notifications.add({ title: type.toUpperCase(), message, type });
  }

  if (duration > 0) {
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }
}

export function removeToast(id) {
  toasts.update(all => all.filter(t => t.id !== id));
}
