import { apiFetch } from '../../../utils/api.js';

export async function fetchCalendarEvents(options = {}) {
  const params = new URLSearchParams();
  if (options.from) params.set('from', String(options.from));
  if (options.to) params.set('to', String(options.to));
  if (options.sources) params.set('sources', Array.isArray(options.sources) ? options.sources.join(',') : String(options.sources));
  const query = params.toString();
  return apiFetch(`/api/system/calendar/events${query ? `?${query}` : ''}`);
}

export async function fetchCalendarMonth(year, month, options = {}) {
  const y = Number.parseInt(String(year), 10);
  const m = Number.parseInt(String(month), 10);
  const params = new URLSearchParams({ year: String(y), month: String(m) });
  if (options.sources) params.set('sources', Array.isArray(options.sources) ? options.sources.join(',') : String(options.sources));
  return apiFetch(`/api/system/calendar/month?${params.toString()}`);
}

export async function createCalendarEvent(payload) {
  return apiFetch('/api/system/calendar/events', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
}

export async function updateCalendarEvent(eventId, payload) {
  return apiFetch(`/api/system/calendar/events/${encodeURIComponent(String(eventId || ''))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {})
  });
}

export async function deleteCalendarEvent(eventId) {
  return apiFetch(`/api/system/calendar/events/${encodeURIComponent(String(eventId || ''))}`, {
    method: 'DELETE'
  });
}

export async function fetchCalendarSources() {
  return apiFetch('/api/system/calendar/sources');
}

export async function createCalendarSource(payload) {
  return apiFetch('/api/system/calendar/sources', {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });
}

export async function updateCalendarSource(sourceId, payload) {
  return apiFetch(`/api/system/calendar/sources/${encodeURIComponent(String(sourceId || ''))}`, {
    method: 'PUT',
    body: JSON.stringify(payload || {})
  });
}

export async function deleteCalendarSource(sourceId) {
  return apiFetch(`/api/system/calendar/sources/${encodeURIComponent(String(sourceId || ''))}`, {
    method: 'DELETE'
  });
}

export async function fetchGoogleCalendarConfig(sourceId = 'google-primary') {
  const params = new URLSearchParams({ sourceId: String(sourceId || 'google-primary') });
  return apiFetch(`/api/system/calendar/google/config?${params.toString()}`);
}

export async function updateGoogleCalendarConfig(payload) {
  return apiFetch('/api/system/calendar/google/config', {
    method: 'PUT',
    body: JSON.stringify(payload || {})
  });
}

export function googleCalendarAuthStartUrl(sourceId = 'google-primary') {
  const params = new URLSearchParams({ sourceId: String(sourceId || 'google-primary') });
  return `/api/system/calendar/google/auth/start?${params.toString()}`;
}

export async function fetchGoogleCalendarAuthStart(sourceId = 'google-primary') {
  const params = new URLSearchParams({ sourceId: String(sourceId || 'google-primary'), format: 'json' });
  return apiFetch(`/api/system/calendar/google/auth/start?${params.toString()}`);
}

export async function syncGoogleCalendar(sourceId = 'google-primary') {
  return apiFetch('/api/system/calendar/google/sync', {
    method: 'POST',
    body: JSON.stringify({ sourceId: String(sourceId || 'google-primary') })
  });
}

export async function disconnectGoogleCalendar(sourceId = 'google-primary') {
  return apiFetch('/api/system/calendar/google/disconnect', {
    method: 'POST',
    body: JSON.stringify({ sourceId: String(sourceId || 'google-primary') })
  });
}
