import { normalizeLaunchContract } from './appOwnershipContract.js';

const BUILTIN_COMPONENT_LOADERS = {
  files: () => import('../apps/system/file-explorer/FileExplorer.svelte'),
  terminal: () => import('../apps/system/terminal/Terminal.svelte'),
  calendar: () => import('../apps/system/calendar/Calendar.svelte'),
  'nexus-term': () => import('../apps/system/nexus-term/NexusTerm.svelte'),
  monitor: () => import('../apps/system/resource-monitor/ResourceMonitor.svelte'),
  editor: () => import('../apps/addons/code-editor/CodeEditor.svelte'),
  docker: () => import('../apps/system/docker-manager/DockerManager.svelte'),
  settings: () => import('../apps/system/settings/Settings.svelte'),
  'control-panel': () => import('../apps/system/control-panel/ControlPanel.svelte'),
  transfer: () => import('../apps/system/transfer/TransferUI.svelte'),
  'download-station': () => import('../apps/system/download-station/DownloadStation.svelte'),
  'photo-station': () => import('../apps/system/photo-station/PhotoStation.svelte'),
  'music-station': () => import('../apps/system/music-station/MusicStation.svelte'),
  'document-station': () => import('../apps/system/document-station/DocumentStation.svelte'),
  'video-station': () => import('../apps/system/video-station/VideoStation.svelte'),
  player: () => import('../apps/addons/media-player/MediaPlayer.svelte'),
  'doc-viewer': () => import('../apps/addons/document-viewer/DocumentViewer.svelte'),
  'model-viewer': () => import('../apps/addons/model-viewer/ModelViewer.svelte'),
  logs: () => import('../apps/system/log-viewer/LogViewer.svelte'),
  'package-center': () => import('../apps/system/package-center/PackageCenter.svelte'),
  'widget-store': () => import('../apps/addons/widget-store/WidgetStore.svelte')
};

const componentCache = new Map();

export function normalizeAppLaunch(app = {}) {
  return normalizeLaunchContract(app);
}

export function getWindowComponentKey(windowLike = {}) {
  const launch = normalizeAppLaunch(windowLike);
  return String(launch.componentId || windowLike.appId || windowLike.id || '').trim();
}

export function resolveWindowLaunch(windowLike = {}) {
  const launch = normalizeAppLaunch(windowLike);
  const componentKey = launch.mode === 'component' ? getWindowComponentKey(windowLike) : '';
  return {
    launch,
    componentKey,
    hasBuiltinComponent: launch.mode === 'component' && Boolean(BUILTIN_COMPONENT_LOADERS[componentKey])
  };
}

export async function loadBuiltinComponent(componentKey) {
  const key = String(componentKey || '').trim();
  if (!key || !BUILTIN_COMPONENT_LOADERS[key]) return null;
  if (!componentCache.has(key)) {
    componentCache.set(
      key,
      BUILTIN_COMPONENT_LOADERS[key]().then((module) => module.default || null)
    );
  }
  return componentCache.get(key);
}
