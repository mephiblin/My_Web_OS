const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);
const DOCUMENT_EXTENSIONS = new Set(['pdf']);

export function buildShortcutLaunch(shortcut = {}) {
  if (shortcut.kind === 'app' && shortcut.appId) {
    return {
      app: { id: shortcut.appId, title: shortcut.name || shortcut.appId },
      iconKey: 'AppWindow',
      data: null
    };
  }

  if (shortcut.isDirectory) {
    return {
      app: { id: 'files', title: 'File Station' },
      iconKey: 'Folder',
      data: { path: shortcut.path }
    };
  }

  const ext = String(shortcut.ext || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return {
      app: { id: 'player', title: `Viewer - ${shortcut.name}` },
      iconKey: 'Image',
      data: { path: shortcut.path }
    };
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return {
      app: { id: 'player', title: `Player - ${shortcut.name}` },
      iconKey: 'Video',
      data: { path: shortcut.path }
    };
  }

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return {
      app: { id: 'doc-viewer', title: `PDF Reader - ${shortcut.name}` },
      iconKey: 'File',
      data: { path: shortcut.path }
    };
  }

  return {
    app: { id: 'editor', title: `Editor - ${shortcut.name}` },
    iconKey: 'File',
    data: { path: shortcut.path }
  };
}
