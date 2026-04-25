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

const SUPPORTED_FILE_ACTIONS = new Set(['preview', 'open', 'edit', 'import', 'export']);
const FILE_TEMPLATE_CONTENT_MAX = 64 * 1024;

function normalizeExtensionList(values) {
  return Array.isArray(values)
    ? values.map((item) => String(item || '').trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
    : [];
}

function normalizeAction(value, fallback = 'open') {
  const action = String(value || '').trim().toLowerCase();
  return SUPPORTED_FILE_ACTIONS.has(action) ? action : fallback;
}

function appSupportsFileAction(app, extension, action) {
  const normalizedExt = String(extension || '').trim().toLowerCase();
  const normalizedAction = normalizeAction(action);
  if (!normalizedExt) return false;

  const rows = Array.isArray(app?.fileAssociations) ? app.fileAssociations : [];
  return rows.some((row) => {
    const extensions = normalizeExtensionList(row?.extensions);
    if (!extensions.includes(normalizedExt)) return false;
    const actions = Array.isArray(row?.actions)
      ? row.actions.map((item) => normalizeAction(item, '')).filter(Boolean)
      : [];
    const defaultAction = normalizeAction(row?.defaultAction || actions[0]);
    return actions.length === 0 || actions.includes(normalizedAction) || defaultAction === normalizedAction;
  });
}

export function findAssociationMatches(apps = [], extension, action = '') {
  const normalizedExt = String(extension || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  const matched = [];

  if (!normalizedExt) return matched;

  for (const app of Array.isArray(apps) ? apps : []) {
    const rows = Array.isArray(app?.fileAssociations) ? app.fileAssociations : [];
    for (const row of rows) {
      const extensions = normalizeExtensionList(row?.extensions);
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

export function findFileContextContributions(apps = [], extension) {
  const normalizedExt = String(extension || '').trim().toLowerCase();
  const matched = [];
  if (!normalizedExt) return matched;

  for (const app of Array.isArray(apps) ? apps : []) {
    const rows = Array.isArray(app?.contributes?.fileContextMenu) ? app.contributes.fileContextMenu : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const action = normalizeAction(row.action || row.defaultAction || 'open');
      const extensions = normalizeExtensionList(row.extensions);
      const explicitMatch = extensions.includes(normalizedExt);
      const associationMatch = extensions.length === 0 && appSupportsFileAction(app, normalizedExt, action);
      if (!explicitMatch && !associationMatch) continue;

      const label = String(row.label || '').trim() || `${action === 'edit' ? 'Edit' : 'Open'} with ${app.title || app.id}`;
      matched.push({
        app,
        appId: app.id,
        action,
        label,
        extensions,
        source: 'manifest-contributes'
      });
    }
  }

  return matched
    .filter((item) => item.appId)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.appId).localeCompare(String(b.appId)));
}

export function findFileCreateTemplates(apps = []) {
  const matched = [];

  for (const app of Array.isArray(apps) ? apps : []) {
    const rows = Array.isArray(app?.contributes?.fileCreateTemplates) ? app.contributes.fileCreateTemplates : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const label = String(row.label || '').trim();
      const name = String(row.name || row.defaultName || '').trim();
      const extension = String(row.extension || getFileExtension(name) || '').trim().toLowerCase().replace(/^\./, '');
      const content = typeof row.content === 'string' ? row.content : '';
      if (
        !label ||
        !name ||
        !extension ||
        name.includes('/') ||
        name.includes('\\') ||
        content.length > FILE_TEMPLATE_CONTENT_MAX
      ) {
        continue;
      }

      matched.push({
        app,
        appId: app.id,
        label,
        name,
        extension,
        content,
        action: normalizeAction(row.action || 'edit', 'edit'),
        openAfterCreate: row.openAfterCreate !== false,
        source: 'manifest-contributes'
      });
    }
  }

  return matched
    .filter((item) => item.appId)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.appId).localeCompare(String(b.appId)));
}

export function findPreviewProviderMatches(apps = [], extension) {
  const normalizedExt = String(extension || '').trim().toLowerCase();
  const matched = [];
  if (!normalizedExt) return matched;

  for (const app of Array.isArray(apps) ? apps : []) {
    const rows = Array.isArray(app?.contributes?.previewProviders) ? app.contributes.previewProviders : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const extensions = normalizeExtensionList(row.extensions);
      const explicitMatch = extensions.includes(normalizedExt);
      const associationMatch =
        extensions.length === 0 &&
        (appSupportsFileAction(app, normalizedExt, 'preview') || appSupportsFileAction(app, normalizedExt, 'open'));
      if (!explicitMatch && !associationMatch) continue;

      const label = String(row.label || '').trim() || `${app.title || app.id} Preview`;
      matched.push({
        app,
        appId: app.id,
        label,
        extensions,
        source: 'manifest-preview-provider'
      });
    }
  }

  return matched
    .filter((item) => item.appId)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.appId).localeCompare(String(b.appId)));
}

export function findThumbnailProviderMatches(apps = [], extension) {
  const normalizedExt = String(extension || '').trim().toLowerCase();
  const matched = [];
  if (!normalizedExt) return matched;

  for (const app of Array.isArray(apps) ? apps : []) {
    const rows = Array.isArray(app?.contributes?.thumbnailProviders) ? app.contributes.thumbnailProviders : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const extensions = normalizeExtensionList(row.extensions);
      const explicitMatch = extensions.includes(normalizedExt);
      const associationMatch =
        extensions.length === 0 &&
        (appSupportsFileAction(app, normalizedExt, 'preview') || appSupportsFileAction(app, normalizedExt, 'open'));
      if (!explicitMatch && !associationMatch) continue;

      const label = String(row.label || '').trim() || `${app.title || app.id} Thumbnail`;
      matched.push({
        app,
        appId: app.id,
        label,
        extensions,
        source: 'manifest-thumbnail-provider'
      });
    }
  }

  return matched
    .filter((item) => item.appId)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)) || String(a.appId).localeCompare(String(b.appId)));
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
