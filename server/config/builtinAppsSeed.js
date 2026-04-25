const BUILTIN_APPS_SEED = [
  {
    id: 'files',
    title: 'File Station',
    icon: 'Files',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'file-explorer',
    runtime: 'builtin',
    permissions: ['system.info']
  },
  {
    id: 'terminal',
    title: 'Terminal',
    icon: 'TerminalIcon',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'terminal',
    runtime: 'builtin',
    permissions: ['system.info']
  },
  {
    id: 'monitor',
    title: 'Resource Monitor',
    icon: 'Monitor',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'resource-monitor',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'docker',
    title: 'Docker Manager',
    icon: 'Container',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'docker-manager',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: 'Settings',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'settings',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'control-panel',
    title: 'Control Panel',
    icon: 'Settings',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'control-panel',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'logs',
    title: 'Log Viewer',
    icon: 'Shield',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'log-viewer',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'package-center',
    title: 'Package Center',
    icon: 'LayoutGrid',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'package-center',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'transfer',
    title: 'Transfer',
    icon: 'Send',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'transfer',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'download-station',
    title: 'Download Station',
    icon: 'Send',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'download-station',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'photo-station',
    title: 'Photo Station',
    icon: 'Image',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'photo-station',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'music-station',
    title: 'Music Station',
    icon: 'Music2',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'music-station',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'document-station',
    title: 'Document Station',
    icon: 'FileText',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'document-station',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'video-station',
    title: 'Video Station',
    icon: 'Video',
    appModel: 'system',
    type: 'system',
    version: '1.0.0',
    entry: 'video-station',
    runtime: 'builtin',
    singleton: true,
    permissions: ['system.info']
  },
  {
    id: 'player',
    title: 'Media Player',
    icon: 'Video',
    appModel: 'standard',
    type: 'app',
    version: '1.0.0',
    entry: 'media-player',
    runtime: 'builtin',
    permissions: [],
    fileAssociations: [
      {
        extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
        actions: ['preview', 'open'],
        defaultAction: 'open'
      }
    ]
  },
  {
    id: 'doc-viewer',
    title: 'Document Viewer',
    icon: 'FileText',
    appModel: 'standard',
    type: 'app',
    version: '1.0.0',
    entry: 'document-viewer',
    runtime: 'builtin',
    permissions: [],
    fileAssociations: [
      {
        extensions: ['pdf', 'txt', 'md', 'markdown', 'json', 'csv', 'log'],
        actions: ['preview', 'open'],
        defaultAction: 'open'
      }
    ]
  },
  {
    id: 'model-viewer',
    title: 'Model Viewer',
    icon: 'Box',
    appModel: 'standard',
    type: 'app',
    version: '1.0.0',
    entry: 'model-viewer',
    runtime: 'builtin',
    permissions: [],
    fileAssociations: [
      {
        extensions: ['gltf', 'glb', 'fbx', 'obj'],
        actions: ['preview', 'open'],
        defaultAction: 'open'
      }
    ]
  },
  {
    id: 'editor',
    title: 'Code Editor',
    icon: 'Code2',
    appModel: 'standard',
    type: 'app',
    version: '1.0.0',
    entry: 'code-editor',
    runtime: 'builtin',
    permissions: [],
    fileAssociations: [
      {
        extensions: ['txt', 'md', 'markdown', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yml', 'yaml', 'csv', 'log', 'svelte', 'sh', 'py'],
        actions: ['open', 'edit'],
        defaultAction: 'edit'
      }
    ]
  },
  {
    id: 'widget-store',
    title: 'Widget Store',
    icon: 'LayoutGrid',
    appModel: 'standard',
    type: 'developer',
    version: '1.0.0',
    entry: 'widget-store',
    runtime: 'builtin',
    singleton: true,
    permissions: [],
    dataBoundary: 'inventory-app-data',
    fileAssociations: [
      {
        extensions: ['webos-widget', 'widget.json'],
        actions: ['import', 'open'],
        defaultAction: 'import'
      }
    ]
  }
];

module.exports = BUILTIN_APPS_SEED;
