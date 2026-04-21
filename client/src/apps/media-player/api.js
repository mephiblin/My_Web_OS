import { apiFetch } from '../../utils/api.js';

function withPathQuery(path) {
  return `path=${encodeURIComponent(String(path || ''))}`;
}

export async function fetchMediaInfo(path) {
  return apiFetch(`/api/media/info?${withPathQuery(path)}`);
}

export async function fetchMediaSubtitles(path) {
  return apiFetch(`/api/media/subtitles?${withPathQuery(path)}`);
}

export async function fetchMediaNeighbors(path, type = 'media') {
  return apiFetch(`/api/media/neighbors?${withPathQuery(path)}&type=${encodeURIComponent(type)}`);
}

export async function fetchMediaPlaylist(path) {
  return apiFetch(`/api/media/playlist?${withPathQuery(path)}`);
}
