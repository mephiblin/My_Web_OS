import { apiFetch } from '../../../utils/api.js';

export async function fetchCalendarEvents(options = {}) {
  const params = new URLSearchParams();
  if (options.from) params.set('from', String(options.from));
  if (options.to) params.set('to', String(options.to));
  const query = params.toString();
  return apiFetch(`/api/system/calendar/events${query ? `?${query}` : ''}`);
}

export async function fetchCalendarMonth(year, month) {
  const y = Number.parseInt(String(year), 10);
  const m = Number.parseInt(String(month), 10);
  return apiFetch(`/api/system/calendar/month?year=${encodeURIComponent(y)}&month=${encodeURIComponent(m)}`);
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
