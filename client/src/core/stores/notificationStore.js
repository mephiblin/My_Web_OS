import { writable } from 'svelte/store';

/**
 * @typedef {Object} AppNotification
 * @property {string} id
 * @property {string} title
 * @property {string} message
 * @property {string} type - 'info', 'success', 'warning', 'error'
 * @property {string} timestamp
 * @property {boolean} read
 * @property {string} [appId]
 */

const createNotificationStore = () => {
  const { subscribe, update } = writable([]);

  function createNotificationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  return {
    subscribe,
    /**
     * @param {Omit<AppNotification, 'id' | 'timestamp' | 'read'>} notification
     */
    add: (notification) => {
      update(items => [
        {
          id: createNotificationId(),
          timestamp: new Date().toISOString(),
          read: false,
          ...notification
        },
        ...items
      ].slice(0, 50)); // Keep last 50 notifications
    },
    markAsRead: (id) => {
      update(items => items.map(item => item.id === id ? { ...item, read: true } : item));
    },
    markAllAsRead: () => {
      update(items => items.map(item => ({ ...item, read: true })));
    },
    remove: (id) => {
      update(items => items.filter(item => item.id !== id));
    },
    clearAll: () => {
      update(() => []);
    }
  };
};

export const notifications = createNotificationStore();
