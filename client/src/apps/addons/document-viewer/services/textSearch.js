export function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function collectMatchOffsets(source, query) {
  if (!query) return [];
  const text = String(source || '');
  const lower = text.toLowerCase();
  const lowerQuery = String(query).toLowerCase();
  if (!lowerQuery) return [];

  const offsets = [];
  let index = 0;
  while (index < lower.length) {
    const found = lower.indexOf(lowerQuery, index);
    if (found < 0) break;
    offsets.push(found);
    index = found + lowerQuery.length;
  }
  return offsets;
}

export function renderHighlightedText(source, query, activeIndex = 0) {
  const text = String(source || '');
  if (!text) return '';
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return escapeHtml(text);
  }

  const offsets = collectMatchOffsets(text, normalizedQuery);
  const queryLength = normalizedQuery.length;
  let cursor = 0;
  let html = '';

  for (let i = 0; i < offsets.length; i += 1) {
    const offset = offsets[i];
    const before = text.slice(cursor, offset);
    const matchText = text.slice(offset, offset + queryLength);
    html += escapeHtml(before);
    html += `<mark class="${i === activeIndex ? 'active' : ''}" data-match-index="${i}">${escapeHtml(matchText)}</mark>`;
    cursor = offset + queryLength;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
}
