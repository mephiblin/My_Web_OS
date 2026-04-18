import { writable } from 'svelte/store';

export const isAuthenticated = writable(!!localStorage.getItem('web_os_token'));

export function login(token) {
  localStorage.setItem('web_os_token', token);
  isAuthenticated.set(true);
}

export function logout() {
  localStorage.removeItem('web_os_token');
  isAuthenticated.set(false);
}
