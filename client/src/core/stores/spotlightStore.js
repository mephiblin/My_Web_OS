import { writable } from 'svelte/store';

export const spotlightVisible = writable(false);
export const spotlightQuery = writable('');

export function openSpotlight() {
  spotlightVisible.set(true);
  spotlightQuery.set('');
}

export function closeSpotlight() {
  spotlightVisible.set(false);
  spotlightQuery.set('');
}

export function toggleSpotlight() {
  spotlightVisible.update(v => !v);
}
