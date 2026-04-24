import FileExplorer from '../apps/system/file-explorer/FileExplorer.svelte';
import TerminalApp from '../apps/system/terminal/Terminal.svelte';
import ResourceMonitor from '../apps/system/resource-monitor/ResourceMonitor.svelte';
import CodeEditor from '../apps/addons/code-editor/CodeEditor.svelte';
import DockerManager from '../apps/system/docker-manager/DockerManager.svelte';
import SettingsApp from '../apps/system/settings/Settings.svelte';
import MediaPlayer from '../apps/addons/media-player/MediaPlayer.svelte';
import DocumentViewer from '../apps/addons/document-viewer/DocumentViewer.svelte';
import ModelViewer from '../apps/addons/model-viewer/ModelViewer.svelte';
import ControlPanel from '../apps/system/control-panel/ControlPanel.svelte';
import TransferUI from '../apps/system/transfer/TransferUI.svelte';
import LogViewer from '../apps/system/log-viewer/LogViewer.svelte';
import PackageCenter from '../apps/system/package-center/PackageCenter.svelte';
import WidgetStore from '../apps/addons/widget-store/WidgetStore.svelte';
import { normalizeLaunchContract } from './appOwnershipContract.js';

export const BUILTIN_COMPONENTS = {
  files: FileExplorer,
  terminal: TerminalApp,
  monitor: ResourceMonitor,
  editor: CodeEditor,
  docker: DockerManager,
  settings: SettingsApp,
  'control-panel': ControlPanel,
  transfer: TransferUI,
  player: MediaPlayer,
  'doc-viewer': DocumentViewer,
  'model-viewer': ModelViewer,
  logs: LogViewer,
  'package-center': PackageCenter,
  'widget-store': WidgetStore
};

export function normalizeAppLaunch(app = {}) {
  return normalizeLaunchContract(app);
}

export function resolveWindowLaunch(windowLike = {}) {
  const launch = normalizeAppLaunch(windowLike);
  const componentKey = String(launch.componentId || windowLike.appId || windowLike.id || '').trim();
  return {
    launch,
    component: BUILTIN_COMPONENTS[componentKey] || null
  };
}
