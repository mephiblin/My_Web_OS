const fs = require('fs-extra');
const inventoryPaths = require('../utils/inventoryPaths');

const STATE_KEYS = new Set(['settings', 'windows', 'widgets', 'shortcuts', 'desktops', 'startMenu', 'taskbar', 'windowDefaults', 'agentChat', 'themePresets', 'contextMenu', 'backupJobs']);

const DEFAULT_SETTINGS = {
  blurIntensity: 20,
  transparency: 0.05,
  accentColor: '#58a6ff',
  language: 'en',
  wallpaperType: 'css',
  wallpaper: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)',
  wallpaperId: 'default',
  wallpaperFit: 'cover',
  desktopIconScale: 1
};

const DEFAULT_WINDOWS = {
  windows: [],
  active: null
};

const DEFAULT_WIDGETS = [
  { id: 'widget-clock', type: 'preset', source: 'clock', title: 'Clock', x: 20, y: 30, w: 200, h: 200, locked: true },
  { id: 'widget-monitor', type: 'system', source: 'sys-cpu', title: 'CPU Monitor', x: 20, y: 250, w: 220, h: 200, locked: true }
];

const DEFAULT_SHORTCUTS = {
  shortcuts: []
};

const DEFAULT_DESKTOPS = {
  desktops: [
    { id: 1, name: 'Desktop 1' },
    { id: 2, name: 'Desktop 2' },
    { id: 3, name: 'Desktop 3' }
  ],
  currentDesktopId: 1,
  layoutEditMode: false
};

const DEFAULT_START_MENU = {
  pinnedAppIds: [],
  recentAppIds: [],
  layout: 'default',
  keepOpenOnDesktopClick: false,
  presentation: 'drawer'
};

const DEFAULT_TASKBAR = {
  showStartButton: true,
  showDesktopSwitcher: true,
  showSearch: true,
  showSystemTray: true,
  showClock: true,
  compactMode: false,
  iconSize: 'md'
};

const DEFAULT_WINDOW_DEFAULTS = {
  defaultWidth: 960,
  defaultHeight: 640,
  minWidth: 480,
  minHeight: 320,
  titleBarHeight: 40,
  rememberLastSize: true,
  rememberLastPosition: true,
  appBackgrounds: {}
};

const DEFAULT_CONTEXT_MENU = {
  showIcons: true,
  confirmDanger: true,
  density: 'cozy',
  openWithByExtension: {}
};

const DEFAULT_AGENT_CHAT = {
  isOpen: false,
  messages: [],
  draft: '',
  wrappedMode: {
    enabled: false,
    intentDraft: '',
    plannedActions: []
  }
};

const DEFAULT_THEME_PRESETS = [];
const DEFAULT_BACKUP_JOBS = {
  jobs: [],
  history: []
};

const AGENT_CHAT_ALLOWED_ROLES = new Set(['user', 'assistant', 'system']);
const AGENT_CHAT_ALLOWED_KINDS = new Set(['text', 'approval', 'result']);
const AGENT_CHAT_ALLOWED_APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);
const AGENT_CHAT_MAX_MESSAGE_COUNT = 200;
const AGENT_CHAT_MAX_ID_LENGTH = 128;
const AGENT_CHAT_MAX_CONTENT_LENGTH = 4000;
const AGENT_CHAT_MAX_DRAFT_LENGTH = 2000;
const AGENT_CHAT_MAX_APPROVAL_TITLE_LENGTH = 120;
const AGENT_CHAT_MAX_APPROVAL_SUMMARY_LENGTH = 2000;
const AGENT_CHAT_MAX_META_LENGTH = 2000;
const AGENT_CHAT_MAX_RESULT_ACTION_COUNT = 8;
const AGENT_CHAT_MAX_RESULT_PAYLOAD_LENGTH = 2000;
const AGENT_CHAT_MAX_RAW_OUTPUT_LENGTH = 8000;

const DEFAULT_BY_KEY = {
  settings: DEFAULT_SETTINGS,
  windows: DEFAULT_WINDOWS,
  widgets: DEFAULT_WIDGETS,
  shortcuts: DEFAULT_SHORTCUTS,
  desktops: DEFAULT_DESKTOPS,
  startMenu: DEFAULT_START_MENU,
  taskbar: DEFAULT_TASKBAR,
  windowDefaults: DEFAULT_WINDOW_DEFAULTS,
  agentChat: DEFAULT_AGENT_CHAT,
  themePresets: DEFAULT_THEME_PRESETS,
  contextMenu: DEFAULT_CONTEXT_MENU,
  backupJobs: DEFAULT_BACKUP_JOBS
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function ensureStateKey(key) {
  if (!STATE_KEYS.has(key)) {
    const err = new Error(`Unsupported state key: ${key}`);
    err.code = 'STATE_KEY_UNSUPPORTED';
    throw err;
  }
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function asTrimmedString(value, fallback, maxLength) {
  const fallbackValue = typeof fallback === 'string' ? fallback : '';
  const safeFallback = fallbackValue.slice(0, maxLength);
  if (typeof value !== 'string') return safeFallback;
  const trimmed = value.trim();
  if (!trimmed) return safeFallback;
  return trimmed.slice(0, maxLength);
}

function asNumberInRange(value, fallback, min, max) {
  const numeric = asNumber(value, fallback);
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function normalizeSettings(value) {
  if (!isObject(value)) return clone(DEFAULT_SETTINGS);

  const wallpaperType = ['css', 'image', 'video'].includes(value.wallpaperType) ? value.wallpaperType : DEFAULT_SETTINGS.wallpaperType;
  const wallpaperFit = ['cover', 'contain', 'stretch', 'center', 'tile'].includes(value.wallpaperFit) ? value.wallpaperFit : DEFAULT_SETTINGS.wallpaperFit;

  return {
    blurIntensity: asNumber(value.blurIntensity, DEFAULT_SETTINGS.blurIntensity),
    transparency: asNumber(value.transparency, DEFAULT_SETTINGS.transparency),
    accentColor: asString(value.accentColor, DEFAULT_SETTINGS.accentColor),
    language: asString(value.language, DEFAULT_SETTINGS.language).toLowerCase(),
    wallpaperType,
    wallpaper: asString(value.wallpaper, DEFAULT_SETTINGS.wallpaper),
    wallpaperId: asString(value.wallpaperId, DEFAULT_SETTINGS.wallpaperId),
    wallpaperFit,
    desktopIconScale: asNumberInRange(value.desktopIconScale, DEFAULT_SETTINGS.desktopIconScale, 0.8, 1.25)
  };
}

function normalizeWindowItem(item) {
  if (!isObject(item)) return null;
  if (typeof item.id !== 'string' || item.id.trim() === '') return null;

  return {
    ...item,
    id: item.id,
    appId: asString(item.appId, item.id),
    title: asString(item.title, 'App'),
    x: asNumber(item.x, 100),
    y: asNumber(item.y, 100),
    width: asNumber(item.width, 800),
    height: asNumber(item.height, 600),
    minimized: Boolean(item.minimized),
    maximized: Boolean(item.maximized),
    zIndex: asNumber(item.zIndex, 50),
    desktopId: asNumber(item.desktopId, 1),
    data: item.data === undefined ? null : item.data
  };
}

function normalizeWindows(value) {
  if (!isObject(value)) return clone(DEFAULT_WINDOWS);

  const normalizedWindows = Array.isArray(value.windows)
    ? value.windows.map(normalizeWindowItem).filter(Boolean)
    : [];

  return {
    windows: normalizedWindows,
    active: typeof value.active === 'string' && value.active.trim() !== '' ? value.active : null
  };
}

function normalizeWidgetItem(item, index) {
  if (!isObject(item)) return null;

  return {
    ...item,
    id: asString(item.id, `widget-${index + 1}`),
    type: asString(item.type, 'preset'),
    source: asString(item.source, 'clock'),
    title: asString(item.title, 'Widget'),
    x: asNumber(item.x, 100),
    y: asNumber(item.y, 100),
    w: asNumber(item.w, 250),
    h: asNumber(item.h, 200),
    locked: typeof item.locked === 'boolean' ? item.locked : true
  };
}

function normalizeWidgets(value) {
  if (!Array.isArray(value)) return clone(DEFAULT_WIDGETS);
  if (value.length === 0) return [];

  const normalized = value
    .map((item, index) => normalizeWidgetItem(item, index))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : clone(DEFAULT_WIDGETS);
}

function normalizeShortcuts(value) {
  if (!isObject(value) || !Array.isArray(value.shortcuts)) {
    return clone(DEFAULT_SHORTCUTS);
  }

  const shortcuts = value.shortcuts
    .filter(isObject)
    .map((item, index) => {
      const name = asString(item.name, '');
      const itemPath = asString(item.path, '');
      if (!name || !itemPath) return null;

      return {
        ...item,
        id: asString(item.id, `shortcut-${index + 1}`),
        name,
        path: itemPath,
        isDirectory: Boolean(item.isDirectory),
        ext: asString(item.ext, name.split('.').pop().toLowerCase()),
        desktopId: asNumber(item.desktopId, 1),
        gridX: asNumber(item.gridX, -1) >= 0 ? asNumber(item.gridX, -1) : null,
        gridY: asNumber(item.gridY, -1) >= 0 ? asNumber(item.gridY, -1) : null
      };
    })
    .filter(Boolean);

  return { shortcuts };
}

function normalizeDesktops(value) {
  if (!isObject(value) || !Array.isArray(value.desktops)) {
    return clone(DEFAULT_DESKTOPS);
  }

  const desktops = value.desktops
    .filter(isObject)
    .map((item, index) => ({
      id: asNumber(item.id, index + 1),
      name: asString(item.name, `Desktop ${index + 1}`)
    }));

  return {
    desktops: desktops.length > 0 ? desktops : clone(DEFAULT_DESKTOPS.desktops),
    currentDesktopId: asNumber(value.currentDesktopId, 1),
    layoutEditMode: typeof value.layoutEditMode === 'boolean'
      ? value.layoutEditMode
      : DEFAULT_DESKTOPS.layoutEditMode
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeStartMenu(value) {
  if (!isObject(value)) {
    return clone(DEFAULT_START_MENU);
  }

  const layout = ['default', 'compact', 'wide'].includes(value.layout)
    ? value.layout
    : DEFAULT_START_MENU.layout;
  const presentation = ['drawer', 'windows'].includes(value.presentation)
    ? value.presentation
    : DEFAULT_START_MENU.presentation;

  return {
    pinnedAppIds: normalizeStringList(value.pinnedAppIds),
    recentAppIds: normalizeStringList(value.recentAppIds),
    layout,
    keepOpenOnDesktopClick: value.keepOpenOnDesktopClick === true,
    presentation
  };
}

function normalizeTaskbar(value) {
  if (!isObject(value)) {
    return clone(DEFAULT_TASKBAR);
  }

  return {
    showStartButton: typeof value.showStartButton === 'boolean' ? value.showStartButton : DEFAULT_TASKBAR.showStartButton,
    showDesktopSwitcher: typeof value.showDesktopSwitcher === 'boolean' ? value.showDesktopSwitcher : DEFAULT_TASKBAR.showDesktopSwitcher,
    showSearch: typeof value.showSearch === 'boolean' ? value.showSearch : DEFAULT_TASKBAR.showSearch,
    showSystemTray: typeof value.showSystemTray === 'boolean' ? value.showSystemTray : DEFAULT_TASKBAR.showSystemTray,
    showClock: typeof value.showClock === 'boolean' ? value.showClock : DEFAULT_TASKBAR.showClock,
    compactMode: typeof value.compactMode === 'boolean' ? value.compactMode : DEFAULT_TASKBAR.compactMode,
    iconSize: ['sm', 'md', 'lg'].includes(value.iconSize) ? value.iconSize : DEFAULT_TASKBAR.iconSize
  };
}

function normalizeWindowDefaults(value) {
  if (!isObject(value)) {
    return clone(DEFAULT_WINDOW_DEFAULTS);
  }

  const appBackgrounds = isObject(value.appBackgrounds)
    ? Object.fromEntries(
      Object.entries(value.appBackgrounds)
        .map(([appId, bg]) => [String(appId || '').trim(), asTrimmedString(bg, '', 400)])
        .filter(([appId, bg]) => appId && bg)
        .slice(0, 64)
    )
    : {};

  return {
    defaultWidth: asNumberInRange(value.defaultWidth, DEFAULT_WINDOW_DEFAULTS.defaultWidth, 320, 3840),
    defaultHeight: asNumberInRange(value.defaultHeight, DEFAULT_WINDOW_DEFAULTS.defaultHeight, 240, 2160),
    minWidth: asNumberInRange(value.minWidth, DEFAULT_WINDOW_DEFAULTS.minWidth, 240, 1920),
    minHeight: asNumberInRange(value.minHeight, DEFAULT_WINDOW_DEFAULTS.minHeight, 180, 1080),
    titleBarHeight: asNumberInRange(value.titleBarHeight, DEFAULT_WINDOW_DEFAULTS.titleBarHeight, 28, 72),
    rememberLastSize: typeof value.rememberLastSize === 'boolean' ? value.rememberLastSize : DEFAULT_WINDOW_DEFAULTS.rememberLastSize,
    rememberLastPosition: typeof value.rememberLastPosition === 'boolean' ? value.rememberLastPosition : DEFAULT_WINDOW_DEFAULTS.rememberLastPosition,
    appBackgrounds
  };
}

function normalizeContextMenu(value) {
  if (!isObject(value)) {
    return clone(DEFAULT_CONTEXT_MENU);
  }
  const openWithByExtension = isObject(value.openWithByExtension)
    ? Object.fromEntries(
      Object.entries(value.openWithByExtension)
        .map(([extension, appId]) => [String(extension || '').trim().toLowerCase().replace(/^\./, ''), asTrimmedString(appId, '', 128)])
        .filter(([extension, appId]) => extension && appId)
        .slice(0, 200)
    )
    : {};
  return {
    showIcons: typeof value.showIcons === 'boolean' ? value.showIcons : DEFAULT_CONTEXT_MENU.showIcons,
    confirmDanger: typeof value.confirmDanger === 'boolean' ? value.confirmDanger : DEFAULT_CONTEXT_MENU.confirmDanger,
    density: ['compact', 'cozy'].includes(value.density) ? value.density : DEFAULT_CONTEXT_MENU.density,
    openWithByExtension
  };
}

function normalizeAgentChatMessage(item, index) {
  if (!isObject(item)) return null;
  if (!AGENT_CHAT_ALLOWED_ROLES.has(item.role)) return null;

  const content = asTrimmedString(item.content, '', AGENT_CHAT_MAX_CONTENT_LENGTH);
  const kind = AGENT_CHAT_ALLOWED_KINDS.has(item.kind) ? item.kind : 'text';
  const approval = isObject(item.approval)
    ? {
        actionId: asTrimmedString(item.approval.actionId, '', AGENT_CHAT_MAX_ID_LENGTH),
        title: asTrimmedString(item.approval.title, '', AGENT_CHAT_MAX_APPROVAL_TITLE_LENGTH),
        summary: asTrimmedString(item.approval.summary, '', AGENT_CHAT_MAX_APPROVAL_SUMMARY_LENGTH),
        actionLabel: asTrimmedString(item.approval.actionLabel, 'Approve', AGENT_CHAT_MAX_APPROVAL_TITLE_LENGTH),
        risk: asTrimmedString(item.approval.risk, 'medium', 20),
        status: AGENT_CHAT_ALLOWED_APPROVAL_STATUSES.has(item.approval.status)
          ? item.approval.status
          : 'pending',
        resolvedAt: asNumberInRange(item.approval.resolvedAt, 0, 0, Number.MAX_SAFE_INTEGER) || null
      }
    : null;
  const hasApproval = Boolean(approval?.actionId && approval?.title);
  if (!content && !hasApproval) return null;

  const normalizedResultActions =
    Array.isArray(item?.meta?.resultActions)
      ? item.meta.resultActions
        .slice(0, AGENT_CHAT_MAX_RESULT_ACTION_COUNT)
        .map((action, actionIndex) => ({
          id: asTrimmedString(action?.id, `result-action-${actionIndex + 1}`, AGENT_CHAT_MAX_ID_LENGTH),
          type: asTrimmedString(action?.type, '', 64),
          label: asTrimmedString(action?.label, '', 200),
          status: asTrimmedString(action?.status, 'ready', 24),
          payload: asTrimmedString(
            typeof action?.payload === 'string' ? action.payload : JSON.stringify(action?.payload || {}),
            '{}',
            AGENT_CHAT_MAX_RESULT_PAYLOAD_LENGTH
          )
        }))
        .filter((action) => action.type && action.label)
      : [];

  return {
    id: asTrimmedString(item.id, `message-${index + 1}`, AGENT_CHAT_MAX_ID_LENGTH),
    role: item.role,
    content,
    kind,
    approval: hasApproval ? approval : null,
    meta: isObject(item.meta)
      ? {
          sourceMessageId: asTrimmedString(item.meta.sourceMessageId, '', AGENT_CHAT_MAX_ID_LENGTH),
          decision: asTrimmedString(item.meta.decision, '', 24),
          note: asTrimmedString(item.meta.note, '', AGENT_CHAT_MAX_META_LENGTH),
          resultTitle: asTrimmedString(item.meta.resultTitle, '', 160),
          resultStatus: asTrimmedString(item.meta.resultStatus, '', 24),
          rawOutput: asTrimmedString(item.meta.rawOutput, '', AGENT_CHAT_MAX_RAW_OUTPUT_LENGTH),
          resultActions: normalizedResultActions
        }
      : null,
    createdAt: asNumberInRange(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
  };
}

function normalizeAgentChat(value) {
  if (!isObject(value)) {
    return clone(DEFAULT_AGENT_CHAT);
  }

  const rawMessages = Array.isArray(value.messages) ? value.messages : [];
  const recentMessages = rawMessages.slice(-AGENT_CHAT_MAX_MESSAGE_COUNT);
  const messages = recentMessages
    .map((item, index) => normalizeAgentChatMessage(item, index))
    .filter(Boolean);
  const wrappedMode = isObject(value.wrappedMode)
    ? {
        enabled: value.wrappedMode.enabled === true,
        intentDraft: asTrimmedString(value.wrappedMode.intentDraft, '', AGENT_CHAT_MAX_DRAFT_LENGTH),
        plannedActions: Array.isArray(value.wrappedMode.plannedActions)
          ? value.wrappedMode.plannedActions
            .slice(0, 20)
            .map((item, index) => ({
              id: asTrimmedString(item?.id, `action-${index + 1}`, AGENT_CHAT_MAX_ID_LENGTH),
              label: asTrimmedString(item?.label, '', AGENT_CHAT_MAX_APPROVAL_SUMMARY_LENGTH),
              status: asTrimmedString(item?.status, 'pending', 24)
            }))
            .filter((item) => item.label)
          : []
      }
    : {
        enabled: false,
        intentDraft: '',
        plannedActions: []
      };

  return {
    isOpen: typeof value.isOpen === 'boolean' ? value.isOpen : DEFAULT_AGENT_CHAT.isOpen,
    messages,
    draft: asTrimmedString(value.draft, DEFAULT_AGENT_CHAT.draft, AGENT_CHAT_MAX_DRAFT_LENGTH),
    wrappedMode
  };
}

function normalizeThemePresetItem(item, index) {
  if (!isObject(item)) return null;
  const name = asTrimmedString(item.name, '', 80);
  if (!name) return null;

  return {
    id: asTrimmedString(item.id, `theme-preset-${index + 1}`, 128),
    name,
    settings: normalizeSettings(item.settings),
    createdAt: asNumberInRange(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
  };
}

function normalizeThemePresets(value) {
  if (!Array.isArray(value)) return clone(DEFAULT_THEME_PRESETS);
  const normalized = value
    .slice(0, 64)
    .map((item, index) => normalizeThemePresetItem(item, index))
    .filter(Boolean);
  return normalized;
}

function asNullableTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return asNumberInRange(value, Date.now(), 0, Number.MAX_SAFE_INTEGER);
}

function normalizeBackupJob(item, index) {
  if (!isObject(item)) return null;

  const sourcePath = asTrimmedString(item.sourcePath, '', 4096);
  const destinationRoot = asTrimmedString(item.destinationRoot, '', 4096);
  if (!sourcePath || !destinationRoot) return null;

  return {
    id: asTrimmedString(item.id, `backup-job-${index + 1}`, 128),
    name: asTrimmedString(item.name, `Backup Job ${index + 1}`, 200),
    sourcePath,
    destinationRoot,
    includeTimestamp: typeof item.includeTimestamp === 'boolean' ? item.includeTimestamp : true,
    createdAt: asNumberInRange(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    lastRunAt: asNullableTimestamp(item.lastRunAt),
    lastStatus: ['success', 'error'].includes(item.lastStatus) ? item.lastStatus : null,
    lastOutputPath: asTrimmedString(item.lastOutputPath, '', 4096) || null,
    lastError: asTrimmedString(item.lastError, '', 2000) || null
  };
}

function normalizeBackupHistoryItem(item, index) {
  if (!isObject(item)) return null;
  const jobId = asTrimmedString(item.jobId, '', 128);
  if (!jobId) return null;

  const status = ['success', 'error'].includes(item.status) ? item.status : null;
  if (!status) return null;

  const startedAt = asNullableTimestamp(item.startedAt);
  const finishedAt = asNullableTimestamp(item.finishedAt);
  if (!startedAt || !finishedAt) return null;

  return {
    id: asTrimmedString(item.id, `backup-history-${index + 1}`, 128),
    jobId,
    startedAt,
    finishedAt,
    status,
    outputPath: asTrimmedString(item.outputPath, '', 4096) || null,
    error: asTrimmedString(item.error, '', 2000) || null
  };
}

function normalizeBackupJobs(value) {
  if (!isObject(value)) return clone(DEFAULT_BACKUP_JOBS);

  const jobs = Array.isArray(value.jobs)
    ? value.jobs
      .slice(0, 200)
      .map((item, index) => normalizeBackupJob(item, index))
      .filter(Boolean)
    : [];

  const validJobIds = new Set(jobs.map((job) => job.id));

  const history = Array.isArray(value.history)
    ? value.history
      .slice(-500)
      .map((item, index) => normalizeBackupHistoryItem(item, index))
      .filter((entry) => entry && validJobIds.has(entry.jobId))
    : [];

  return { jobs, history };
}

function validateState(key, value) {
  ensureStateKey(key);

  switch (key) {
    case 'settings':
      return normalizeSettings(value);
    case 'windows':
      return normalizeWindows(value);
    case 'widgets':
      return normalizeWidgets(value);
    case 'shortcuts':
      return normalizeShortcuts(value);
    case 'desktops':
      return normalizeDesktops(value);
    case 'startMenu':
      return normalizeStartMenu(value);
    case 'taskbar':
      return normalizeTaskbar(value);
    case 'windowDefaults':
      return normalizeWindowDefaults(value);
    case 'agentChat':
      return normalizeAgentChat(value);
    case 'themePresets':
      return normalizeThemePresets(value);
    case 'contextMenu':
      return normalizeContextMenu(value);
    case 'backupJobs':
      return normalizeBackupJobs(value);
    default:
      return clone(DEFAULT_BY_KEY[key]);
  }
}

function getDefaultState(key) {
  ensureStateKey(key);
  return clone(DEFAULT_BY_KEY[key]);
}

async function tryReadJson(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) {
      return { exists: false, data: null, error: null };
    }

    const data = await fs.readJson(filePath);
    return { exists: true, data, error: null };
  } catch (error) {
    return { exists: true, data: null, error };
  }
}

async function backupCorruptFile(filePath) {
  if (!(await fs.pathExists(filePath))) return;
  const backupPath = `${filePath}.corrupt-${Date.now()}.json`;
  await fs.copy(filePath, backupPath);
}

async function readState(key) {
  ensureStateKey(key);
  await inventoryPaths.ensureInventoryStructure();

  const stateFile = await inventoryPaths.getStateFile(key);
  const legacyFile = await inventoryPaths.getLegacyStateFile(key);

  const primary = await tryReadJson(stateFile);
  if (primary.exists && !primary.error) {
    return validateState(key, primary.data);
  }

  if (primary.error) {
    await backupCorruptFile(stateFile);
  }

  const legacy = await tryReadJson(legacyFile);
  if (legacy.exists && !legacy.error) {
    const normalized = validateState(key, legacy.data);
    await fs.writeJson(stateFile, normalized, { spaces: 2 });
    return normalized;
  }

  if (legacy.error) {
    await backupCorruptFile(legacyFile);
  }

  const fallback = getDefaultState(key);
  await fs.writeJson(stateFile, fallback, { spaces: 2 });
  return fallback;
}

async function writeState(key, value) {
  ensureStateKey(key);
  await inventoryPaths.ensureInventoryStructure();

  const stateFile = await inventoryPaths.getStateFile(key);
  const normalized = validateState(key, value);
  await fs.writeJson(stateFile, normalized, { spaces: 2 });
  return normalized;
}

module.exports = {
  readState,
  writeState,
  validateState,
  getDefaultState
};
