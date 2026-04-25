export function getFileExtension(fileName = '') {
  const segments = String(fileName || '').split('.');
  if (segments.length < 2) return '';
  return String(segments.pop() || '').trim().toLowerCase();
}

export function inferPreferredActionByExtension(extension) {
  const ext = String(extension || '').trim().toLowerCase();
  if (!ext) return 'open';
  if (['txt', 'md', 'markdown', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yml', 'yaml', 'csv', 'log'].includes(ext)) {
    return 'edit';
  }
  return 'open';
}

export function findAssociationMatches(apps = [], extension, action = '') {
  const normalizedExt = String(extension || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  const matched = [];

  if (!normalizedExt) return matched;

  for (const app of Array.isArray(apps) ? apps : []) {
    const rows = Array.isArray(app?.fileAssociations) ? app.fileAssociations : [];
    for (const row of rows) {
      const extensions = Array.isArray(row?.extensions)
        ? row.extensions.map((item) => String(item || '').trim().toLowerCase())
        : [];
      if (!extensions.includes(normalizedExt)) continue;

      const actions = Array.isArray(row?.actions)
        ? row.actions.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [];
      if (normalizedAction && actions.length > 0 && !actions.includes(normalizedAction)) {
        continue;
      }

      const defaultAction = String(row?.defaultAction || '').trim().toLowerCase()
        || actions[0]
        || normalizedAction
        || 'open';
      matched.push({
        app,
        appId: app.id,
        actions,
        defaultAction,
        score: defaultAction === normalizedAction ? 2 : actions.includes(normalizedAction) ? 1 : 0
      });
      break;
    }
  }

  return matched
    .filter((item) => item.appId)
    .sort((a, b) => b.score - a.score || String(a.app?.title || a.appId).localeCompare(String(b.app?.title || b.appId)));
}

export function resolveLegacyFallbackApp(extension) {
  const ext = String(extension || '').trim().toLowerCase();
  const isMedia = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext);
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
  const is3D = ['gltf', 'glb', 'fbx', 'obj'].includes(ext);
  if (isMedia || isImage) return 'player';
  if (ext === 'pdf') return 'doc-viewer';
  if (is3D) return 'model-viewer';
  return 'editor';
}

export function resolveOpenPlan(apps = [], extension, preferredAppId = '') {
  const preferredAction = inferPreferredActionByExtension(extension);
  const actionMatches = findAssociationMatches(apps, extension, preferredAction);
  const allMatches = findAssociationMatches(apps, extension);
  const preferred = String(preferredAppId || '').trim();
  const preferredMatch = preferred
    ? allMatches.find((item) => item.appId === preferred)
    : null;
  const selected = preferredMatch || actionMatches[0] || allMatches[0] || null;

  if (selected) {
    return {
      app: selected.app,
      appId: selected.appId,
      action: selected.defaultAction || preferredAction,
      source: preferredMatch ? 'user-default' : 'association'
    };
  }

  return {
    app: null,
    appId: resolveLegacyFallbackApp(extension),
    action: preferredAction,
    source: 'legacy-fallback'
  };
}
