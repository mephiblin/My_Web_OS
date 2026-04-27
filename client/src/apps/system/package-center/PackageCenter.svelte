<script>
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { LayoutGrid, Store, Link2, RefreshCw, Download, Upload, Play, Square, RotateCcw, Trash2, Plus, Search, Layers } from 'lucide-svelte';
  import { apiFetch } from '../../../utils/api.js';
  import {
    approvePackageDelete,
    approvePackageLifecycle,
    cancelPackageBackupJob,
    createPackageBackup,
    createPackageBackupJob,
    cloneInstalledPackage as cloneInstalledPackageRequest,
    controlRuntimeApp,
    fetchPackageBackupJobs,
    fetchPackageExportTicketUrl,
    fetchInstalledOpsSummary,
    fetchPackageFileEntries,
    fetchPackageManifest,
    preflightPackageRollback,
    fetchInstalledPackages,
    fetchRegistryInstallPreflight,
    fetchPackageLifecycle,
    preflightPackageManifestUpdate,
    fetchRuntimeApps,
    fetchRuntimeEvents,
    fetchRuntimeLogs,
    importZipPackage,
    installRegistryPackage,
    preflightPackageDelete,
    preflightZipPackageImport,
    recoverRuntimeApp,
    removeInstalledPackage as removeInstalledPackageRequest,
    rollbackPackageBackup,
    runPackageHealth,
    stopRuntimeApp,
    updatePackageManifest,
    updatePackageBackupPolicy,
    updatePackageChannel,
    wizardCreatePackage,
    wizardPreflightPackage
  } from './api.js';
  import { openWindow, windows, closeWindow, focusWindow, updateWindowData, updateWindowTitle } from '../../../core/stores/windowStore.js';
  import { widgets } from '../../../core/stores/widgetStore.js';

  const CATEGORY = {
    STORE: 'store',
    INSTALLED: 'installed'
  };
  const PERSONAL_STARTER_APPS = [
    { title: 'Memo', templateId: 'memo-app' },
    { title: 'Todo', templateId: 'todo-app' },
    { title: 'Bookmark Manager', templateId: 'bookmark-manager' },
    { title: 'Calculator', templateId: 'calculator' },
    { title: 'Clipboard History', templateId: 'clipboard-history' }
  ];
  const DEVELOPER_STARTER_APPS = [
    { title: 'JSON Formatter', templateId: 'json-formatter' },
    { title: 'API Tester', templateId: 'api-tester' },
    { title: 'Snippet Vault', templateId: 'snippet-vault' },
    { title: 'Markdown Preview', templateId: 'markdown-preview' },
    { title: 'CSV Viewer', templateId: 'csv-viewer' },
    { title: 'Text Processor', templateId: 'text-processor' }
  ];

  let activeCategory = $state(CATEGORY.STORE);
  let loadingStore = $state(true);
  let loadingInstalled = $state(true);
  let savingSource = $state(false);
  let installingPackageId = $state('');
  let message = $state('');
  let error = $state('');
  let lastFailure = $state(null);
  let activeStoreSource = $state('all');
  let packageQuery = $state('');
  let selectedPackageKey = $state('');

  let registrySources = $state([]);
  let storePackages = $state([]);
  let ecosystemTemplates = $state([]);
  let installedPackages = $state([]);
  let storeSourceErrors = $state([]);
  let runtimeStatusByApp = $state({});
  let runtimeLogsByApp = $state({});
  let runtimeEventsByApp = $state({});
  let lifecycleByApp = $state({});
  let healthByApp = $state({});
  let consoleOpenByApp = $state({});
  let runtimeActioning = $state('');
  let runtimeLogsLoading = $state('');
  let runtimeEventsLoading = $state('');
  let lifecycleLoading = $state('');
  let lifecycleActioning = $state('');
  let healthLoading = $state('');
  let manifestEditorByApp = $state({});
  let packageFilesByApp = $state({});
  let packageFilesLoadingByApp = $state({});
  let packageFilesErrorByApp = $state({});
  let scaffoldingTemplateId = $state('');
  let backupNotesByApp = $state({});
  let backupPolicyDraftByApp = $state({});
  let backupJobsByApp = $state({});
  let backupJobsLoadingByApp = $state({});
  let backupJobActioningByApp = $state({});
  let selectedBackupByApp = $state({});
  let installReview = $state(null);
  let removingPackageId = $state('');
  let packageUtilityPanel = $state('');
  let zipImportFile = $state(null);
  let zipImportInputKey = $state(0);
  let zipImportOverwrite = $state(false);
  let zipImportReview = $state(null);
  let zipImportPreflighting = $state(false);
  let zipImporting = $state(false);
  let installLifecycleTypedInput = $state('');
  let zipImportLifecycleTypedInput = $state('');
  let wizardPhase = $state('draft');
  let wizardLoadingPreflight = $state(false);
  let wizardCreating = $state(false);
  let wizardReview = $state(null);
  let cloneDialog = $state(null);
  let packageDeleteReview = $state(null);
  let packageDeleteTypedInput = $state('');
  let rollbackReview = $state(null);
  let rollbackLifecycleTypedInput = $state('');
  let installWorkspaceDraft = $state({
    enabled: false,
    path: '',
    mode: 'readwrite'
  });

  let wizardDraft = $state({
    id: '',
    title: '',
    description: '',
    version: '0.1.0',
    appType: 'app',
    runtimeType: 'sandbox-html',
    entry: 'index.html',
    uiEntry: 'ui/index.html',
    permissions: '',
    templateId: ''
  });

  function normalizeTemplateDefaults(template) {
    if (!template || typeof template !== 'object') return null;
    const defaults = template.defaults && typeof template.defaults === 'object' ? template.defaults : {};
    return {
      id: String(template.id || '').trim(),
      appType: String(defaults.appType || 'app').trim(),
      runtimeType: String(defaults.runtimeType || 'sandbox-html').trim(),
      entry: String(defaults.entry || 'index.html').trim(),
      uiEntry: String(defaults.uiEntry || defaults.ui?.entry || '').trim(),
      permissions: Array.isArray(defaults.permissions) ? defaults.permissions.join(', ') : ''
    };
  }

  let sourceForm = $state({
    id: '',
    title: '',
    url: ''
  });

  function normalizePermissionList(rawValue) {
    return String(rawValue || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function formatPermissionList(values) {
    return [...new Set((values || []).map((item) => String(item || '').trim()).filter(Boolean))].join(', ');
  }

  function setInstallWorkspaceField(field, value) {
    installWorkspaceDraft = {
      ...installWorkspaceDraft,
      [field]: value
    };
  }

  function normalizeLocalWorkspaceBridge(value, fallback = null) {
    const source = value && typeof value === 'object' ? value : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const status = String(source.status || fallbackSource.status || '').trim().toLowerCase() === 'inventory+local-workspace'
      ? 'inventory+local-workspace'
      : 'inventory-only';
    const path = String(source.path || fallbackSource.path || '').trim();
    const modeRaw = String(source.mode || fallbackSource.mode || '').trim().toLowerCase();
    const mode = modeRaw === 'read' ? 'read' : (modeRaw === 'readwrite' ? 'readwrite' : 'readwrite');

    return {
      requested: Boolean(source.requested || fallbackSource.requested),
      status,
      boundary: 'inventory-app-data',
      path: status === 'inventory+local-workspace' && path ? path : '',
      mode: status === 'inventory+local-workspace' ? mode : ''
    };
  }

  function resolveLocalWorkspacePayloadOrThrow() {
    if (!installWorkspaceDraft.enabled) {
      return null;
    }

    const path = String(installWorkspaceDraft.path || '').trim();
    if (!path) {
      const err = new Error('Local workspace path is required when bridge is enabled.');
      err.code = 'LOCAL_WORKSPACE_PATH_REQUIRED';
      throw err;
    }

    const mode = String(installWorkspaceDraft.mode || 'readwrite').trim().toLowerCase();
    if (mode !== 'read' && mode !== 'readwrite') {
      const err = new Error('Local workspace mode must be read or readwrite.');
      err.code = 'LOCAL_WORKSPACE_MODE_INVALID';
      throw err;
    }

    return {
      enabled: true,
      path,
      mode
    };
  }

  function updateWizardDraft(field, value) {
    if (field === 'templateId') {
      const selected = ecosystemTemplates.find((item) => item.id === String(value || '').trim());
      const normalized = normalizeTemplateDefaults(selected);
      if (normalized) {
        wizardDraft = {
          ...wizardDraft,
          templateId: normalized.id,
          appType: normalized.appType,
          runtimeType: normalized.runtimeType,
          entry: normalized.entry,
          uiEntry: normalized.uiEntry || (normalized.appType === 'hybrid' ? 'ui/index.html' : wizardDraft.uiEntry),
          permissions: normalized.permissions
        };
      } else {
        wizardDraft = {
          ...wizardDraft,
          templateId: String(value || '').trim()
        };
      }
      if (wizardPhase === 'review') {
        wizardPhase = 'draft';
        wizardReview = null;
      }
      return;
    }

    if (field === 'appType' && String(value || '').trim() === 'hybrid') {
      wizardDraft = {
        ...wizardDraft,
        appType: 'hybrid',
        runtimeType: wizardDraft.runtimeType === 'sandbox-html' ? 'process-node' : wizardDraft.runtimeType,
        entry: wizardDraft.entry && wizardDraft.entry !== 'index.html' ? wizardDraft.entry : 'service/index.js',
        uiEntry: wizardDraft.uiEntry || 'ui/index.html',
        permissions: formatPermissionList([
          ...normalizePermissionList(wizardDraft.permissions),
          'runtime.process',
          'service.bridge',
          'app.data.read',
          'app.data.write'
        ])
      };
      if (wizardPhase === 'review') {
        wizardPhase = 'draft';
        wizardReview = null;
      }
      return;
    }

    wizardDraft = {
      ...wizardDraft,
      [field]: value
    };
    if (wizardPhase === 'review') {
      wizardPhase = 'draft';
      wizardReview = null;
    }
  }

  function buildWizardManifest() {
    const appType = String(wizardDraft.appType || 'app');
    return {
      id: String(wizardDraft.id || '').trim(),
      title: String(wizardDraft.title || '').trim(),
      description: String(wizardDraft.description || '').trim(),
      version: String(wizardDraft.version || '').trim() || '0.1.0',
      appType,
      runtime: {
        runtimeType: String(wizardDraft.runtimeType || 'sandbox-html'),
        entry: String(wizardDraft.entry || '').trim()
      },
      ...(appType === 'hybrid'
        ? {
            ui: {
              type: 'sandbox-html',
              entry: String(wizardDraft.uiEntry || 'ui/index.html').trim()
            },
            service: {
              autoStart: false,
              restartPolicy: 'on-failure',
              maxRetries: 3,
              restartDelayMs: 1000,
              http: { enabled: true }
            },
            healthcheck: {
              type: 'http',
              path: '/health',
              intervalMs: 10000,
              timeoutMs: 2000
            }
          }
        : {}),
      permissions: normalizePermissionList(wizardDraft.permissions)
    };
  }

  async function runWizardPreflight() {
    wizardLoadingPreflight = true;
    wizardReview = null;
    clearFeedback();
    try {
      const manifest = buildWizardManifest();
      const localWorkspace = resolveLocalWorkspacePayloadOrThrow();
      const response = await wizardPreflightPackage(manifest, wizardDraft.templateId, localWorkspace);
      const raw = response?.review || response?.preflight || response?.data || response || {};
      const blockers = normalizeReviewItems(
        readPreflightField(raw, [
          ['executionReadiness', 'blockers'],
          'blockers'
        ], []),
        'blocker'
      ).map((item) => ({
        ...item,
        status: 'fail'
      }));
      const decision = normalizeReviewDecision(
        readPreflightField(raw, [
          ['executionReadiness', 'status'],
          'decision',
          'status',
          'result',
          'overallStatus'
        ], blockers.length > 0 ? 'blocked' : 'warn')
      );
      const blocked = Boolean(
        readPreflightField(raw, [
          ['executionReadiness', 'blocked'],
          'blocked',
          'isBlocked'
        ], false)
      ) || blockers.length > 0 || decision === 'blocked';

      wizardReview = {
        decision,
        blocked,
        summary: normalizeReviewText(
          readPreflightField(raw, ['summary', 'message'], blocked ? 'Preflight review is blocked.' : 'Preflight review is complete.')
        ),
        blockers,
        onboarding: normalizeOnboardingReview(readPreflightField(raw, ['onboarding'], null)),
        toolPackageReview: normalizeToolPackageReview(readPreflightField(raw, ['toolPackageReview'], null)),
        lifecycleSafeguards: normalizeSafeguardReview(readPreflightField(raw, ['lifecycleSafeguards'], null)),
        localWorkspace: normalizeLocalWorkspaceBridge(
          readPreflightField(raw, [
            ['operation', 'localWorkspaceBridge'],
            'localWorkspaceBridge'
          ], null),
          localWorkspace
        ),
        source: response ? 'preflight-endpoint' : 'fallback'
      };
      wizardPhase = 'review';
    } catch (err) {
      wizardReview = {
        decision: 'blocked',
        blocked: true,
        summary: err.message || 'Package preflight failed.',
        blockers: [],
        onboarding: normalizeOnboardingReview(null),
        toolPackageReview: normalizeToolPackageReview(null),
        lifecycleSafeguards: normalizeSafeguardReview(null),
        source: 'preflight-endpoint'
      };
      wizardPhase = 'review';
      error = err.message || 'Package preflight failed.';
    } finally {
      wizardLoadingPreflight = false;
    }
  }

  async function createPackageFromWizard() {
    if (!wizardReview || wizardReview.blocked) return;
    wizardCreating = true;
    clearFeedback();
    try {
      const manifest = buildWizardManifest();
      const localWorkspace = resolveLocalWorkspacePayloadOrThrow();
      const response = await wizardCreatePackage(manifest, wizardDraft.templateId, localWorkspace);
      const createdId = String(response?.package?.id || response?.appId || manifest.id || '').trim();
      message = createdId
        ? `Package "${createdId}" created successfully.`
        : 'Package created successfully.';
      wizardPhase = 'draft';
      wizardReview = null;
      wizardDraft = {
        ...wizardDraft,
        id: '',
        title: '',
        description: '',
        permissions: ''
      };
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
    } catch (err) {
      error = err.message || 'Package create failed.';
    } finally {
      wizardCreating = false;
    }
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  function clearFeedback() {
    message = '';
    error = '';
    lastFailure = null;
  }

  function formatApiError(err, fallbackMessage) {
    const code = String(err?.code || '').trim();
    const text = String(err?.message || fallbackMessage || 'Request failed.').trim();
    return code ? `${text} (${code})` : text;
  }

  function setFeedbackError(err, fallbackMessage, operation, retry = null) {
    const nextMessage = formatApiError(err, fallbackMessage);
    error = nextMessage;
    lastFailure = {
      operation: operation || 'Package Center operation',
      message: nextMessage,
      code: String(err?.code || '').trim(),
      retry
    };
  }

  async function retryLastFailure() {
    const retry = lastFailure?.retry;
    if (typeof retry !== 'function') return;
    message = '';
    error = '';
    await retry();
  }

  async function withTimeout(promise, timeoutMs, timeoutMessage) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const err = new Error(timeoutMessage || 'Request timed out.');
            err.code = 'REQUEST_TIMEOUT';
            reject(err);
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeRegistryUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.includes('raw.githubusercontent.com')) return value;

    const githubBlob = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
    if (githubBlob) {
      const [, owner, repo, branch, filePath] = githubBlob;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    const githubRepo = value.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/i);
    if (githubRepo) {
      const [, owner, repo] = githubRepo;
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/webos-store.json`;
    }

    return value;
  }

  function syncSourceId() {
    if (!sourceForm.id.trim()) {
      sourceForm.id = slugify(sourceForm.title || sourceForm.url);
    }
  }

  function getIconUrl(item) {
    if (!item) return '';
    if (item.iconType === 'image' && item.iconUrl) return item.iconUrl;
    if (typeof item.iconUrl === 'string' && item.iconUrl.trim()) return item.iconUrl.trim();
    if (typeof item.icon === 'string' && (/^https?:\/\//i.test(item.icon) || /^data:image\//i.test(item.icon))) return item.icon;
    return '';
  }

  function hasImageIcon(item) {
    return Boolean(getIconUrl(item));
  }

  function getVisibleStorePackages() {
    if (activeStoreSource === 'all') return storePackages;
    return storePackages.filter((pkg) => pkg.source?.id === activeStoreSource);
  }

  function setActiveCategory(category) {
    activeCategory = category;
    selectedPackageKey = '';
    packageQuery = '';
  }

  function getPackageKey(pkg) {
    if (!pkg?.id) return '';
    const sourceId = pkg.source?.id || (activeCategory === CATEGORY.INSTALLED ? 'installed' : 'store');
    return `${sourceId}:${pkg.id}`;
  }

  function getActivePackageList() {
    return activeCategory === CATEGORY.INSTALLED ? installedPackages : getVisibleStorePackages();
  }

  function getFilteredActivePackageList() {
    const query = packageQuery.trim().toLowerCase();
    const rows = getActivePackageList();
    if (!query) return rows;
    return rows.filter((pkg) => [
      pkg.id,
      pkg.title,
      pkg.description,
      pkg.version,
      pkg.source?.id,
      pkg.appType,
      pkg.type,
      pkg.runtime,
      pkg.runtimeProfile?.runtimeType
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }

  function getSelectedPackage() {
    const rows = getFilteredActivePackageList();
    if (selectedPackageKey) {
      const selected = rows.find((pkg) => getPackageKey(pkg) === selectedPackageKey);
      if (selected) return selected;
    }
    return rows[0] || null;
  }

  function selectPackage(pkg) {
    selectedPackageKey = getPackageKey(pkg);
  }

  function getSelectedPackageRows() {
    const selected = getSelectedPackage();
    return selected ? [selected] : [];
  }

  function reloadActivePackages() {
    return activeCategory === CATEGORY.STORE ? loadStorePackages() : loadInstalledPackages();
  }

  function getPackageKindLabel(pkg) {
    return pkg?.appType || pkg?.type || pkg?.runtimeProfile?.runtimeType || 'app';
  }

  function getPackageSourceLabel(pkg) {
    if (activeCategory === CATEGORY.INSTALLED) return getWorkspaceBoundaryLabel(pkg);
    return pkg?.source?.title || pkg?.source?.id || 'store';
  }

  function getPackageDependencies(pkg) {
    const raw = pkg?.dependencies || pkg?.manifest?.dependencies || pkg?.runtimeProfile?.dependencies || null;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const name = item.id || item.name || item.package || item.appId || '';
        const version = item.version || item.range || item.requiredVersion || '';
        return [name, version].filter(Boolean).join(' ');
      }).filter(Boolean);
    }
    if (typeof raw === 'object') {
      return Object.entries(raw).map(([name, value]) => {
        if (value === true || value == null) return name;
        if (typeof value === 'string') return `${name} ${value}`;
        if (typeof value === 'object') {
          return [name, value.version || value.range || value.requiredVersion || ''].filter(Boolean).join(' ');
        }
        return `${name} ${String(value)}`;
      }).filter(Boolean);
    }
    return [];
  }

  function isServicePackage(pkg) {
    if (!pkg) return false;
    if (pkg.appType === 'service' || pkg.type === 'service') return true;
    if (pkg.appType === 'hybrid' || pkg.type === 'hybrid') return true;
    return pkg.runtimeProfile?.runtimeType && pkg.runtimeProfile.runtimeType !== 'sandbox-html';
  }

  function canOpenPackage(pkg) {
    const appType = pkg?.appType || pkg?.type;
    return !pkg || (appType !== 'service' && appType !== 'widget');
  }

  function getPackageWidgets(pkg) {
    const rows = Array.isArray(pkg?.contributes?.widgets) ? pkg.contributes.widgets : [];
    return rows.filter((item) => item?.id && item?.entry);
  }

  function addPackageWidget(pkg, contribution) {
    if (!pkg?.id || !contribution?.entry) return;
    const defaultSize = contribution.defaultSize && typeof contribution.defaultSize === 'object'
      ? contribution.defaultSize
      : {};
    widgets.addWidget({
      type: 'package',
      packageId: pkg.id,
      widgetId: contribution.id,
      entry: contribution.entry,
      title: contribution.title || contribution.label || pkg.title || 'Package Widget',
      source: `${pkg.id}:${contribution.id}`,
      w: Number.isFinite(Number(defaultSize.w)) ? Number(defaultSize.w) : 320,
      h: Number.isFinite(Number(defaultSize.h)) ? Number(defaultSize.h) : 220
    });
    message = `Added "${contribution.title || contribution.label || pkg.title}" to the desktop.`;
    error = '';
  }

  function getRuntimeState(pkg) {
    return runtimeStatusByApp[pkg.id] || pkg.runtimeStatus || null;
  }

  function getRuntimeStatusLabel(pkg) {
    const status = getRuntimeState(pkg)?.status || 'stopped';
    return String(status).toUpperCase();
  }

  function isRuntimeRunning(pkg) {
    const status = getRuntimeState(pkg)?.status || 'stopped';
    return status === 'running' || status === 'starting' || status === 'degraded';
  }

  function clearRuntimeLogs(appId) {
    const next = { ...runtimeLogsByApp };
    delete next[appId];
    runtimeLogsByApp = next;
  }

  function clearRuntimeEvents(appId) {
    const next = { ...runtimeEventsByApp };
    delete next[appId];
    runtimeEventsByApp = next;
  }

  function getLifecycle(pkg) {
    return lifecycleByApp[pkg.id] || null;
  }

  function getWorkspaceBridge(pkg) {
    return normalizeLocalWorkspaceBridge(getLifecycle(pkg)?.workspaceBridge || pkg?.workspaceBridge || null);
  }

  function getWorkspaceBoundaryLabel(pkg) {
    const bridge = getWorkspaceBridge(pkg);
    if (bridge.status === 'inventory+local-workspace') {
      return 'inventory+local-workspace';
    }
    return 'inventory-only';
  }

  function getHealthReport(pkg) {
    return healthByApp[pkg.id] || getLifecycle(pkg)?.lastQaReport || null;
  }

  function getHealthStatus(pkg) {
    return String(getHealthReport(pkg)?.status || 'unknown').toLowerCase();
  }

  function getHealthStatusText(pkg) {
    if (healthLoading === pkg.id) return 'CHECKING';
    return String(getHealthStatus(pkg)).toUpperCase();
  }

  function isConsoleOpen(pkg) {
    return Boolean(consoleOpenByApp[pkg.id]);
  }

  function getLifecycleCurrentChannel(pkg) {
    return getLifecycle(pkg)?.channel || 'stable';
  }

  function getAvailableBackups(pkg) {
    const lifecycle = getLifecycle(pkg);
    const backups = Array.isArray(lifecycle?.backups) ? lifecycle.backups : [];
    return [...backups].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function getBackupPolicyMax(pkg) {
    const raw = Number(getLifecycle(pkg)?.backupPolicy?.maxBackups);
    return Number.isFinite(raw) ? Math.max(1, Math.min(100, Math.floor(raw))) : 20;
  }

  const BACKUP_SCHEDULE_OPTIONS = ['manual', 'daily', 'weekly', 'monthly'];

  function getBackupPolicySchedule(pkg) {
    const schedule = getLifecycle(pkg)?.backupPolicy?.schedule;
    const interval = String(schedule?.interval || 'manual').trim().toLowerCase();
    return {
      enabled: Boolean(schedule?.enabled),
      interval: BACKUP_SCHEDULE_OPTIONS.includes(interval) ? interval : 'manual',
      timeOfDay: String(schedule?.timeOfDay || '00:00').trim() || '00:00',
      timezone: String(schedule?.timezone || 'local').trim() || 'local'
    };
  }

  function normalizeBackupPolicyDraft(appId, lifecycle = null) {
    const currentPolicy = lifecycle?.backupPolicy || getLifecycle({ id: appId })?.backupPolicy || {};
    const currentMax = Number(currentPolicy?.maxBackups);
    const schedule = getBackupPolicySchedule({ id: appId, ...lifecycle });

    setBackupPolicyDraft(appId, {
      maxBackups: Number.isFinite(currentMax) ? String(Math.max(1, Math.min(100, Math.floor(currentMax)))) : '20',
      enabled: schedule.enabled ? 'true' : 'false',
      interval: schedule.interval,
      timeOfDay: schedule.timeOfDay
    });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function formatEventLabel(event) {
    if (!event) return '-';
    return String(event.action || event.type || event.id || 'event');
  }

  function getBackupNote(appId) {
    return String(backupNotesByApp[appId] || '');
  }

  function setBackupNote(appId, value) {
    backupNotesByApp = {
      ...backupNotesByApp,
      [appId]: String(value || '')
    };
  }

  function setBackupPolicyDraft(appId, draft = {}) {
    backupPolicyDraftByApp = {
      ...backupPolicyDraftByApp,
      [appId]: {
        ...backupPolicyDraftByApp[appId],
        ...draft
      }
    };
  }

  function getBackupPolicyDraft(appId, pkg = null) {
    const schedule = getBackupPolicySchedule(pkg || { id: appId });
    const raw = backupPolicyDraftByApp[appId] || {};
    return {
      maxBackups: typeof raw.maxBackups === 'string' && raw.maxBackups !== ''
        ? raw.maxBackups
        : String(pkg ? getBackupPolicyMax(pkg) : 20),
      enabled: String(raw.enabled || (schedule.enabled ? 'true' : 'false')).trim(),
      interval: BACKUP_SCHEDULE_OPTIONS.includes(raw.interval)
        ? raw.interval
        : schedule.interval,
      timeOfDay: String(raw.timeOfDay || schedule.timeOfDay || '00:00').trim() || '00:00',
      timezone: String(raw.timezone || schedule.timezone || 'local').trim() || 'local'
    };
  }

  function setBackupPolicyDraftField(appId, field, value) {
    setBackupPolicyDraft(appId, { [field]: String(value || '') });
  }

  function buildBackupPolicyPayloadFromDraft(appId, pkg) {
    const draft = getBackupPolicyDraft(appId, pkg);
    const maxBackupsRaw = Number(draft.maxBackups);
    if (!Number.isFinite(maxBackupsRaw)) {
      const err = new Error('Backup policy maxBackups must be a number.');
      err.code = 'PACKAGE_BACKUP_POLICY_INVALID_MAX_BACKUPS';
      throw err;
    }

    const maxBackups = Math.max(1, Math.min(100, Math.floor(maxBackupsRaw)));
    const interval = BACKUP_SCHEDULE_OPTIONS.includes(draft.interval)
      ? draft.interval
      : 'manual';

    const timeCandidate = String(draft.timeOfDay || '').trim() || '00:00';
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeCandidate)) {
      const err = new Error('schedule.timeOfDay must be in HH:mm format.');
      err.code = 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_TIME';
      throw err;
    }

    return {
      maxBackups,
      schedule: {
        enabled: interval === 'manual' ? false : draft.enabled === 'true',
        interval,
        timeOfDay: timeCandidate,
        timezone: String(draft.timezone || 'local').trim() || 'local'
      }
    };
  }

  function setSelectedBackup(appId, backupId) {
    selectedBackupByApp = {
      ...selectedBackupByApp,
      [appId]: String(backupId || '')
    };
  }

  function getBackupJobs(appId) {
    return Array.isArray(backupJobsByApp[appId]) ? backupJobsByApp[appId] : [];
  }

  function getBackupJobStatusClass(status) {
    const value = String(status || 'unknown').toLowerCase();
    if (value === 'completed') return 'completed';
    if (value === 'failed') return 'error';
    if (value === 'running') return 'running';
    if (value === 'canceled') return 'cancelled';
    if (value === 'queued') return 'queued';
    return 'unknown';
  }

  function isBackupJobCancelable(job) {
    return String(job?.status || '').toLowerCase() === 'queued';
  }

  function isBackupJobsLoading(appId) {
    return Boolean(backupJobsLoadingByApp[appId]);
  }

  function getBackupJobActioningKey(appId, jobId, action) {
    return `${appId}:${jobId}:${action}`;
  }

  function isBackupJobActioning(appId, jobId, action) {
    return Boolean(backupJobActioningByApp[getBackupJobActioningKey(appId, jobId, action)]);
  }

  async function loadBackupJobs(appId, options = {}) {
    const silent = options.silent === true;
    backupJobsLoadingByApp = {
      ...backupJobsLoadingByApp,
      [appId]: true
    };

    try {
      const response = await withTimeout(
        fetchPackageBackupJobs(appId, 50),
        10000,
        'Backup jobs request timed out.'
      );
      backupJobsByApp = {
        ...backupJobsByApp,
        [appId]: Array.isArray(response.jobs) ? response.jobs : []
      };
    } catch (err) {
      backupJobsByApp = {
        ...backupJobsByApp,
        [appId]: []
      };
      if (!silent) {
        error = err.message || 'Failed to load backup jobs.';
      }
    } finally {
      backupJobsLoadingByApp = {
        ...backupJobsLoadingByApp,
        [appId]: false
      };
    }
  }

  function getManifestEditorState(appId) {
    return manifestEditorByApp[appId] || null;
  }

  function isManifestEditorOpen(appId) {
    return Boolean(getManifestEditorState(appId)?.open);
  }

  function updateManifestEditorState(appId, updater) {
    const previous = getManifestEditorState(appId) || {
      open: false,
      loading: false,
      loadError: '',
      text: '',
      parsed: null,
      parseError: '',
      preflightLoading: false,
      preflight: null,
      approvals: {
        mediaScopesAccepted: false
      },
      lifecycleTypedInput: '',
      saving: false
    };
    const next = typeof updater === 'function' ? updater(previous) : { ...previous, ...updater };
    manifestEditorByApp = {
      ...manifestEditorByApp,
      [appId]: next
    };
    return next;
  }

  function normalizePackageDirectoryPath(pathValue) {
    const raw = String(pathValue || '').trim().replace(/\\/g, '/');
    if (!raw || raw === '.' || raw === '/') return '';
    return raw.replace(/^\/+|\/+$/g, '');
  }

  function getPackageFilesState(appId) {
    return packageFilesByApp[appId] || { path: '', entries: [] };
  }

  function getParentDirectory(pathValue) {
    const normalized = normalizePackageDirectoryPath(pathValue);
    if (!normalized) return '';
    const segments = normalized.split('/').filter(Boolean);
    segments.pop();
    return segments.join('/');
  }

  async function loadPackageFiles(appId, relativePath = '') {
    const targetPath = normalizePackageDirectoryPath(relativePath);
    packageFilesLoadingByApp = {
      ...packageFilesLoadingByApp,
      [appId]: true
    };
    packageFilesErrorByApp = {
      ...packageFilesErrorByApp,
      [appId]: ''
    };

    try {
      const response = await withTimeout(
        fetchPackageFileEntries(appId, targetPath),
        10000,
        'Package files request timed out.'
      );
      const entries = Array.isArray(response?.entries) ? response.entries : [];
      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), 'en');
      });
      packageFilesByApp = {
        ...packageFilesByApp,
        [appId]: {
          path: targetPath,
          entries
        }
      };
    } catch (err) {
      packageFilesErrorByApp = {
        ...packageFilesErrorByApp,
        [appId]: err.message || 'Failed to load package files.'
      };
    } finally {
      packageFilesLoadingByApp = {
        ...packageFilesLoadingByApp,
        [appId]: false
      };
    }
  }

  async function openPackageDirectory(pkg, relativePath = '') {
    await loadPackageFiles(pkg.id, relativePath);
  }

  async function refreshPackageDirectory(pkg) {
    await loadPackageFiles(pkg.id, getPackageFilesState(pkg.id).path || '');
  }

  function openPackageFileEditor(appId, filePath) {
    const normalizedPath = normalizePackageDirectoryPath(filePath);
    if (!normalizedPath) return;

    const title = `Editor - ${appId}/${normalizedPath}`;
    const editorData = {
      packageFile: {
        appId,
        path: normalizedPath
      }
    };
    const existingEditor = get(windows).find((item) => item.appId === 'editor');
    if (existingEditor) {
      updateWindowData(existingEditor.id, editorData);
      updateWindowTitle(existingEditor.id, title);
      focusWindow(existingEditor.id);
      return;
    }

    openWindow(
      {
        id: 'editor',
        title,
        iconComponent: LayoutGrid
      },
      editorData
    );
  }

  function getSourcePackageCount(sourceId) {
    return storePackages.filter((pkg) => pkg.source?.id === sourceId).length;
  }

  function readPreflightField(source, paths, fallback = null) {
    for (const path of paths) {
      const segments = Array.isArray(path) ? path : String(path || '').split('.');
      let value = source;
      let missing = false;
      for (const segment of segments) {
        if (value == null || typeof value !== 'object' || !(segment in value)) {
          missing = true;
          break;
        }
        value = value[segment];
      }
      if (!missing && value !== undefined && value !== null) {
        return value;
      }
    }
    return fallback;
  }

  function normalizeReviewDecision(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('block') || raw.includes('deny') || raw.includes('fail') || raw.includes('error')) {
      return 'blocked';
    }
    if (raw.includes('pass') || raw.includes('allow') || raw.includes('ok') || raw === 'success') {
      return 'pass';
    }
    return 'warn';
  }

  function normalizeReviewItemStatus(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('fail') || raw.includes('block') || raw.includes('deny') || raw.includes('error')) {
      return 'fail';
    }
    if (raw.includes('warn') || raw.includes('caution') || raw.includes('review')) {
      return 'warn';
    }
    if (raw.includes('pass') || raw.includes('allow') || raw.includes('ok') || raw.includes('success')) {
      return 'pass';
    }
    return 'info';
  }

  function normalizeReviewItems(value, defaultLabel) {
    if (value == null) return [];

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return { label: item, status: 'info', detail: '' };
          }
          if (!item || typeof item !== 'object') return null;
          return {
            label: String(item.label || item.name || item.id || item.key || item.permission || defaultLabel || 'item'),
            status: normalizeReviewItemStatus(item.status || item.result || item.outcome || item.level || item.severity),
            detail: String(item.detail || item.message || item.reason || item.summary || item.note || '')
          };
        })
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return [{ label: value, status: 'info', detail: '' }];
    }

    if (typeof value === 'object') {
      if (Array.isArray(value.items)) {
        return normalizeReviewItems(value.items, defaultLabel);
      }
      return Object.entries(value).map(([key, item]) => {
        if (typeof item === 'string') {
          return { label: key, status: normalizeReviewItemStatus(item), detail: item };
        }
        return {
          label: String(key || defaultLabel || 'item'),
          status: normalizeReviewItemStatus(item?.status || item?.result || item?.outcome),
          detail: String(item?.detail || item?.message || item?.reason || item?.summary || '')
        };
      });
    }

    return [];
  }

  function normalizeReviewText(value, fallback = '') {
    if (value == null) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
      return String(value.summary || value.message || value.reason || fallback);
    }
    return fallback;
  }

  function normalizeSafeguardReview(value) {
    if (!value || typeof value !== 'object') {
      return {
        status: 'warn',
        summary: '',
        checks: []
      };
    }

    return {
      status: normalizeReviewDecision(value.status || 'warn'),
      summary: normalizeReviewText(value.summary, ''),
      checks: normalizeReviewItems(value.checks, 'safeguard')
    };
  }

  function normalizeOnboardingReview(value) {
    if (!value || typeof value !== 'object') {
      return {
        status: 'warn',
        summary: '',
        steps: [],
        commands: []
      };
    }

    return {
      status: normalizeReviewDecision(value.status || 'warn'),
      summary: normalizeReviewText(value.summary, ''),
      steps: normalizeReviewItems(value.steps, 'onboarding'),
      commands: Array.isArray(value.commands)
        ? value.commands.map((item) => String(item || '').trim()).filter(Boolean)
        : []
    };
  }

  function normalizeToolPackageReview(value) {
    if (!value || typeof value !== 'object') {
      return {
        applies: false,
        status: 'pass',
        summary: '',
        runtimeType: '',
        serviceEntry: '',
        uiEntry: '',
        checks: []
      };
    }

    return {
      applies: value.applies === true,
      status: normalizeReviewDecision(value.status || 'warn'),
      summary: normalizeReviewText(value.summary, ''),
      runtimeType: normalizeReviewText(value.runtimeType, ''),
      serviceEntry: normalizeReviewText(value.serviceEntry, ''),
      uiEntry: normalizeReviewText(value.uiEntry, ''),
      checks: normalizeReviewItems(value.checks, 'tool package')
    };
  }

  function dedupeReviewItems(items, excludedKeys = new Set()) {
    const seen = new Set(excludedKeys);
    const result = [];
    for (const item of items || []) {
      const key = `${String(item?.label || '').trim().toLowerCase()}|${String(item?.status || '').trim().toLowerCase()}|${String(item?.detail || '').trim().toLowerCase()}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function normalizeInstallPreflight(payload, pkg, overwrite, fallbackMessage = '', options = {}) {
    const forceBlocked = options.forceBlocked === true;
    const localWorkspaceFallback = options.localWorkspaceFallback && typeof options.localWorkspaceFallback === 'object'
      ? options.localWorkspaceFallback
      : null;
    const raw = payload?.review || payload?.preflight || payload?.data || payload || {};
    const executionReadiness = readPreflightField(raw, ['executionReadiness'], null);
    const blockers = Array.isArray(executionReadiness?.blockers) ? executionReadiness.blockers : [];
    const hasBlockers = blockers.length > 0;
    const qualityGateStatus = String(readPreflightField(raw, [['qualityGate', 'status']], '') || '').toLowerCase();
    const dependencyStatus = String(readPreflightField(raw, [['dependencyCompatibility', 'status']], '') || '').toLowerCase();
    const readinessState = executionReadiness && executionReadiness.ready === true ? 'pass' : (hasBlockers ? 'blocked' : 'warn');

    const decision = normalizeReviewDecision(
      readPreflightField(raw, [
        ['executionReadiness', 'status'],
        'decision',
        'status',
        'result',
        'overallStatus',
        ['qualityGate', 'status'],
        ['dependencyCompatibility', 'status'],
        ['gate', 'status'],
        ['policy', 'decision']
      ], readinessState)
    );

    const blocked = Boolean(
      readPreflightField(raw, [
        ['executionReadiness', 'blocked'],
        'blocked',
        'isBlocked',
        ['gate', 'blocked'],
        ['policy', 'blocked']
      ], false)
    ) || executionReadiness?.ready === false || decision === 'blocked' || hasBlockers || qualityGateStatus === 'fail' || dependencyStatus === 'fail' || forceBlocked;

    const summary = normalizeReviewText(
      readPreflightField(raw, [
        'summary',
        'message',
        ['qualityGate', 'summary'],
        ['quality', 'summary']
      ], fallbackMessage || (blocked ? 'Install/update is blocked by preflight policy.' : 'Review preflight checks before continuing.'))
    );

    const permissions = normalizeReviewItems(
      readPreflightField(raw, [
        ['permissionsReview', 'permissions'],
        'permissions',
        'permissionChecks',
        ['permissionReview', 'items'],
        ['manifest', 'permissions']
      ], pkg.permissions || []),
      'permission'
    );

    const qualityChecks = normalizeReviewItems(
      readPreflightField(raw, [
        'qualityChecks',
        ['qualityGate', 'checks'],
        ['quality', 'checks'],
        ['qa', 'checks']
      ], []),
      'quality'
    );

    const dependencyChecksRaw = normalizeReviewItems(
      readPreflightField(raw, [
        ['dependencyCompatibility', 'checks'],
        'dependencyChecks',
        'dependencies',
        ['dependencyReview', 'checks'],
        ['dependency', 'checks']
      ], []),
      'dependency'
    );

    const compatibilityChecksRaw = normalizeReviewItems(
      readPreflightField(raw, [
        'compatibilityChecks',
        'compatibility',
        ['runtimeCompatibility', 'checks'],
        ['compatibilityReview', 'checks'],
        ['dependencyCompatibility', 'compatibilityChecks'],
        ['dependencyCompatibility', 'checks']
      ], []),
      'compatibility'
    );
    const dependencyChecks = dedupeReviewItems(dependencyChecksRaw);
    const dependencyKeys = new Set(
      dependencyChecks.map((item) => `${String(item?.label || '').trim().toLowerCase()}|${String(item?.status || '').trim().toLowerCase()}|${String(item?.detail || '').trim().toLowerCase()}`)
    );
    const compatibilityChecks = dedupeReviewItems(compatibilityChecksRaw, dependencyKeys);

    const backupSummary = normalizeReviewText(
      readPreflightField(raw, [
        ['backupPlan', 'note'],
        ['backupPlan', 'summary'],
        ['backup', 'summary'],
        'backupPlan',
        'backup',
        ['rollbackPlan', 'summary']
      ], overwrite ? 'Backup recommended before overwrite update.' : 'No existing package backup required for first install.')
    );

    const backupChecks = normalizeReviewItems(
      readPreflightField(raw, [
        ['backupPlan', 'checks'],
        ['backup', 'checks'],
        ['rollbackPlan', 'checks']
      ], []),
      'backup'
    );

    const blockedReason = normalizeReviewText(
      readPreflightField(raw, [
        ['executionReadiness', 'reason'],
        'blockedReason',
        'reason',
        ['policy', 'reason']
      ], '')
    );

    const blockerItems = blockers.map((item) => ({
      code: String(item?.code || item?.id || 'preflight.blocker'),
      label: String(item?.code || item?.id || 'preflight.blocker'),
      status: 'fail',
      detail: String(item?.message || item?.reason || '')
    }));
    const localWorkspace = normalizeLocalWorkspaceBridge(
      readPreflightField(raw, [
        ['operation', 'localWorkspaceBridge'],
        ['operation', 'localWorkspace'],
        'localWorkspaceBridge',
        'localWorkspace'
      ], null),
      localWorkspaceFallback
    );

    return {
      packageId: pkg.id,
      packageTitle: pkg.title || pkg.id,
      overwrite,
      loading: false,
      forcePolicyBypass: false,
      decision,
      blocked,
      blockedReason,
      summary,
      permissions,
      qualitySummary: normalizeReviewText(
        readPreflightField(raw, [['qualityGate', 'summary'], ['quality', 'summary'], ['qa', 'summary']], '')
      ),
      qualityChecks,
      dependencyChecks,
      compatibilityChecks,
      backupSummary,
      backupChecks,
      blockerItems,
      onboarding: normalizeOnboardingReview(readPreflightField(raw, ['onboarding'], null)),
      toolPackageReview: normalizeToolPackageReview(readPreflightField(raw, ['toolPackageReview'], null)),
      lifecycleSafeguards: normalizeSafeguardReview(readPreflightField(raw, ['lifecycleSafeguards'], null)),
      localWorkspace,
      rawPreflight: raw,
      source: payload ? 'preflight-endpoint' : 'fallback'
    };
  }

  function normalizeManifestPreflight(payload = {}) {
    const raw = payload?.review || payload?.preflight || payload?.data || payload || {};
    const blockers = normalizeReviewItems(
      readPreflightField(raw, [
        ['executionReadiness', 'blockers'],
        'blockers'
      ], []),
      'blocker'
    ).map((item) => ({
      ...item,
      status: 'fail'
    }));
    const decision = normalizeReviewDecision(
      readPreflightField(raw, [
        ['executionReadiness', 'status'],
        'decision',
        'status',
        'result',
        'overallStatus'
      ], blockers.length > 0 ? 'blocked' : 'warn')
    );
    const blocked = Boolean(
      readPreflightField(raw, [
        ['executionReadiness', 'blocked'],
        'blocked',
        'isBlocked'
      ], false)
    ) || blockers.length > 0 || decision === 'blocked';

    return {
      decision,
      blocked,
      blockers,
      summary: normalizeReviewText(
        readPreflightField(raw, [
          ['executionReadiness', 'summary'],
          'summary',
          'message'
        ], blocked ? 'Manifest preflight is blocked.' : 'Manifest preflight completed.')
      ),
      mediaScopeReview: normalizeManifestMediaScopeReview(raw),
      rawPreflight: raw,
      source: payload ? 'preflight-endpoint' : 'fallback'
    };
  }

  async function approveLifecyclePreflight(preflight, typedInput = '') {
    const raw = preflight?.preflight || preflight?.rawPreflight || preflight || {};
    const typedConfirmation = assertLifecycleTypedConfirmation(raw, typedInput);
    const approvalResponse = await approvePackageLifecycle(raw, typedConfirmation);
    const approval = approvalResponse?.approval;
    if (!approval?.nonce) {
      throw new Error('Lifecycle approval response did not include a nonce.');
    }
    return {
      ...approval,
      targetHash: raw.targetHash
    };
  }

  function getLifecycleTypedConfirmation(preflight) {
    const raw = preflight?.preflight || preflight?.rawPreflight || preflight || {};
    return String(
      raw?.approval?.typedConfirmation
        || raw?.target?.id
        || raw?.operation?.appId
        || ''
    ).trim();
  }

  function assertLifecycleTypedConfirmation(preflight, typedInput) {
    const expected = getLifecycleTypedConfirmation(preflight);
    const actual = String(typedInput || '').trim();
    if (expected && actual !== expected) {
      const err = new Error(`Type ${expected} to approve this package lifecycle operation.`);
      err.code = 'PACKAGE_LIFECYCLE_TYPED_CONFIRMATION_REQUIRED';
      throw err;
    }
    return actual;
  }

  function normalizeManifestMediaScopeReview(source) {
    if (!source || typeof source !== 'object') return null;

    const raw = readPreflightField(
      source,
      [
        'mediaScopeReview',
        'mediaScopesReview',
        'mediaScope',
        'mediaScopes',
        ['approvalReview', 'mediaScopeReview'],
        ['approvals', 'mediaScopeReview']
      ],
      source
    );

    if (!raw || typeof raw !== 'object') return null;

    const approvalRequired = Boolean(
      readPreflightField(
        raw,
        [
          'approvalRequired',
          'requiresApproval',
          'needsApproval',
          'approvalNeeded',
          ['approval', 'required'],
          ['approval', 'needsApproval']
        ],
        false
      )
    );

    const approvalAccepted = Boolean(
      readPreflightField(
        raw,
        [
          'approvalAccepted',
          'approved',
          'accepted',
          'isApproved',
          ['approval', 'accepted'],
          ['approval', 'approved']
        ],
        false
      )
    );

    const scopes = normalizeReviewItems(
      readPreflightField(raw, ['scopes', 'items', 'permissions', 'checks', 'entries', 'mediaScopes'], []),
      'media-scope'
    );
    const normalizedStatus = normalizeReviewDecision(
      readPreflightField(raw, ['status', 'decision', 'result', 'overallStatus'], approvalRequired && !approvalAccepted ? 'warn' : 'pass')
    );
    const status = approvalRequired && !approvalAccepted && normalizedStatus === 'pass' ? 'warn' : normalizedStatus;
    const risk = normalizeReviewText(
      readPreflightField(raw, ['risk', 'riskLevel', 'severity', 'level'], approvalRequired && !approvalAccepted ? 'review' : 'low')
    );
    const summary = normalizeReviewText(
      readPreflightField(
        raw,
        ['summary', 'message', 'reason', 'note'],
        approvalRequired && !approvalAccepted
          ? 'Media scope approval is required before saving this manifest.'
          : 'Media scope review completed.'
      )
    );

    return {
      status,
      risk,
      summary,
      approvalRequired,
      approvalAccepted,
      scopes,
      source: source ? 'preflight-endpoint' : 'fallback'
    };
  }

  async function openInstallReview(pkg, options = {}) {
    const overwrite = options.overwrite === true;
    let localWorkspace = null;
    try {
      localWorkspace = resolveLocalWorkspacePayloadOrThrow();
    } catch (err) {
      error = err.message || 'Local workspace configuration is invalid.';
      return;
    }
    installLifecycleTypedInput = '';
    installReview = {
      packageId: pkg.id,
      packageTitle: pkg.title || pkg.id,
      overwrite,
      loading: true,
      forcePolicyBypass: false,
      decision: 'warn',
      blocked: false,
      blockedReason: '',
      summary: overwrite ? 'Running update preflight checks...' : 'Running install preflight checks...',
      permissions: [],
      qualitySummary: '',
      qualityChecks: [],
      dependencyChecks: [],
      compatibilityChecks: [],
      backupSummary: overwrite ? 'Backup review pending...' : 'Install backup review pending...',
      backupChecks: [],
      blockerItems: [],
      onboarding: normalizeOnboardingReview(null),
      toolPackageReview: normalizeToolPackageReview(null),
      lifecycleSafeguards: normalizeSafeguardReview(null),
      localWorkspace: normalizeLocalWorkspaceBridge(null, localWorkspace),
      source: 'loading'
    };

    clearFeedback();
    try {
      const response = await withTimeout(
        fetchRegistryInstallPreflight({
          sourceId: pkg.source?.id,
          packageId: pkg.id,
          zipUrl: pkg.zipUrl || '',
          overwrite,
          localWorkspace
        }),
        12000,
        'Preflight review request timed out.'
      );
      installReview = normalizeInstallPreflight(response, pkg, overwrite, '', {
        localWorkspaceFallback: localWorkspace
      });
    } catch (err) {
      installReview = normalizeInstallPreflight(
        null,
        pkg,
        overwrite,
        err.message || 'Preflight endpoint unavailable. Please verify details before continuing.',
        {
          forceBlocked: true,
          localWorkspaceFallback: localWorkspace
        }
      );
    }
  }

  function closeInstallReview() {
    installReview = null;
    installLifecycleTypedInput = '';
  }

  function canBypassInstallReviewPolicy(review) {
    if (!review || !Array.isArray(review.blockerItems)) return false;
    return review.blockerItems.some((item) => String(item?.code || '').trim() === 'REGISTRY_UPDATE_POLICY_BLOCKED');
  }

  function setInstallReviewBypass(checked) {
    if (!installReview) return;
    if (!canBypassInstallReviewPolicy(installReview)) {
      installReview = {
        ...installReview,
        forcePolicyBypass: false
      };
      return;
    }
    installReview = {
      ...installReview,
      forcePolicyBypass: checked === true
    };
  }

  async function quickInstallPackage(pkg, options = {}) {
    const overwrite = options.overwrite === true;
    clearFeedback();
    let localWorkspace = null;

    try {
      localWorkspace = resolveLocalWorkspacePayloadOrThrow();
    } catch (err) {
      error = err.message || 'Local workspace configuration is invalid.';
      return false;
    }

    try {
      const response = await withTimeout(
        fetchRegistryInstallPreflight({
          sourceId: pkg.source?.id,
          packageId: pkg.id,
          zipUrl: pkg.zipUrl || '',
          overwrite,
          localWorkspace
        }),
        12000,
        'Preflight review request timed out.'
      );
      const review = normalizeInstallPreflight(response, pkg, overwrite, '', {
        localWorkspaceFallback: localWorkspace
      });

      if (review.blocked) {
        installReview = review;
        error = review.blockedReason || 'Quick install is blocked by preflight policy. Review details and continue from advanced review.';
        return false;
      }

      if (review.decision !== 'pass') {
        installReview = review;
        message = 'Preflight returned warnings. Review details before continuing.';
        return false;
      }

      installLifecycleTypedInput = '';
      installReview = review;
      message = 'Preflight passed. Type the package id in the review panel to approve installation.';
      return false;
    } catch (err) {
      installReview = normalizeInstallPreflight(
        null,
        pkg,
        overwrite,
        err.message || 'Quick install preflight failed. Review details before continuing.',
        {
          forceBlocked: true,
          localWorkspaceFallback: localWorkspace
        }
      );
      error = err.message || 'Quick install preflight failed.';
      return false;
    }
  }

  async function executeInstallFromReview() {
    if (!installReview || installReview.loading) return;
    const target = storePackages.find((pkg) => pkg.id === installReview.packageId);
    if (!target) {
      error = 'Selected package is no longer in store results.';
      return;
    }
    const canBypassPolicy = canBypassInstallReviewPolicy(installReview);
    if (installReview.blocked && !canBypassPolicy) {
      error = 'Preflight is blocked by non-bypassable checks. Resolve blockers first.';
      return;
    }
    if (installReview.blocked && canBypassPolicy && !installReview.forcePolicyBypass) {
      error = 'Preflight is blocked by policy. Enable policy bypass to continue.';
      return;
    }

    const ok = await installPackage(target, {
      overwrite: installReview.overwrite,
      forcePolicyBypass: installReview.forcePolicyBypass,
      localWorkspace: installReview.localWorkspace?.status === 'inventory+local-workspace'
        ? {
            enabled: true,
            path: installReview.localWorkspace.path,
            mode: installReview.localWorkspace.mode || 'readwrite'
          }
        : null,
      review: installReview,
      typedConfirmation: installLifecycleTypedInput
    });
    if (ok) {
      closeInstallReview();
    }
  }

  function getInstallReviewDecisionLabel(review) {
    if (!review) return 'REVIEW';
    if (review.decision === 'pass' && !review.blocked) return 'PASS';
    if (review.decision === 'blocked' || review.blocked) return 'BLOCKED';
    return 'WARN';
  }

  function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return 'unknown size';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${Math.floor(value)} B`;
  }

  function getZipImportPseudoPackage(payload = null) {
    const raw = payload?.review || payload?.preflight || payload?.data || payload || {};
    const appId = String(
      readPreflightField(raw, [
        ['operation', 'appId'],
        ['manifest', 'id'],
        ['package', 'id'],
        'appId',
        'id'
      ], zipImportFile?.name || 'zip-import')
    ).trim();
    const title = String(
      readPreflightField(raw, [
        ['manifest', 'title'],
        ['package', 'title'],
        'title'
      ], appId || zipImportFile?.name || 'ZIP import')
    ).trim();

    return {
      id: appId || zipImportFile?.name || 'zip-import',
      title: title || appId || zipImportFile?.name || 'ZIP import',
      permissions: []
    };
  }

  function resetZipImportReview() {
    zipImportReview = null;
    zipImportLifecycleTypedInput = '';
  }

  function onZipImportFileChange(event) {
    const file = event.currentTarget.files?.[0] || null;
    zipImportFile = file;
    resetZipImportReview();
    clearFeedback();
    if (file && !/\.zip$/i.test(file.name)) {
      error = 'Select a .zip package file.';
    }
  }

  function setZipImportOverwrite(checked) {
    zipImportOverwrite = checked === true;
    resetZipImportReview();
  }

  async function runZipImportPreflight() {
    clearFeedback();
    if (!zipImportFile) {
      error = 'Select a ZIP package before review.';
      return;
    }
    if (!/\.zip$/i.test(zipImportFile.name)) {
      error = 'Select a .zip package file.';
      return;
    }

    let localWorkspace = null;
    try {
      localWorkspace = resolveLocalWorkspacePayloadOrThrow();
    } catch (err) {
      error = err.message || 'Local workspace configuration is invalid.';
      return;
    }

    zipImportPreflighting = true;
    zipImportReview = {
      packageId: zipImportFile.name,
      packageTitle: zipImportFile.name,
      overwrite: zipImportOverwrite,
      loading: true,
      forcePolicyBypass: false,
      decision: 'warn',
      blocked: false,
      blockedReason: '',
      summary: 'Running ZIP import preflight checks...',
      permissions: [],
      qualitySummary: '',
      qualityChecks: [],
      dependencyChecks: [],
      compatibilityChecks: [],
      backupSummary: zipImportOverwrite ? 'Backup review pending...' : 'No existing package backup required for first import.',
      backupChecks: [],
      blockerItems: [],
      onboarding: normalizeOnboardingReview(null),
      toolPackageReview: normalizeToolPackageReview(null),
      lifecycleSafeguards: normalizeSafeguardReview(null),
      localWorkspace: normalizeLocalWorkspaceBridge(null, localWorkspace),
      source: 'loading',
      fileName: zipImportFile.name,
      fileSize: zipImportFile.size
    };

    try {
      const response = await withTimeout(
        preflightZipPackageImport(zipImportFile, {
          overwrite: zipImportOverwrite,
          localWorkspace
        }),
        12000,
        'ZIP import preflight request timed out.'
      );
      zipImportReview = {
        ...normalizeInstallPreflight(
          response,
          getZipImportPseudoPackage(response),
          zipImportOverwrite,
          '',
          {
            localWorkspaceFallback: localWorkspace
          }
        ),
        fileName: zipImportFile.name,
        fileSize: zipImportFile.size
      };
    } catch (err) {
      zipImportReview = {
        ...normalizeInstallPreflight(
          null,
          getZipImportPseudoPackage(),
          zipImportOverwrite,
          err.message
            ? `Import preflight endpoint unavailable or failed (${err.message}). Verify the selected ZIP and overwrite setting before continuing.`
            : 'Import preflight endpoint unavailable. Verify the selected ZIP and overwrite setting before continuing.',
          {
            localWorkspaceFallback: localWorkspace
          }
        ),
        fileName: zipImportFile.name,
        fileSize: zipImportFile.size,
        source: 'fallback'
      };
    } finally {
      zipImportPreflighting = false;
    }
  }

  async function executeZipImport() {
    clearFeedback();
    if (!zipImportFile) {
      error = 'Select a ZIP package before import.';
      return;
    }
    if (!zipImportReview) {
      error = 'Run ZIP import review before importing.';
      return;
    }
    if (zipImportReview.blocked) {
      error = 'ZIP import review is blocked. Resolve blockers before importing.';
      return;
    }

    let localWorkspace = null;
    try {
      localWorkspace = resolveLocalWorkspacePayloadOrThrow();
    } catch (err) {
      error = err.message || 'Local workspace configuration is invalid.';
      return;
    }

    zipImporting = true;
    try {
      const response = await withTimeout(
        importZipPackage(zipImportFile, {
          overwrite: zipImportOverwrite,
          localWorkspace,
          approval: await approveLifecyclePreflight(zipImportReview, zipImportLifecycleTypedInput)
        }),
        30000,
        'ZIP package import timed out.'
      );
      const imported = response?.package || {};
      const importedTitle = imported.title || imported.id || zipImportFile.name;
      message = `ZIP package "${importedTitle}" imported successfully.`;
      zipImportFile = null;
      zipImportInputKey += 1;
      zipImportOverwrite = false;
      zipImportReview = null;
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
    } catch (err) {
      error = err.message || 'ZIP package import failed.';
    } finally {
      zipImporting = false;
    }
  }

  function getManifestEditorApprovals(state) {
    const approvals = state?.approvals && typeof state.approvals === 'object' ? state.approvals : {};
    return {
      mediaScopesAccepted: approvals.mediaScopesAccepted === true
    };
  }

  function getManifestMediaScopeReview(state) {
    const review = state?.preflight?.mediaScopeReview || null;
    if (!review || typeof review !== 'object') return null;

    const approvals = getManifestEditorApprovals(state);
    return {
      ...review,
      approvalRequired: review.approvalRequired === true,
      approvalAccepted: review.approvalAccepted === true || approvals.mediaScopesAccepted === true,
      scopes: Array.isArray(review.scopes) ? review.scopes : []
    };
  }

  function getManifestMediaScopeStatusLabel(review) {
    if (!review) return 'REVIEW';
    if (review.approvalRequired && !review.approvalAccepted) return 'APPROVAL REQUIRED';
    if (review.approvalAccepted) return 'APPROVED';
    return String(review.status || 'review').toUpperCase();
  }

  function getManifestMediaScopeApprovalHint(review) {
    if (!review?.approvalRequired) return 'Approval not required.';
    return review.approvalAccepted ? 'Approved for save.' : 'Approval required before save.';
  }

  async function loadInstalledPackages() {
    loadingInstalled = true;
    try {
      const response = await fetchInstalledPackages();
      installedPackages = Array.isArray(response.packages) ? response.packages : [];
      const activeIds = new Set(installedPackages.map((item) => item.id));
      for (const appId of Object.keys(consoleOpenByApp)) {
        if (!activeIds.has(appId)) {
          clearRuntimeLogs(appId);
          clearRuntimeEvents(appId);
        }
      }
    } catch (err) {
      installedPackages = [];
      setFeedbackError(err, 'Failed to load installed packages.', 'Load installed packages', loadInstalledPackages);
    } finally {
      loadingInstalled = false;
    }
  }

  async function loadRuntimeStatuses() {
    try {
      const response = await fetchRuntimeApps();
      const apps = Array.isArray(response.apps) ? response.apps : [];
      const next = {};
      for (const app of apps) {
        next[app.appId] = {
          status: app.status,
          pid: app.pid,
          lastError: app.lastError,
          updatedAt: app.updatedAt
        };
      }
      runtimeStatusByApp = next;
    } catch (_err) {
      runtimeStatusByApp = {};
    }
  }

  async function loadRegistrySources() {
    try {
      const response = await apiFetch('/api/packages/registry/sources');
      const nextSources = Array.isArray(response.sources) ? response.sources : [];
      registrySources = nextSources;
      if (activeStoreSource !== 'all' && !nextSources.some((source) => source.id === activeStoreSource)) {
        activeStoreSource = 'all';
      }
    } catch (_err) {
      registrySources = [];
      activeStoreSource = 'all';
    }
  }

  async function loadStorePackages() {
    loadingStore = true;
    try {
      const response = await apiFetch('/api/packages/registry');
      const results = Array.isArray(response.results) ? response.results : [];
      storeSourceErrors = results
        .filter((result) => !result.ok)
        .map((result) => ({
          id: result.source?.id || 'unknown',
          title: result.source?.title || result.source?.id || 'Unknown Source',
          error: result.error || 'Failed to load source.'
        }));
      storePackages = results
        .filter((result) => result.ok)
        .flatMap((result) => (Array.isArray(result.packages) ? result.packages : []))
        .sort((a, b) => {
          const sourceA = String(a.source?.title || a.source?.id || '');
          const sourceB = String(b.source?.title || b.source?.id || '');
          if (sourceA !== sourceB) {
            return sourceA.localeCompare(sourceB, 'ko');
          }
          return String(a.title || '').localeCompare(String(b.title || ''), 'ko');
        });
    } catch (err) {
      storePackages = [];
      storeSourceErrors = [];
      setFeedbackError(err, 'Failed to load store packages.', 'Load store packages', loadStorePackages);
    } finally {
      loadingStore = false;
    }
  }

  async function loadEcosystemTemplates() {
    try {
      const response = await apiFetch('/api/packages/ecosystem/templates');
      ecosystemTemplates = Array.isArray(response.templates) ? response.templates : [];
    } catch (_err) {
      ecosystemTemplates = [];
    }
  }

  async function saveStoreSource() {
    clearFeedback();
    const normalizedUrl = normalizeRegistryUrl(sourceForm.url);
    const sourceId = sourceForm.id.trim() || slugify(sourceForm.title || normalizedUrl);

    if (!normalizedUrl) {
      error = 'Please enter a store URL.';
      return;
    }
    if (!sourceId) {
      error = 'Please enter a store ID.';
      return;
    }

    savingSource = true;
    try {
      await apiFetch('/api/packages/registry/sources', {
        method: 'POST',
        body: JSON.stringify({
          id: sourceId,
          title: sourceForm.title.trim() || sourceId,
          url: normalizedUrl
        })
      });

      message = `Store source "${sourceId}" added.`;
      sourceForm = { id: '', title: '', url: '' };
      await loadRegistrySources();
      await loadStorePackages();
    } catch (err) {
      error = err.message || 'Failed to save store source.';
    } finally {
      savingSource = false;
    }
  }

  async function removeStoreSource(sourceId) {
    clearFeedback();
    try {
      await apiFetch(`/api/packages/registry/sources/${encodeURIComponent(sourceId)}`, {
        method: 'DELETE'
      });
      message = `Store source "${sourceId}" removed.`;
      if (activeStoreSource === sourceId) {
        activeStoreSource = 'all';
      }
      await loadRegistrySources();
      await loadStorePackages();
    } catch (err) {
      error = err.message || 'Failed to remove store source.';
    }
  }

  async function scaffoldTemplate(template) {
    scaffoldingTemplateId = template.id;
    clearFeedback();
    try {
      const appId = `${template.id}-${Math.random().toString(36).slice(2, 8)}`;
      const title = `${template.title} ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
      await apiFetch(`/api/packages/ecosystem/templates/${encodeURIComponent(template.id)}/scaffold`, {
        method: 'POST',
        body: JSON.stringify({ appId, title })
      });
      message = `Created "${appId}" from template "${template.title}".`;
      await Promise.all([loadInstalledPackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
    } catch (err) {
      error = err.message || 'Template scaffold failed.';
    } finally {
      scaffoldingTemplateId = '';
    }
  }

  function getStarterTemplate(templateId) {
    return ecosystemTemplates.find((template) => String(template?.id || '').trim() === templateId) || null;
  }

  async function scaffoldPersonalStarter(templateId) {
    const template = getStarterTemplate(templateId);
    if (!template || scaffoldingTemplateId) return;
    await scaffoldTemplate(template);
  }

  async function downloadInstalledPackage(pkg) {
    try {
      const href = await fetchPackageExportTicketUrl(pkg.id);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `${pkg.id || 'package'}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      message = `Export started: ${pkg.title}`;
    } catch (err) {
      error = err?.message || 'Package export failed.';
    }
  }

  function openCloneDialog(pkg) {
    clearFeedback();
    cloneDialog = {
      pkg,
      targetId: `${pkg.id}-copy`,
      title: `${pkg.title} (Copy)`,
      error: '',
      loading: false
    };
  }

  function closeCloneDialog() {
    if (cloneDialog?.loading) return;
    cloneDialog = null;
  }

  function setCloneDialogField(field, value) {
    if (!cloneDialog) return;
    cloneDialog = {
      ...cloneDialog,
      [field]: value
    };
  }

  async function submitCloneDialog() {
    if (!cloneDialog?.pkg || cloneDialog.loading) return;
    const pkg = cloneDialog.pkg;
    const targetId = String(cloneDialog.targetId || '').trim();
    const title = String(cloneDialog.title || '').trim();
    if (!targetId) {
      cloneDialog = {
        ...cloneDialog,
        error: 'Clone target id is required.'
      };
      return;
    }

    cloneDialog = {
      ...cloneDialog,
      loading: true,
      error: ''
    };
    try {
      await cloneInstalledPackageRequest(pkg.id, targetId, title);
      message = `Package "${pkg.title}" cloned to "${targetId}".`;
      cloneDialog = null;
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
    } catch (err) {
      cloneDialog = {
        ...cloneDialog,
        loading: false,
        error: err.message || 'Failed to clone package.'
      };
    }
  }

  async function installPackage(pkg, options = {}) {
    installingPackageId = pkg.id;
    clearFeedback();
    try {
      const overwrite = options.overwrite === true;
      const forcePolicyBypass = options.forcePolicyBypass === true;
      const localWorkspace = options.localWorkspace && typeof options.localWorkspace === 'object'
        ? options.localWorkspace
        : null;
      await installRegistryPackage({
        sourceId: pkg.source?.id,
        packageId: pkg.id,
        zipUrl: pkg.zipUrl || '',
        overwrite,
        forcePolicyBypass,
        localWorkspace,
        approval: await approveLifecyclePreflight(options.review, options.typedConfirmation)
      });
      message = overwrite
        ? `Package "${pkg.title}" updated successfully.`
        : `Package "${pkg.title}" installed successfully.`;
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
      activeCategory = CATEGORY.INSTALLED;
      return true;
    } catch (err) {
      error = err.message || 'Package install/update failed.';
      return false;
    } finally {
      installingPackageId = '';
    }
  }

  function openInstalledPackage(pkg) {
    openWindow({
      ...pkg,
      iconType: hasImageIcon(pkg) ? 'image' : 'lucide',
      iconUrl: getIconUrl(pkg),
      iconComponent: LayoutGrid
    });
  }

  function stopInstalledPackage(pkg) {
    const active = get(windows).filter((item) => item.appId === pkg.id);
    if (active.length === 0) {
      message = `No running window found for "${pkg.title}".`;
      return;
    }

    for (const win of active) {
      closeWindow(win.id);
    }
    message = `Closed ${active.length} window(s) for "${pkg.title}".`;
  }

  async function controlRuntime(pkg, action) {
    runtimeActioning = `${pkg.id}:${action}`;
    clearFeedback();
    try {
      await withTimeout(
        controlRuntimeApp(pkg.id, action),
        15000,
        'Runtime control request timed out.'
      );
      await loadRuntimeStatuses();
      const actionLabel = action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted';
      message = `"${pkg.title}" ${actionLabel}.`;
    } catch (err) {
      error = err.message || `Failed to ${action} runtime.`;
    } finally {
      runtimeActioning = '';
    }
  }

  async function toggleRuntimeLogs(pkg) {
    if (runtimeLogsByApp[pkg.id]) {
      clearRuntimeLogs(pkg.id);
      return;
    }

    runtimeLogsLoading = pkg.id;
    clearFeedback();
    try {
      const response = await withTimeout(
        fetchRuntimeLogs(pkg.id, 200),
        10000,
        'Runtime log request timed out.'
      );
      runtimeLogsByApp = {
        ...runtimeLogsByApp,
        [pkg.id]: Array.isArray(response.logs) ? response.logs : []
      };
    } catch (err) {
      error = err.message || 'Failed to load runtime logs.';
    } finally {
      runtimeLogsLoading = '';
    }
  }

  async function loadRuntimeEvents(appId) {
    runtimeEventsLoading = appId;
    try {
      const response = await withTimeout(
        fetchRuntimeEvents(appId, 120),
        10000,
        'Runtime events request timed out.'
      );
      runtimeEventsByApp = {
        ...runtimeEventsByApp,
        [appId]: Array.isArray(response.events) ? response.events : []
      };
    } catch (err) {
      clearRuntimeEvents(appId);
      error = err.message || 'Failed to load runtime events.';
    } finally {
      runtimeEventsLoading = '';
    }
  }

  async function loadLifecycle(appId) {
    lifecycleLoading = appId;
    try {
      const response = await withTimeout(
        fetchPackageLifecycle(appId),
        10000,
        'Lifecycle request timed out.'
      );
      lifecycleByApp = {
        ...lifecycleByApp,
        [appId]: response.lifecycle || null
      };
      normalizeBackupPolicyDraft(appId, response.lifecycle || null);
    } catch (err) {
      lifecycleByApp = {
        ...lifecycleByApp,
        [appId]: null
      };
      error = err.message || 'Failed to load lifecycle.';
    } finally {
      lifecycleLoading = '';
    }
  }

  async function runHealthCheck(pkg) {
    healthLoading = pkg.id;
    clearFeedback();
    try {
      const response = await withTimeout(
        runPackageHealth(pkg.id),
        12000,
        'Health check timed out.'
      );
      healthByApp = {
        ...healthByApp,
        [pkg.id]: response.report || null
      };
      await loadLifecycle(pkg.id);
    } catch (err) {
      error = err.message || 'Health check failed.';
    } finally {
      healthLoading = '';
    }
  }

  async function setReleaseChannel(pkg, channel) {
    lifecycleActioning = `${pkg.id}:channel:${channel}`;
    clearFeedback();
    try {
      await updatePackageChannel(pkg.id, channel);
      await loadLifecycle(pkg.id);
      message = `"${pkg.title}" channel changed to ${channel}.`;
    } catch (err) {
      error = err.message || 'Failed to change channel.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function createLifecycleBackup(pkg) {
    lifecycleActioning = `${pkg.id}:backup`;
    clearFeedback();
    try {
      await createPackageBackup(pkg.id, getBackupNote(pkg.id) || 'Manual backup from Package Center');
      setBackupNote(pkg.id, '');
      await loadLifecycle(pkg.id);
      message = `"${pkg.title}" backup created.`;
    } catch (err) {
      error = err.message || 'Failed to create backup.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function createBackupJob(pkg) {
    lifecycleActioning = `${pkg.id}:backup-job:create`;
    clearFeedback();
    try {
      const note = getBackupNote(pkg.id) || 'Backup job requested from Package Center';
      await createPackageBackupJob(pkg.id, note);
      setBackupNote(pkg.id, '');
      await loadBackupJobs(pkg.id);
      message = `"${pkg.title}" backup job queued.`;
    } catch (err) {
      error = err.message || 'Failed to queue backup job.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function saveBackupPolicy(pkg) {
    lifecycleActioning = `${pkg.id}:backup-policy`;
    clearFeedback();
    try {
      const payload = buildBackupPolicyPayloadFromDraft(pkg.id, pkg);
      await updatePackageBackupPolicy(pkg.id, payload);
      await loadLifecycle(pkg.id);
      message = `"${pkg.title}" backup policy updated.`;
    } catch (err) {
      error = err.message || 'Failed to update backup policy.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function cancelBackupJob(pkg, job) {
    if (!job?.id) return;
    const actionKey = getBackupJobActioningKey(pkg.id, job.id, 'cancel');
    backupJobActioningByApp = {
      ...backupJobActioningByApp,
      [actionKey]: true
    };
    clearFeedback();

    try {
      await cancelPackageBackupJob(pkg.id, job.id);
      await loadBackupJobs(pkg.id);
      message = `"${pkg.title}" backup job canceled.`;
    } catch (err) {
      error = err.message || 'Failed to cancel backup job.';
    } finally {
      const nextActioning = { ...backupJobActioningByApp };
      delete nextActioning[actionKey];
      backupJobActioningByApp = nextActioning;
    }
  }

  function closeRollbackReview() {
    if (rollbackReview?.loading) return;
    rollbackReview = null;
    rollbackLifecycleTypedInput = '';
  }

  function normalizeRollbackReview(payload, pkg, backupId) {
    const raw = payload?.preflight || payload?.data?.preflight || payload || {};
    const blockers = Array.isArray(raw?.executionReadiness?.blockers)
      ? raw.executionReadiness.blockers
      : [];
    const blocked = blockers.length > 0 || raw?.executionReadiness?.ready === false;
    return {
      pkg,
      backupId,
      preflight: raw,
      blocked,
      blockers,
      typedConfirmation: getLifecycleTypedConfirmation(raw) || pkg.id,
      summary: String(
        raw?.lifecycleSafeguards?.summary
          || raw?.rollbackPlan?.summary
          || raw?.executionReadiness?.summary
          || (blocked ? 'Rollback is blocked by lifecycle safeguards.' : 'Review rollback impact before continuing.')
      ),
      error: '',
      loading: false
    };
  }

  async function openRollbackReview(pkg) {
    const backupId = selectedBackupByApp[pkg.id] || '';
    if (!backupId) {
      error = 'Select a backup to rollback.';
      return;
    }

    lifecycleActioning = `${pkg.id}:rollback`;
    rollbackLifecycleTypedInput = '';
    rollbackReview = {
      pkg,
      backupId,
      preflight: null,
      blocked: false,
      blockers: [],
      typedConfirmation: pkg.id,
      summary: 'Running rollback preflight checks...',
      error: '',
      loading: true
    };
    clearFeedback();
    try {
      const preflight = await preflightPackageRollback(pkg.id, backupId);
      rollbackReview = normalizeRollbackReview(preflight, pkg, backupId);
    } catch (err) {
      rollbackReview = rollbackReview
        ? {
            ...rollbackReview,
            loading: false,
            blocked: true,
            error: err.message || 'Rollback preflight failed.'
          }
        : null;
      error = err.message || 'Rollback preflight failed.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function executeRollbackReview() {
    if (!rollbackReview?.pkg || rollbackReview.loading || rollbackReview.blocked) return;
    const { pkg, backupId, preflight } = rollbackReview;
    lifecycleActioning = `${pkg.id}:rollback`;
    rollbackReview = {
      ...rollbackReview,
      loading: true,
      error: ''
    };
    clearFeedback();
    try {
      await rollbackPackageBackup(pkg.id, backupId, {
        approval: await approveLifecyclePreflight(preflight, rollbackLifecycleTypedInput)
      });
      await Promise.all([loadLifecycle(pkg.id), loadRuntimeStatuses()]);
      message = `"${pkg.title}" rollback completed.`;
      rollbackReview = null;
      rollbackLifecycleTypedInput = '';
    } catch (err) {
      rollbackReview = rollbackReview
        ? {
            ...rollbackReview,
            loading: false,
            error: err.message || 'Rollback failed.'
          }
        : null;
      error = err.message || 'Rollback failed.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function recoverRuntime(pkg) {
    lifecycleActioning = `${pkg.id}:recover`;
    clearFeedback();
    try {
      await recoverRuntimeApp(pkg.id);
      await Promise.all([loadRuntimeStatuses(), loadRuntimeEvents(pkg.id)]);
      message = `"${pkg.title}" runtime recover requested.`;
    } catch (err) {
      error = err.message || 'Runtime recover failed.';
    } finally {
      lifecycleActioning = '';
    }
  }

  async function openManifestEditor(pkg) {
    updateManifestEditorState(pkg.id, {
      open: true,
      loading: true,
      loadError: '',
      text: '',
      parsed: null,
      parseError: '',
      preflightLoading: false,
      preflight: null,
      approvals: {
        mediaScopesAccepted: false
      },
      lifecycleTypedInput: '',
      saving: false
    });

    try {
      const response = await withTimeout(
        fetchPackageManifest(pkg.id),
        10000,
        'Manifest request timed out.'
      );
      const manifestValue = response?.manifest ?? response;
      if (!manifestValue || typeof manifestValue !== 'object' || Array.isArray(manifestValue)) {
        throw new Error('Manifest response is not a valid object.');
      }

      updateManifestEditorState(pkg.id, {
        loading: false,
        loadError: '',
        text: JSON.stringify(manifestValue, null, 2),
        parsed: manifestValue,
        parseError: '',
        preflight: null,
        approvals: {
          mediaScopesAccepted: false
        },
        lifecycleTypedInput: ''
      });
    } catch (err) {
      updateManifestEditorState(pkg.id, {
        loading: false,
        loadError: err.message || 'Failed to load manifest.'
      });
    }
  }

  function closeManifestEditor(pkg) {
    updateManifestEditorState(pkg.id, {
      open: false
    });
  }

  function onManifestEditorInput(pkg, value) {
    let parsed = null;
    let parseError = '';
    try {
      parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        parseError = 'Manifest JSON must be an object at the root.';
      }
    } catch (err) {
      parseError = err.message || 'Invalid JSON.';
    }

    updateManifestEditorState(pkg.id, {
      text: value,
      parsed,
      parseError,
      preflight: null,
      approvals: {
        mediaScopesAccepted: false
      },
      lifecycleTypedInput: ''
    });
  }

  function setManifestLifecycleTypedInput(pkg, value) {
    updateManifestEditorState(pkg.id, {
      lifecycleTypedInput: String(value || '')
    });
  }

  function setManifestMediaScopesAccepted(pkg, checked) {
    updateManifestEditorState(pkg.id, (current) => ({
      ...current,
      approvals: {
        ...(current?.approvals && typeof current.approvals === 'object' ? current.approvals : {}),
        mediaScopesAccepted: checked === true
      }
    }));
  }

  async function runManifestPreflight(pkg) {
    const current = getManifestEditorState(pkg.id);
    if (!current || current.loading || current.parseError || !current.parsed) {
      return;
    }

    updateManifestEditorState(pkg.id, {
      preflightLoading: true
    });
    clearFeedback();

    try {
      const response = await withTimeout(
        preflightPackageManifestUpdate(pkg.id, current.parsed, getManifestEditorApprovals(current)),
        12000,
        'Manifest preflight timed out.'
      );
      updateManifestEditorState(pkg.id, {
        preflightLoading: false,
        preflight: normalizeManifestPreflight(response),
        lifecycleTypedInput: ''
      });
      message = `"${pkg.title}" manifest preflight completed.`;
    } catch (err) {
      updateManifestEditorState(pkg.id, {
        preflightLoading: false,
        preflight: {
          decision: 'blocked',
          blocked: true,
          blockers: [],
          summary: err.message || 'Manifest preflight failed.',
          source: 'preflight-endpoint'
        }
      });
      error = err.message || 'Manifest preflight failed.';
    }
  }

  async function saveManifestUpdate(pkg) {
    const current = getManifestEditorState(pkg.id);
    if (!current || current.loading || current.saving || current.parseError || !current.parsed) {
      return;
    }
    const mediaScopeReview = getManifestMediaScopeReview(current);
    if (current.preflight?.blocked) {
      error = 'Manifest preflight is blocked. Resolve blockers before saving.';
      return;
    }
    if (mediaScopeReview?.approvalRequired && !mediaScopeReview.approvalAccepted) {
      error = 'Media scope approval is required before saving this manifest.';
      return;
    }

    updateManifestEditorState(pkg.id, {
      saving: true
    });
    clearFeedback();

    try {
      await withTimeout(
        updatePackageManifest(pkg.id, current.parsed, {
          ...getManifestEditorApprovals(current),
          approval: await approveLifecyclePreflight(current.preflight, current.lifecycleTypedInput)
        }),
        15000,
        'Manifest update timed out.'
      );
      await Promise.all([
        loadInstalledPackages(),
        loadRuntimeStatuses(),
        hydrateOpsConsole(pkg.id, { silent: true })
      ]);
      message = `"${pkg.title}" manifest saved.`;
      await openManifestEditor(pkg);
    } catch (err) {
      error = err.message || 'Manifest update failed.';
      updateManifestEditorState(pkg.id, {
        saving: false
      });
    }
  }

  async function toggleManifestEditor(pkg) {
    if (isManifestEditorOpen(pkg.id)) {
      closeManifestEditor(pkg);
      return;
    }
    await openManifestEditor(pkg);
  }

  function applyOpsSummary(appId, summary) {
    lifecycleByApp = {
      ...lifecycleByApp,
      [appId]: summary.lifecycle || null
    };
    normalizeBackupPolicyDraft(appId, summary.lifecycle || null);
    runtimeEventsByApp = {
      ...runtimeEventsByApp,
      [appId]: Array.isArray(summary.events) ? summary.events : []
    };
    if (summary.healthReport || summary.lifecycle?.lastQaReport) {
      healthByApp = {
        ...healthByApp,
        [appId]: summary.healthReport || summary.lifecycle?.lastQaReport || null
      };
    }
    if (summary.runtimeStatus) {
      runtimeStatusByApp = {
        ...runtimeStatusByApp,
        [appId]: summary.runtimeStatus
      };
    }
  }

  async function hydrateOpsConsole(appId, options = {}) {
    const withLoading = options.withLoading === true;
    const silent = options.silent === true;

    if (withLoading) {
      lifecycleLoading = appId;
      runtimeEventsLoading = appId;
    }

    try {
      const summary = await withTimeout(
        fetchInstalledOpsSummary(appId, { eventsLimit: 120 }),
        10000,
        'Ops console request timed out.'
      );
      applyOpsSummary(appId, summary);
      return true;
    } catch (err) {
      if (!silent) {
        lifecycleByApp = {
          ...lifecycleByApp,
          [appId]: null
        };
        clearRuntimeEvents(appId);
        error = err.message || 'Failed to load ops console data.';
      }
      return false;
    } finally {
      if (withLoading) {
        lifecycleLoading = '';
        runtimeEventsLoading = '';
      }
    }
  }

  async function toggleOpsConsole(pkg) {
    const currentlyOpen = isConsoleOpen(pkg);
    consoleOpenByApp = {
      ...consoleOpenByApp,
      [pkg.id]: !currentlyOpen
    };
    if (currentlyOpen) {
      return;
    }

    await Promise.all([
      hydrateOpsConsole(pkg.id, { withLoading: true }),
      loadPackageFiles(pkg.id, getPackageFilesState(pkg.id).path || ''),
      loadBackupJobs(pkg.id, { silent: true })
    ]);
  }

  function normalizePackageDeletePreflight(payload, pkg) {
    const raw = payload?.preflight || payload?.data?.preflight || payload || {};
    const target = raw.target && typeof raw.target === 'object' ? raw.target : {};
    const approval = raw.approval && typeof raw.approval === 'object' ? raw.approval : {};
    const recoverability = raw.recoverability && typeof raw.recoverability === 'object'
      ? raw.recoverability
      : {};
    const targetId = String(target.id || pkg?.id || '').trim();
    const targetLabel = String(target.label || pkg?.title || targetId || 'Package').trim();
    const typedConfirmation = approval.typedConfirmation != null
      ? String(approval.typedConfirmation)
      : String(targetId || pkg?.id || '').trim();

    return {
      operationId: String(raw.operationId || '').trim(),
      action: String(raw.action || 'package.delete').trim(),
      target: {
        type: String(target.type || 'package').trim(),
        id: targetId,
        label: targetLabel
      },
      riskLevel: String(raw.riskLevel || 'high').trim().toLowerCase(),
      impact: Array.isArray(raw.impact)
        ? raw.impact.map((item) => normalizeReviewText(item, '')).filter(Boolean)
        : [],
      recoverability: {
        backupAvailable: recoverability.backupAvailable === true,
        latestBackupId: String(recoverability.latestBackupId || '').trim(),
        rollbackSupported: recoverability.rollbackSupported === true
      },
      approval: {
        required: approval.required !== false,
        typedConfirmation,
        expiresAt: String(approval.expiresAt || '').trim()
      },
      targetHash: String(raw.targetHash || '').trim()
    };
  }

  function isPackageDeleteBusy(appId) {
    return removingPackageId === appId || packageDeleteReview?.appId === appId;
  }

  async function cleanupRemovedInstalledPackage(pkg) {
    stopInstalledPackage(pkg);
    message = `Package "${pkg.title}" removed.`;
    clearRuntimeLogs(pkg.id);
    clearRuntimeEvents(pkg.id);
    lifecycleByApp = { ...lifecycleByApp, [pkg.id]: null };
    healthByApp = { ...healthByApp, [pkg.id]: null };
    consoleOpenByApp = { ...consoleOpenByApp, [pkg.id]: false };
    selectedBackupByApp = { ...selectedBackupByApp, [pkg.id]: '' };
    backupJobsByApp = { ...backupJobsByApp, [pkg.id]: [] };
    backupJobsLoadingByApp = { ...backupJobsLoadingByApp, [pkg.id]: false };
    {
      const nextBackupPolicyDraftByApp = { ...backupPolicyDraftByApp };
      delete nextBackupPolicyDraftByApp[pkg.id];
      backupPolicyDraftByApp = nextBackupPolicyDraftByApp;
    }
    {
      const nextManifestEditorByApp = { ...manifestEditorByApp };
      delete nextManifestEditorByApp[pkg.id];
      manifestEditorByApp = nextManifestEditorByApp;
    }
    {
      const nextPackageFilesByApp = { ...packageFilesByApp };
      delete nextPackageFilesByApp[pkg.id];
      packageFilesByApp = nextPackageFilesByApp;
    }
    {
      const nextPackageFilesLoadingByApp = { ...packageFilesLoadingByApp };
      delete nextPackageFilesLoadingByApp[pkg.id];
      packageFilesLoadingByApp = nextPackageFilesLoadingByApp;
    }
    {
      const nextPackageFilesErrorByApp = { ...packageFilesErrorByApp };
      delete nextPackageFilesErrorByApp[pkg.id];
      packageFilesErrorByApp = nextPackageFilesErrorByApp;
    }
    await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
  }

  function closePackageDeleteReview() {
    if (removingPackageId) return;
    packageDeleteReview = null;
    packageDeleteTypedInput = '';
  }

  async function openPackageDeleteReview(pkg) {
    const appId = String(pkg?.id || '').trim();
    if (!appId) return;

    clearFeedback();
    packageDeleteTypedInput = '';
    packageDeleteReview = {
      appId,
      pkg,
      loading: true,
      preflight: null,
      error: ''
    };
    try {
      const response = await withTimeout(
        preflightPackageDelete(appId),
        10000,
        'Package delete preflight request timed out.'
      );
      packageDeleteReview = {
        ...packageDeleteReview,
        loading: false,
        preflight: normalizePackageDeletePreflight(response, pkg)
      };
    } catch (err) {
      packageDeleteReview = {
        ...packageDeleteReview,
        loading: false,
        error: err?.message || 'Package delete preflight failed.'
      };
    }
  }

  async function executePackageDelete() {
    const review = packageDeleteReview;
    const pkg = review?.pkg;
    const appId = String(review?.appId || pkg?.id || '').trim();
    if (!appId || !pkg || !review?.preflight || removingPackageId) return;

    const typedConfirmation = String(review.preflight.approval.typedConfirmation || appId);
    const typedInput = packageDeleteTypedInput.trim();
    if (typedInput !== typedConfirmation) {
      packageDeleteReview = {
        ...review,
        error: `Type ${typedConfirmation} to approve package removal.`
      };
      return;
    }

    removingPackageId = appId;
    let deleteCommitted = false;
    try {
      const approvalResponse = await approvePackageDelete(appId, {
        operationId: review.preflight.operationId,
        typedConfirmation: typedInput
      });
      const approval = approvalResponse?.approval;
      if (!approval?.nonce) {
        const err = new Error('Delete approval response did not include a nonce.');
        err.code = 'PACKAGE_DELETE_APPROVAL_INVALID';
        throw err;
      }

      if (isServicePackage(pkg)) {
        await stopRuntimeApp(appId).catch(() => {});
      }

      await removeInstalledPackageRequest(appId, {
        approval: {
          ...approval,
          targetHash: review.preflight.targetHash
        },
        reason: 'Package Center user-approved removal'
      });
      deleteCommitted = true;
      packageDeleteReview = null;
      packageDeleteTypedInput = '';
      await cleanupRemovedInstalledPackage(pkg);
    } catch (err) {
      const fallbackMessage = deleteCommitted
        ? 'Package was removed, but Package Center refresh failed.'
        : 'Failed to remove package.';
      const retry = deleteCommitted
        ? () => Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()])
        : () => openPackageDeleteReview(pkg);
      packageDeleteReview = packageDeleteReview
        ? {
            ...packageDeleteReview,
            error: err?.message || fallbackMessage
          }
        : packageDeleteReview;
      setFeedbackError(err, fallbackMessage, deleteCommitted ? 'Refresh packages' : 'Remove package', retry);
    } finally {
      if (removingPackageId === appId) {
        removingPackageId = '';
      }
    }
  }

  onMount(() => {
    Promise.all([
      loadRegistrySources(),
      loadStorePackages(),
      loadEcosystemTemplates(),
      loadInstalledPackages(),
      loadRuntimeStatuses()
    ]).catch(() => {});
    const timer = setInterval(() => {
      if (activeCategory === CATEGORY.INSTALLED) {
        loadRuntimeStatuses().catch(() => {});
        const openIds = Object.entries(consoleOpenByApp)
          .filter(([, opened]) => opened)
          .map(([appId]) => appId);
        for (const appId of openIds) {
          hydrateOpsConsole(appId, { silent: true }).catch(() => {});
          loadBackupJobs(appId, { silent: true }).catch(() => {});
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  });
</script>

<div class="package-center">
  <aside class="category-panel glass-effect">
    <div class="panel-title">Package Center</div>
    <div class="panel-kicker">Library</div>
    <button class="category {activeCategory === CATEGORY.STORE ? 'active' : ''}" onclick={() => setActiveCategory(CATEGORY.STORE)}>
      <Store size={16} />
      <span>Store</span>
      <small>{storePackages.length}</small>
    </button>
    <button class="category {activeCategory === CATEGORY.INSTALLED ? 'active' : ''}" onclick={() => setActiveCategory(CATEGORY.INSTALLED)}>
      <LayoutGrid size={16} />
      <span>Installed</span>
      <small>{installedPackages.length}</small>
    </button>

    <div class="panel-divider"></div>
    <section class="package-list-panel glass-effect">
      <div class="package-list-head">
        <div class="package-list-title">
          <span>{activeCategory === CATEGORY.STORE ? 'Discover' : 'Installed'}</span>
          <strong>{getFilteredActivePackageList().length} packages</strong>
        </div>
        <div class="package-list-actions">
          {#if activeCategory === CATEGORY.STORE}
            <button
              class="btn icon {packageUtilityPanel === 'sources' ? 'active' : ''}"
              onclick={() => { packageUtilityPanel = packageUtilityPanel === 'sources' ? '' : 'sources'; }}
              title="Package sources"
              aria-label="Package sources"
              aria-pressed={packageUtilityPanel === 'sources'}
            >
              <Link2 size={15} />
            </button>
            <button
              class="btn icon {packageUtilityPanel === 'zip' ? 'active' : ''}"
              onclick={() => { packageUtilityPanel = packageUtilityPanel === 'zip' ? '' : 'zip'; }}
              title="Import ZIP package"
              aria-label="Import ZIP package"
              aria-pressed={packageUtilityPanel === 'zip'}
            >
              <Upload size={15} />
            </button>
          {/if}
          <button class="btn icon" onclick={reloadActivePackages} disabled={activeCategory === CATEGORY.STORE ? loadingStore : loadingInstalled} title="Reload" aria-label="Reload packages">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      <label class="library-search">
        <Search size={15} />
        <input type="search" bind:value={packageQuery} placeholder="Search packages" />
      </label>

      <div class="package-list-controls">
        {#if activeCategory === CATEGORY.STORE}
          <div class="package-create compact-create-panel">
            <div class="compact-create-head">
              <div>
                <h3>Create Package</h3>
                <div class="runtime-log-empty">Start from an app, widget, service, or hybrid package template.</div>
              </div>
            </div>

            <div class="starter-apps compact">
              <div class="section-title">Personal Starter Apps</div>
              <div class="starter-apps-list">
                {#each PERSONAL_STARTER_APPS as starter}
                  {@const starterTemplate = getStarterTemplate(starter.templateId)}
                  <button
                    class="btn tiny"
                    disabled={!starterTemplate || scaffoldingTemplateId === starter.templateId}
                    onclick={() => scaffoldPersonalStarter(starter.templateId)}
                  >
                    {#if starterTemplate}
                      {scaffoldingTemplateId === starter.templateId ? `Creating ${starter.title}...` : `Create ${starter.title}`}
                    {:else}
                      {starter.title} (template unavailable)
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            <div class="starter-apps compact">
              <div class="section-title">Developer Tool Starters</div>
              <div class="starter-apps-list">
                {#each DEVELOPER_STARTER_APPS as starter}
                  {@const starterTemplate = getStarterTemplate(starter.templateId)}
                  <button
                    class="btn tiny"
                    disabled={!starterTemplate || scaffoldingTemplateId === starter.templateId}
                    onclick={() => scaffoldPersonalStarter(starter.templateId)}
                  >
                    {#if starterTemplate}
                      {scaffoldingTemplateId === starter.templateId ? `Creating ${starter.title}...` : `Create ${starter.title}`}
                    {:else}
                      {starter.title} (template unavailable)
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            {#if ecosystemTemplates.length > 0}
              <div class="ecosystem-templates compact">
                <div class="section-title">Official Ecosystem Templates</div>
                <div class="template-list compact">
                  {#each ecosystemTemplates as template}
                    <article class="template-card compact">
                      <div class="template-top">
                        <strong>{template.title}</strong>
                        <span>{template.category}</span>
                      </div>
                      <p>{template.description}</p>
                      <button
                        class="btn tiny"
                        onclick={() => scaffoldTemplate(template)}
                        disabled={scaffoldingTemplateId === template.id}
                      >
                        {scaffoldingTemplateId === template.id ? 'Creating...' : 'Create From Template'}
                      </button>
                    </article>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="wizard-panel compact">
              <div class="wizard-head">
                <div>
                  <div class="section-title">Package Creation Wizard</div>
                  <div class="runtime-log-empty">Draft manifest, run preflight review, then create.</div>
                </div>
                <div class="wizard-steps">
                  <span class="wizard-step {wizardPhase === 'draft' ? 'active' : ''}">1. Draft</span>
                  <span class="wizard-step {wizardPhase === 'review' ? 'active' : ''}">2. Review</span>
                </div>
              </div>
              <div class="wizard-form-grid compact">
                <select value={wizardDraft.templateId} onchange={(event) => updateWizardDraft('templateId', event.currentTarget.value)}>
                  <option value="">custom (no template)</option>
                  {#each ecosystemTemplates as template}
                    <option value={template.id}>{template.title}</option>
                  {/each}
                </select>
                <input
                  type="text"
                  placeholder="id (e.g. demo-notes)"
                  value={wizardDraft.id}
                  oninput={(event) => updateWizardDraft('id', event.currentTarget.value)}
                />
                <input
                  type="text"
                  placeholder="title"
                  value={wizardDraft.title}
                  oninput={(event) => updateWizardDraft('title', event.currentTarget.value)}
                />
                <input
                  type="text"
                  placeholder="description"
                  value={wizardDraft.description}
                  oninput={(event) => updateWizardDraft('description', event.currentTarget.value)}
                />
                <input
                  type="text"
                  placeholder="version"
                  value={wizardDraft.version}
                  oninput={(event) => updateWizardDraft('version', event.currentTarget.value)}
                />
                <select value={wizardDraft.appType} onchange={(event) => updateWizardDraft('appType', event.currentTarget.value)}>
                  <option value="app">app</option>
                  <option value="widget">widget</option>
                  <option value="service">service</option>
                  <option value="hybrid">hybrid</option>
                  <option value="developer">developer</option>
                </select>
                <select value={wizardDraft.runtimeType} onchange={(event) => updateWizardDraft('runtimeType', event.currentTarget.value)}>
                  <option value="sandbox-html">sandbox-html</option>
                  <option value="process-node">process-node</option>
                  <option value="process-python">process-python</option>
                  <option value="binary">binary</option>
                </select>
                <input
                  type="text"
                  placeholder="entry (e.g. index.html)"
                  value={wizardDraft.entry}
                  oninput={(event) => updateWizardDraft('entry', event.currentTarget.value)}
                />
                {#if wizardDraft.appType === 'hybrid'}
                  <input
                    type="text"
                    placeholder="ui entry (e.g. ui/index.html)"
                    value={wizardDraft.uiEntry}
                    oninput={(event) => updateWizardDraft('uiEntry', event.currentTarget.value)}
                  />
                {/if}
                <input
                  type="text"
                  placeholder="permissions (comma-separated)"
                  value={wizardDraft.permissions}
                  oninput={(event) => updateWizardDraft('permissions', event.currentTarget.value)}
                />
              </div>
              <div class="wizard-actions">
                <button class="btn ghost" onclick={runWizardPreflight} disabled={wizardLoadingPreflight || wizardCreating}>
                  {wizardLoadingPreflight ? 'Reviewing...' : 'Run Preflight'}
                </button>
                <button
                  class="btn primary"
                  onclick={createPackageFromWizard}
                  disabled={wizardCreating || wizardLoadingPreflight || !wizardReview || wizardReview.blocked}
                >
                  {wizardCreating ? 'Creating...' : 'Create Package'}
                </button>
              </div>
              {#if wizardReview}
                <div class="preflight-panel">
                  <div class="preflight-head">
                    <div class="preflight-title">
                      <strong>Wizard Preflight</strong>
                      <span class="preflight-decision {wizardReview.blocked ? 'blocked' : wizardReview.decision}">
                        {wizardReview.blocked ? 'BLOCKED' : String(wizardReview.decision || 'warn').toUpperCase()}
                      </span>
                    </div>
                    <div class="runtime-log-empty">{wizardReview.source}</div>
                  </div>
                  <div class="preflight-summary-inline">{wizardReview.summary}</div>
                  {#if wizardReview.blockers.length > 0}
                    <div class="preflight-list">
                      {#each wizardReview.blockers as blocker}
                        <div class="preflight-item">
                          <span class="preflight-item-status fail">FAIL</span>
                          <strong>{blocker.label}</strong>
                          {#if blocker.detail}
                            <span class="preflight-item-detail">{blocker.detail}</span>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if wizardReview.lifecycleSafeguards?.checks?.length > 0}
                    <div class="preflight-group">
                      <div class="preflight-label">Lifecycle Safeguards</div>
                      <div class="preflight-summary-inline">{wizardReview.lifecycleSafeguards.summary}</div>
                      <div class="preflight-list">
                        {#each wizardReview.lifecycleSafeguards.checks as item}
                          <div class="preflight-item">
                            <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                            <span>{item.label}</span>
                            {#if item.detail}
                              <span class="preflight-item-detail">{item.detail}</span>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  <div class="preflight-group">
                    <div class="preflight-label">Data Boundary</div>
                    <div class="preflight-summary-inline">
                      {wizardReview.localWorkspace?.status === 'inventory+local-workspace'
                        ? 'inventory-app-data + local workspace bridge'
                        : 'inventory-app-data only'}
                    </div>
                    {#if wizardReview.localWorkspace?.status === 'inventory+local-workspace'}
                      <div class="ops-meta-list">
                        <div>mode: {wizardReview.localWorkspace.mode || 'readwrite'}</div>
                        <div>path: {wizardReview.localWorkspace.path || '-'}</div>
                      </div>
                    {:else}
                      <div class="runtime-log-empty">No local workspace bridge requested.</div>
                    {/if}
                  </div>
                  {#if wizardReview.toolPackageReview?.applies}
                    <div class="preflight-group">
                      <div class="preflight-label">Tool Package</div>
                      <div class="preflight-summary-inline">{wizardReview.toolPackageReview.summary}</div>
                      <div class="ops-meta-list">
                        <div>runtime: {wizardReview.toolPackageReview.runtimeType || '-'}</div>
                        <div>service: {wizardReview.toolPackageReview.serviceEntry || '-'}</div>
                        <div>ui: {wizardReview.toolPackageReview.uiEntry || '-'}</div>
                      </div>
                      {#if wizardReview.toolPackageReview.checks.length > 0}
                        <div class="preflight-list">
                          {#each wizardReview.toolPackageReview.checks as item}
                            <div class="preflight-item">
                              <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                              <span>{item.label}</span>
                              {#if item.detail}
                                <span class="preflight-item-detail">{item.detail}</span>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                  {#if wizardReview.onboarding?.steps?.length > 0 || wizardReview.onboarding?.commands?.length > 0}
                    <div class="preflight-group">
                      <div class="preflight-label">Third-Party Onboarding</div>
                      <div class="preflight-summary-inline">{wizardReview.onboarding.summary}</div>
                      {#if wizardReview.onboarding.steps.length > 0}
                        <div class="preflight-list">
                          {#each wizardReview.onboarding.steps as step}
                            <div class="preflight-item">
                              <span class="preflight-item-status {step.status}">{String(step.status || 'info').toUpperCase()}</span>
                              <span>{step.label}</span>
                              {#if step.detail}
                                <span class="preflight-item-detail">{step.detail}</span>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                      {#if wizardReview.onboarding.commands.length > 0}
                        <div class="ops-meta-list">
                          {#each wizardReview.onboarding.commands as command}
                            <code>{command}</code>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if activeCategory === CATEGORY.STORE && packageUtilityPanel === 'sources'}
          <div class="package-utility-panel">
            <div class="package-utility-head">
              <h3>Package Sources</h3>
              <button class="btn icon" onclick={loadStorePackages} disabled={loadingStore} title="Reload sources" aria-label="Reload sources">
                <RefreshCw size={14} />
              </button>
            </div>

            <div class="source-form">
              <input type="text" bind:value={sourceForm.url} oninput={syncSourceId} placeholder="GitHub URL or raw JSON URL" />
              <input type="text" bind:value={sourceForm.title} oninput={syncSourceId} placeholder="Store title" />
              <input type="text" bind:value={sourceForm.id} placeholder="store-id" />
              <button class="btn primary" onclick={saveStoreSource} disabled={savingSource}>
                <Link2 size={14} />
                {savingSource ? 'Saving...' : 'Add Source'}
              </button>
            </div>

            <div class="source-hints">
              <div>GitHub repository URL automatically resolves to `.../main/webos-store.json`.</div>
              <div>GitHub blob URL is converted to raw content URL.</div>
              <div>Direct raw JSON URL is also supported.</div>
              {#if sourceForm.url.trim()}
                <div class="source-preview">
                  <span>Resolved URL</span>
                  <code>{normalizeRegistryUrl(sourceForm.url)}</code>
                </div>
              {/if}
            </div>

            <div class="quick-install-profile">
              <div class="quick-install-head">
                <strong>Quick Install Profile</strong>
                <span>Inventory remains canonical; local workspace bridge is optional.</span>
              </div>
              <label class="preflight-bypass">
                <input
                  type="checkbox"
                  checked={installWorkspaceDraft.enabled}
                  onchange={(event) => setInstallWorkspaceField('enabled', event.currentTarget.checked)}
                />
                Enable Local Workspace Bridge
              </label>
              <div class="quick-install-grid">
                <input
                  type="text"
                  value={installWorkspaceDraft.path}
                  oninput={(event) => setInstallWorkspaceField('path', event.currentTarget.value)}
                  placeholder="/absolute/path/in/allowed-roots"
                  disabled={!installWorkspaceDraft.enabled}
                />
                <select
                  value={installWorkspaceDraft.mode}
                  onchange={(event) => setInstallWorkspaceField('mode', event.currentTarget.value)}
                  disabled={!installWorkspaceDraft.enabled}
                >
                  <option value="readwrite">readwrite</option>
                  <option value="read">read</option>
                </select>
              </div>
            </div>

            {#if registrySources.length > 0}
              <div class="sources">
                {#each registrySources as source}
                  <div class="source-pill">
                    <span>{source.title} ({source.id})</span>
                    <button class="btn tiny" onclick={() => removeStoreSource(source.id)}>Remove</button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if activeCategory === CATEGORY.STORE && packageUtilityPanel === 'zip'}
          <div class="package-utility-panel">
            <div class="package-utility-head">
              <div>
                <h3>Import ZIP Package</h3>
                <div class="runtime-log-empty">Upload a package ZIP directly when no registry source is available.</div>
              </div>
            </div>

            <div class="zip-import-panel">
              <div class="zip-import-grid">
                {#key zipImportInputKey}
                  <input
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    onchange={onZipImportFileChange}
                    disabled={zipImportPreflighting || zipImporting}
                  />
                {/key}
                <label class="preflight-bypass">
                  <input
                    type="checkbox"
                    checked={zipImportOverwrite}
                    onchange={(event) => setZipImportOverwrite(event.currentTarget.checked)}
                    disabled={zipImportPreflighting || zipImporting}
                  />
                  Overwrite existing package if IDs match
                </label>
              </div>

              {#if zipImportFile}
                <div class="source-hints">
                  <div>Selected: {zipImportFile.name} ({formatFileSize(zipImportFile.size)})</div>
                  <div>{zipImportOverwrite ? 'Overwrite is enabled; backend should snapshot existing package data before replacement.' : 'Overwrite is off; matching installed package IDs should be rejected.'}</div>
                </div>
              {/if}

              <div class="wizard-actions">
                <button
                  class="btn ghost"
                  onclick={runZipImportPreflight}
                  disabled={!zipImportFile || zipImportPreflighting || zipImporting}
                >
                  {zipImportPreflighting ? 'Reviewing...' : 'Review Import'}
                </button>
                <button
                  class="btn primary"
                  onclick={executeZipImport}
                  disabled={
                    !zipImportFile ||
                    !zipImportReview ||
                    zipImportReview.blocked ||
                    zipImportPreflighting ||
                    zipImporting ||
                    zipImportLifecycleTypedInput.trim() !== getLifecycleTypedConfirmation(zipImportReview)
                  }
                >
                  <Upload size={14} />
                  {zipImporting ? 'Importing...' : 'Import ZIP'}
                </button>
              </div>

              {#if zipImportReview}
                <div class="preflight-panel">
                  <div class="preflight-head">
                    <div class="preflight-title">
                      <strong>ZIP Import Review</strong>
                      <span class="preflight-decision {zipImportReview.blocked ? 'blocked' : zipImportReview.decision}">
                        {getInstallReviewDecisionLabel(zipImportReview)}
                      </span>
                    </div>
                    <div class="runtime-log-empty">{zipImportReview.source === 'fallback' ? 'fallback review' : 'endpoint review'}</div>
                  </div>
                  {#if zipImportReview.loading}
                    <div class="runtime-log-empty">Loading import checks...</div>
                  {:else}
                    <div class="preflight-summary">{zipImportReview.summary || 'Review the selected ZIP before importing.'}</div>
                    {#if zipImportReview.blockedReason}
                      <div class="preflight-blocked-reason">{zipImportReview.blockedReason}</div>
                    {/if}
                    <label class="approval-field">
                      <span>Type {getLifecycleTypedConfirmation(zipImportReview)} to approve</span>
                      <input
                        bind:value={zipImportLifecycleTypedInput}
                        disabled={zipImporting}
                        autocomplete="off"
                      />
                    </label>
                    <div class="preflight-grid">
                      <div class="preflight-group">
                        <div class="preflight-label">Selected File</div>
                        <div class="ops-meta-list">
                          <div>name: {zipImportReview.fileName || zipImportFile?.name || '-'}</div>
                          <div>size: {formatFileSize(zipImportReview.fileSize || zipImportFile?.size)}</div>
                          <div>overwrite: {zipImportReview.overwrite ? 'true' : 'false'}</div>
                        </div>
                      </div>

                      <div class="preflight-group">
                        <div class="preflight-label">Permissions</div>
                        {#if zipImportReview.permissions.length === 0}
                          <div class="runtime-log-empty">No permission data from preflight.</div>
                        {:else}
                          <div class="preflight-list">
                            {#each zipImportReview.permissions as item}
                              <div class="preflight-item">
                                <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                <span>{item.label}</span>
                                {#if item.detail}
                                  <span class="preflight-item-detail">{item.detail}</span>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>

                      <div class="preflight-group">
                        <div class="preflight-label">Backup / Rollback</div>
                        <div class="preflight-summary-inline">{zipImportReview.backupSummary || (zipImportReview.overwrite ? 'Overwrite should create a backup snapshot.' : 'No backup required for first import.')}</div>
                        {#if zipImportReview.backupChecks.length > 0}
                          <div class="preflight-list">
                            {#each zipImportReview.backupChecks as item}
                              <div class="preflight-item">
                                <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                <span>{item.label}</span>
                                {#if item.detail}
                                  <span class="preflight-item-detail">{item.detail}</span>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>

                      <div class="preflight-group">
                        <div class="preflight-label">Data Boundary</div>
                        <div class="preflight-summary-inline">
                          {zipImportReview.localWorkspace?.status === 'inventory+local-workspace'
                            ? 'inventory-app-data + local workspace bridge'
                            : 'inventory-app-data only'}
                        </div>
                        {#if zipImportReview.localWorkspace?.status === 'inventory+local-workspace'}
                          <div class="ops-meta-list">
                            <div>mode: {zipImportReview.localWorkspace.mode || 'readwrite'}</div>
                            <div>path: {zipImportReview.localWorkspace.path || '-'}</div>
                          </div>
                        {:else}
                          <div class="runtime-log-empty">No local workspace bridge requested.</div>
                        {/if}
                      </div>

                      {#if zipImportReview.toolPackageReview?.applies}
                        <div class="preflight-group">
                          <div class="preflight-label">Tool Package</div>
                          <div class="preflight-summary-inline">{zipImportReview.toolPackageReview.summary}</div>
                          <div class="ops-meta-list">
                            <div>runtime: {zipImportReview.toolPackageReview.runtimeType || '-'}</div>
                            <div>service: {zipImportReview.toolPackageReview.serviceEntry || '-'}</div>
                            <div>ui: {zipImportReview.toolPackageReview.uiEntry || '-'}</div>
                          </div>
                          {#if zipImportReview.toolPackageReview.checks.length > 0}
                            <div class="preflight-list">
                              {#each zipImportReview.toolPackageReview.checks as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/if}

                      <div class="preflight-group">
                        <div class="preflight-label">Lifecycle Safeguards</div>
                        <div class="preflight-summary-inline">{zipImportReview.lifecycleSafeguards?.summary || 'No lifecycle safeguards from preflight.'}</div>
                        {#if zipImportReview.lifecycleSafeguards?.checks?.length > 0}
                          <div class="preflight-list">
                            {#each zipImportReview.lifecycleSafeguards.checks as item}
                              <div class="preflight-item">
                                <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                <span>{item.label}</span>
                                {#if item.detail}
                                  <span class="preflight-item-detail">{item.detail}</span>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <div class="runtime-log-empty">Import will rely on backend validation and audit logging.</div>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/if}

        {#if activeCategory === CATEGORY.STORE && registrySources.length > 0}
          <div class="compact-source-filter">
            <button class="source-row {activeStoreSource === 'all' ? 'active' : ''}" onclick={() => { activeStoreSource = 'all'; selectedPackageKey = ''; }}>
              <span>All Sources</span>
              <small>{storePackages.length}</small>
            </button>
            {#each registrySources as source}
              <button class="source-row {activeStoreSource === source.id ? 'active' : ''}" onclick={() => { activeStoreSource = source.id; selectedPackageKey = ''; }}>
                <span>{source.title}</span>
                <small>{storePackages.filter((pkg) => pkg.source?.id === source.id).length}</small>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="package-list">
        {#if activeCategory === CATEGORY.STORE && loadingStore}
          <div class="empty compact">Loading store packages...</div>
        {:else if activeCategory === CATEGORY.INSTALLED && loadingInstalled}
          <div class="empty compact">Loading installed packages...</div>
        {:else if getFilteredActivePackageList().length === 0}
          <div class="empty compact">No packages match this view.</div>
        {:else}
          {#each getFilteredActivePackageList() as pkg (getPackageKey(pkg))}
            <button class="package-list-item {getPackageKey(pkg) === getPackageKey(getSelectedPackage()) ? 'active' : ''}" onclick={() => selectPackage(pkg)}>
              <div class="list-icon">
                {#if hasImageIcon(pkg)}
                  <img class="icon-image" src={getIconUrl(pkg)} alt={pkg.title} loading="lazy" />
                {:else}
                  <Layers size={16} />
                {/if}
              </div>
              <div class="list-copy">
                <strong>{pkg.title || pkg.id}</strong>
                <span>{pkg.id}</span>
              </div>
              <div class="list-meta">
                <span>{getPackageKindLabel(pkg)}</span>
                {#if activeCategory === CATEGORY.INSTALLED && isServicePackage(pkg)}
                  <small class="{getRuntimeState(pkg)?.status || 'stopped'}">{getRuntimeStatusLabel(pkg)}</small>
                {:else}
                  <small>v{pkg.version || '-'}</small>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </section>
  </aside>

  <section class="content">
    {#if message}
      <div class="feedback info glass-effect">{message}</div>
    {/if}
    {#if error}
      <div class="feedback error glass-effect" role="alert" aria-live="polite">
        <div class="feedback-copy">
          {#if lastFailure?.operation}
            <strong>{lastFailure.operation}</strong>
          {/if}
          <span>{error}</span>
        </div>
        {#if typeof lastFailure?.retry === 'function'}
          <button class="btn ghost feedback-retry" onclick={retryLastFailure}>
            <RefreshCw size={14} />
            Retry
          </button>
        {/if}
      </div>
    {/if}

    {#if activeCategory === CATEGORY.STORE && getSelectedPackage()}
      {@const selectedPackage = getSelectedPackage()}
      {@const selectedDependencies = getPackageDependencies(selectedPackage)}
      <div class="selected-package-detail glass-effect store-selected-detail">
        <div class="installed-app-summary">
          <div class="installed-app-icon">
            <div class="icon-box">
              {#if hasImageIcon(selectedPackage)}
                <img class="icon-image" src={getIconUrl(selectedPackage)} alt={selectedPackage.title} loading="lazy" />
              {:else}
                <LayoutGrid size={18} />
              {/if}
            </div>
          </div>
          <div class="installed-app-main">
            <div class="installed-app-title-row">
              <div>
                <h3>{selectedPackage.title || selectedPackage.id}</h3>
                <span>{selectedPackage.id}</span>
              </div>
              <div class="installed-primary-actions">
                {#if selectedPackage.installed}
                  {#if selectedPackage.updatePolicy?.allowed}
                    <button class="btn primary" onclick={() => quickInstallPackage(selectedPackage, { overwrite: true })} disabled={installingPackageId === selectedPackage.id || installReview?.loading}>
                      <Download size={14} />
                      {installingPackageId === selectedPackage.id ? 'Updating...' : 'Quick Update'}
                    </button>
                    <button class="btn ghost" onclick={() => openInstallReview(selectedPackage, { overwrite: true })} disabled={installingPackageId === selectedPackage.id || installReview?.loading}>
                      Review
                    </button>
                  {:else}
                    <button class="btn ghost" disabled>Installed</button>
                  {/if}
                {:else if !selectedPackage.zipUrl}
                  <button class="btn ghost" disabled>No Zip</button>
                {:else}
                  <button class="btn primary" onclick={() => quickInstallPackage(selectedPackage)} disabled={installingPackageId === selectedPackage.id || installReview?.loading}>
                    <Download size={14} />
                    {installingPackageId === selectedPackage.id ? 'Installing...' : 'Quick Install'}
                  </button>
                  <button class="btn ghost" onclick={() => openInstallReview(selectedPackage)} disabled={installingPackageId === selectedPackage.id || installReview?.loading}>
                    Review
                  </button>
                {/if}
              </div>
            </div>
            <div class="installed-status-line">
              <span>{selectedPackage.installed ? 'Installed' : 'Available'}</span>
              <span>{getPackageKindLabel(selectedPackage)}</span>
            </div>
          </div>
        </div>
        <div class="installed-detail-layout">
          <section class="installed-spec-panel installed-description-panel">
            <div class="installed-spec-title">Description</div>
            <p>{selectedPackage.description || 'No description provided.'}</p>
          </section>
          <section class="installed-spec-panel">
            <div class="installed-spec-title">Information</div>
            <div class="installed-spec-list">
              <div>
                <span>Identifier</span>
                <strong>{selectedPackage.id}</strong>
              </div>
              <div>
                <span>Type</span>
                <strong>{selectedPackage.appType || selectedPackage.type || 'app'}</strong>
              </div>
              <div>
                <span>Runtime</span>
                <strong>{selectedPackage.runtime || selectedPackage.runtimeProfile?.runtimeType || '-'}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{getPackageSourceLabel(selectedPackage)}</strong>
              </div>
            </div>
          </section>
          <section class="installed-spec-panel">
            <div class="installed-spec-title">Version</div>
            <div class="installed-spec-list">
              <div>
                <span>Version</span>
                <strong>{selectedPackage.version || '-'}</strong>
              </div>
              <div>
                <span>Channel</span>
                <strong>{selectedPackage.channel || selectedPackage.releaseChannel || 'stable'}</strong>
              </div>
              <div>
                <span>Store ID</span>
                <strong>{selectedPackage.source?.id || 'store'}</strong>
              </div>
              <div>
                <span>Zip</span>
                <strong>{selectedPackage.zipUrl ? 'Ready' : 'Unavailable'}</strong>
              </div>
            </div>
          </section>
          <section class="installed-spec-panel">
            <div class="installed-spec-title">Status</div>
            <div class="installed-spec-list">
              <div>
                <span>Install State</span>
                <strong>{selectedPackage.installed ? 'Installed' : 'Available'}</strong>
              </div>
              <div>
                <span>Update</span>
                <strong>{selectedPackage.installed ? (selectedPackage.updatePolicy?.allowed ? 'Available' : 'Blocked') : '-'}</strong>
              </div>
              <div>
                <span>Policy</span>
                <strong>{selectedPackage.updatePolicy?.blockedReason || '-'}</strong>
              </div>
              <div>
                <span>Boundary</span>
                <strong>{getWorkspaceBoundaryLabel(selectedPackage)}</strong>
              </div>
            </div>
          </section>
          <section class="installed-spec-panel">
            <div class="installed-spec-title">Dependencies</div>
            {#if selectedDependencies.length > 0}
              <div class="installed-dependency-list">
                {#each selectedDependencies as dependency}
                  <span>{dependency}</span>
                {/each}
              </div>
            {:else}
              <div class="runtime-log-empty">No dependencies declared.</div>
            {/if}
          </section>
        </div>
      </div>
    {/if}

    {#if activeCategory === CATEGORY.STORE}
        {#if storeSourceErrors.length > 0}
          <div class="source-errors">
            {#each storeSourceErrors as sourceError}
              <div class="source-error">
                <strong>{sourceError.title}</strong>
                <span>{sourceError.error}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if loadingStore}
          <div class="empty">Loading store packages...</div>
        {:else if getVisibleStorePackages().length === 0}
          <div class="empty">No packages found for the selected source.</div>
        {:else if getFilteredActivePackageList().length === 0}
          <div class="empty">No packages match the current search.</div>
        {:else if installReview && getSelectedPackage() && installReview.packageId === getSelectedPackage().id}
          <div class="grid selected-package-management">
            {#each getSelectedPackageRows() as pkg}
              <article class="card selected-management-card">
                <div class="card-head">
                  <div class="icon-box">
                    {#if hasImageIcon(pkg)}
                      <img class="icon-image" src={getIconUrl(pkg)} alt={pkg.title} loading="lazy" />
                    {:else}
                      <LayoutGrid size={18} />
                    {/if}
                  </div>
                  <div class="meta">
                    <h4>{pkg.title}</h4>
                    <p>{pkg.description || 'No description'}</p>
                  </div>
                </div>
                <div class="chips">
                  <span>v{pkg.version}</span>
                  <span>{pkg.source?.id}</span>
                </div>
                <div class="actions">
                  {#if pkg.installed}
                    {#if pkg.updatePolicy?.allowed}
                      <button class="btn primary" onclick={() => quickInstallPackage(pkg, { overwrite: true })} disabled={installingPackageId === pkg.id || installReview?.loading}>
                        <Download size={14} />
                        {installingPackageId === pkg.id ? 'Updating...' : 'Quick Update'}
                      </button>
                      <button class="btn ghost" onclick={() => openInstallReview(pkg, { overwrite: true })} disabled={installingPackageId === pkg.id || installReview?.loading}>
                        Review
                      </button>
                    {:else}
                      <button class="btn ghost" disabled>Installed</button>
                    {/if}
                  {:else if !pkg.zipUrl}
                    <button class="btn ghost" disabled>No Zip</button>
                  {:else}
                    <button class="btn primary" onclick={() => quickInstallPackage(pkg)} disabled={installingPackageId === pkg.id || installReview?.loading}>
                      <Download size={14} />
                      {installingPackageId === pkg.id ? 'Installing...' : 'Quick Install'}
                    </button>
                    <button class="btn ghost" onclick={() => openInstallReview(pkg)} disabled={installingPackageId === pkg.id || installReview?.loading}>
                      Review
                    </button>
                  {/if}
                </div>
                {#if installReview && installReview.packageId === pkg.id}
                  <div class="preflight-panel">
                    <div class="preflight-head">
                      <div class="preflight-title">
                        <strong>{installReview.overwrite ? 'Update Preflight Review' : 'Install Preflight Review'}</strong>
                        <span class="preflight-decision {installReview.blocked ? 'blocked' : installReview.decision}">
                          {getInstallReviewDecisionLabel(installReview)}
                        </span>
                      </div>
                      <div class="runtime-log-empty">{installReview.source === 'fallback' ? 'fallback review' : 'endpoint review'}</div>
                    </div>
                    {#if installReview.loading}
                      <div class="runtime-log-empty">Loading preflight checks...</div>
                    {:else}
                      <div class="preflight-summary">{installReview.summary || 'Preflight checks are ready for review.'}</div>
                      {#if installReview.blockedReason}
                        <div class="preflight-blocked-reason">{installReview.blockedReason}</div>
                      {/if}

                      <div class="preflight-grid">
                        <div class="preflight-group">
                          <div class="preflight-label">Permissions</div>
                          {#if installReview.permissions.length === 0}
                            <div class="runtime-log-empty">No permission data.</div>
                          {:else}
                            <div class="preflight-list">
                              {#each installReview.permissions as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>

                        <div class="preflight-group">
                          <div class="preflight-label">Quality Gate</div>
                          <div class="preflight-summary-inline">{installReview.qualitySummary || 'No quality summary.'}</div>
                          {#if installReview.qualityChecks.length === 0}
                            <div class="runtime-log-empty">No quality checks.</div>
                          {:else}
                            <div class="preflight-list">
                              {#each installReview.qualityChecks as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>

                        <div class="preflight-group">
                          <div class="preflight-label">Dependency / Compatibility</div>
                          {#if installReview.dependencyChecks.length === 0 && installReview.compatibilityChecks.length === 0 && (!installReview.blockerItems || installReview.blockerItems.length === 0)}
                            <div class="runtime-log-empty">No dependency or compatibility checks.</div>
                          {:else}
                            <div class="preflight-list">
                              {#each installReview.blockerItems || [] as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                              {#each [...installReview.dependencyChecks, ...installReview.compatibilityChecks] as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>

                        <div class="preflight-group">
                          <div class="preflight-label">Backup Plan</div>
                          <div class="preflight-summary-inline">{installReview.backupSummary || 'No backup plan details.'}</div>
                          {#if installReview.backupChecks.length === 0}
                            <div class="runtime-log-empty">No backup checks.</div>
                          {:else}
                            <div class="preflight-list">
                              {#each installReview.backupChecks as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {/if}
                        </div>

                        <div class="preflight-group">
                          <div class="preflight-label">Data Boundary</div>
                          <div class="preflight-summary-inline">
                            {installReview.localWorkspace?.status === 'inventory+local-workspace'
                              ? 'inventory-app-data + local workspace bridge'
                              : 'inventory-app-data only'}
                          </div>
                          {#if installReview.localWorkspace?.status === 'inventory+local-workspace'}
                            <div class="ops-meta-list">
                              <div>mode: {installReview.localWorkspace.mode || 'readwrite'}</div>
                              <div>path: {installReview.localWorkspace.path || '-'}</div>
                            </div>
                          {:else}
                            <div class="runtime-log-empty">No local workspace bridge requested.</div>
                          {/if}
                        </div>

                        {#if installReview.toolPackageReview?.applies}
                          <div class="preflight-group">
                            <div class="preflight-label">Tool Package</div>
                            <div class="preflight-summary-inline">{installReview.toolPackageReview.summary}</div>
                            <div class="ops-meta-list">
                              <div>runtime: {installReview.toolPackageReview.runtimeType || '-'}</div>
                              <div>service: {installReview.toolPackageReview.serviceEntry || '-'}</div>
                              <div>ui: {installReview.toolPackageReview.uiEntry || '-'}</div>
                            </div>
                            {#if installReview.toolPackageReview.checks.length > 0}
                              <div class="preflight-list">
                                {#each installReview.toolPackageReview.checks as item}
                                  <div class="preflight-item">
                                    <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                    <span>{item.label}</span>
                                    {#if item.detail}
                                      <span class="preflight-item-detail">{item.detail}</span>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        {/if}

                        <div class="preflight-group">
                          <div class="preflight-label">Lifecycle Safeguards</div>
                          <div class="preflight-summary-inline">{installReview.lifecycleSafeguards?.summary || 'No lifecycle safeguards.'}</div>
                          {#if installReview.lifecycleSafeguards?.checks?.length > 0}
                            <div class="preflight-list">
                              {#each installReview.lifecycleSafeguards.checks as item}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {item.status}">{String(item.status || 'info').toUpperCase()}</span>
                                  <span>{item.label}</span>
                                  {#if item.detail}
                                    <span class="preflight-item-detail">{item.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {:else}
                            <div class="runtime-log-empty">No lifecycle safeguard checks.</div>
                          {/if}
                        </div>

                        <div class="preflight-group">
                          <div class="preflight-label">Third-Party Onboarding</div>
                          <div class="preflight-summary-inline">{installReview.onboarding?.summary || 'No onboarding guide.'}</div>
                          {#if installReview.onboarding?.steps?.length > 0}
                            <div class="preflight-list">
                              {#each installReview.onboarding.steps as step}
                                <div class="preflight-item">
                                  <span class="preflight-item-status {step.status}">{String(step.status || 'info').toUpperCase()}</span>
                                  <span>{step.label}</span>
                                  {#if step.detail}
                                    <span class="preflight-item-detail">{step.detail}</span>
                                  {/if}
                                </div>
                              {/each}
                            </div>
                          {:else}
                            <div class="runtime-log-empty">No onboarding steps.</div>
                          {/if}
                          {#if installReview.onboarding?.commands?.length > 0}
                            <div class="ops-meta-list">
                              {#each installReview.onboarding.commands as command}
                                <code>{command}</code>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </div>

                      <div class="preflight-actions">
                        {#if installReview.blocked}
                          {#if canBypassInstallReviewPolicy(installReview)}
                            <label class="preflight-bypass">
                              <input
                                type="checkbox"
                                checked={installReview.forcePolicyBypass}
                                onchange={(event) => setInstallReviewBypass(event.currentTarget.checked)}
                              />
                              Force policy bypass on execution
                            </label>
                          {:else}
                            <div class="runtime-log-empty">Policy bypass is unavailable for current blockers.</div>
                          {/if}
                        {/if}
                        <label class="approval-field">
                          <span>Type {getLifecycleTypedConfirmation(installReview)} to approve</span>
                          <input
                            bind:value={installLifecycleTypedInput}
                            disabled={installingPackageId === pkg.id}
                            autocomplete="off"
                          />
                        </label>
                        <div class="preflight-buttons">
                          <button class="btn ghost" onclick={closeInstallReview} disabled={installingPackageId === pkg.id}>Cancel</button>
                          <button
                            class="btn primary"
                            onclick={executeInstallFromReview}
                            disabled={
                              installingPackageId === pkg.id ||
                              (
                                installReview.blocked &&
                                (
                                  !canBypassInstallReviewPolicy(installReview) ||
                                  !installReview.forcePolicyBypass
                                )
                              ) ||
                              installLifecycleTypedInput.trim() !== getLifecycleTypedConfirmation(installReview)
                            }
                          >
                            {installingPackageId === pkg.id
                              ? (installReview.overwrite ? 'Updating...' : 'Installing...')
                              : (installReview.overwrite ? 'Approve & Update' : 'Approve & Install')}
                          </button>
                        </div>
                      </div>
                    {/if}
                  </div>
                {/if}
                {#if pkg.installed && pkg.updatePolicy && !pkg.updatePolicy.allowed}
                  <div class="runtime-log-empty">
                    update blocked: {pkg.updatePolicy.blockedReason || 'policy'}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
    {/if}

    {#if activeCategory === CATEGORY.INSTALLED}
      <div class="block glass-effect installed-management">
        {#if loadingInstalled}
          <div class="empty">Loading installed packages...</div>
        {:else if installedPackages.length === 0}
          <div class="empty">No installed packages.</div>
        {:else if getFilteredActivePackageList().length === 0}
          <div class="empty">No installed packages match the current search.</div>
        {:else}
          <div class="grid selected-package-management">
            {#each getSelectedPackageRows() as pkg}
              {@const packageWidgets = getPackageWidgets(pkg)}
              {@const dependencyItems = getPackageDependencies(pkg)}
              <article class="card selected-management-card">
                <div class="installed-app-summary">
                  <div class="installed-app-icon">
                    <div class="icon-box">
                      {#if hasImageIcon(pkg)}
                        <img class="icon-image" src={getIconUrl(pkg)} alt={pkg.title} loading="lazy" />
                      {:else}
                        <LayoutGrid size={18} />
                      {/if}
                    </div>
                  </div>
                  <div class="installed-app-main">
                    <div class="installed-app-title-row">
                      <div>
                        <h3>{pkg.title || pkg.id}</h3>
                        <span>{pkg.id}</span>
                      </div>
                      <div class="installed-primary-actions">
                        {#if canOpenPackage(pkg)}
                          <button class="btn primary" onclick={() => openInstalledPackage(pkg)}>
                            <Play size={14} />
                            Open
                          </button>
                        {/if}
                        {#if isServicePackage(pkg)}
                          <button class="btn ghost" onclick={() => controlRuntime(pkg, 'start')} disabled={runtimeActioning === `${pkg.id}:start` || isRuntimeRunning(pkg)}>
                            <Play size={14} />
                            Start
                          </button>
                          <button class="btn ghost" onclick={() => controlRuntime(pkg, 'stop')} disabled={runtimeActioning === `${pkg.id}:stop` || !isRuntimeRunning(pkg)}>
                            <Square size={14} />
                            Stop
                          </button>
                        {/if}
                        <button
                          class="btn ghost"
                          onclick={() => Promise.all([loadInstalledPackages(), loadRuntimeStatuses()])}
                          disabled={loadingInstalled}
                        >
                          <RefreshCw size={14} />
                          Refresh
                        </button>
                      </div>
                    </div>
                    <div class="installed-status-line">
                      <span>{isServicePackage(pkg) ? getRuntimeStatusLabel(pkg) : 'Installed'}</span>
                      <span>{getPackageKindLabel(pkg)}</span>
                    </div>
                  </div>
                </div>
                <div class="installed-detail-layout">
                  <section class="installed-spec-panel installed-description-panel">
                    <div class="installed-spec-title">Description</div>
                    <p>{pkg.description || 'No description provided.'}</p>
                  </section>
                  <section class="installed-spec-panel">
                    <div class="installed-spec-title">Information</div>
                    <div class="installed-spec-list">
                      <div>
                        <span>Identifier</span>
                        <strong>{pkg.id}</strong>
                      </div>
                      <div>
                        <span>Type</span>
                        <strong>{pkg.appType || pkg.type || 'app'}</strong>
                      </div>
                      <div>
                        <span>Runtime</span>
                        <strong>{pkg.runtime || pkg.runtimeProfile?.runtimeType || '-'}</strong>
                      </div>
                      <div>
                        <span>Boundary</span>
                        <strong>{getWorkspaceBoundaryLabel(pkg)}</strong>
                      </div>
                    </div>
                  </section>
                  <section class="installed-spec-panel">
                    <div class="installed-spec-title">Version</div>
                    <div class="installed-spec-list">
                      <div>
                        <span>Version</span>
                        <strong>{pkg.version || '-'}</strong>
                      </div>
                      <div>
                        <span>Channel</span>
                        <strong>{getLifecycleCurrentChannel(pkg)}</strong>
                      </div>
                      <div>
                        <span>Installed</span>
                        <strong>{formatDateTime(getLifecycle(pkg)?.current?.installedAt)}</strong>
                      </div>
                      <div>
                        <span>Source</span>
                        <strong>{getLifecycle(pkg)?.current?.source || pkg.source?.id || '-'}</strong>
                      </div>
                    </div>
                  </section>
                  <section class="installed-spec-panel">
                    <div class="installed-spec-title">Status</div>
                    <div class="installed-spec-list">
                      <div>
                        <span>Runtime</span>
                        <strong>{isServicePackage(pkg) ? getRuntimeStatusLabel(pkg) : 'Installed'}</strong>
                      </div>
                      <div class="installed-health-field">
                        <span>Health</span>
                        <strong class="health {getHealthStatus(pkg)}">{getHealthStatusText(pkg)}</strong>
                        <button class="btn tiny ghost" onclick={() => runHealthCheck(pkg)} disabled={healthLoading === pkg.id}>
                          {healthLoading === pkg.id ? 'Checking...' : 'Run Check'}
                        </button>
                      </div>
                      <div>
                        <span>Last Check</span>
                        <strong>{formatDateTime(getHealthReport(pkg)?.checkedAt)}</strong>
                      </div>
                      <div>
                        <span>Summary</span>
                        <strong>{getHealthReport(pkg)?.summary || '-'}</strong>
                      </div>
                    </div>
                  </section>
                  <section class="installed-spec-panel">
                    <div class="installed-spec-title">Dependencies</div>
                    {#if dependencyItems.length > 0}
                      <div class="installed-dependency-list">
                        {#each dependencyItems as dependency}
                          <span>{dependency}</span>
                        {/each}
                      </div>
                    {:else}
                      <div class="runtime-log-empty">No dependencies declared.</div>
                    {/if}
                  </section>
                  {#if (pkg.appType || pkg.type) === 'hybrid'}
                    <section class="installed-spec-panel">
                      <div class="installed-spec-title">Entrypoints</div>
                      <div class="installed-spec-list">
                        <div>
                          <span>UI</span>
                          <strong>{pkg.ui?.entry || pkg.runtimeProfile?.ui?.entry || pkg.entry || '-'}</strong>
                        </div>
                        <div>
                          <span>Service</span>
                          <strong>{pkg.service?.entry || pkg.runtimeProfile?.entry || '-'}</strong>
                        </div>
                      </div>
                    </section>
                  {/if}
                  {#if packageWidgets.length > 0}
                    <section class="installed-spec-panel">
                      <div class="installed-spec-title">Widgets</div>
                      <strong>{packageWidgets.length}</strong>
                    </section>
                  {/if}
                </div>
                {#if packageWidgets.length > 0}
                  <div class="package-widgets">
                    {#each packageWidgets as contribution}
                      <div class="package-widget-row">
                        <div>
                          <strong>{contribution.title || contribution.label}</strong>
                          <span>{contribution.entry}</span>
                        </div>
                        <button class="btn ghost" onclick={() => addPackageWidget(pkg, contribution)}>
                          <Plus size={14} />
                          Add Widget
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
                <div class="actions installed-management-actions">
                  {#if canOpenPackage(pkg)}
                    <button class="btn ghost" onclick={() => stopInstalledPackage(pkg)}>
                      <Square size={14} />
                      Close Windows
                    </button>
                  {/if}
                  {#if isServicePackage(pkg)}
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'restart')} disabled={runtimeActioning === `${pkg.id}:restart`}>
                      <RotateCcw size={14} />
                      Restart
                    </button>
                    <button class="btn ghost" onclick={() => toggleRuntimeLogs(pkg)} disabled={runtimeLogsLoading === pkg.id}>
                      {runtimeLogsByApp[pkg.id] ? 'Hide Logs' : (runtimeLogsLoading === pkg.id ? 'Loading Logs...' : 'Logs')}
                    </button>
                  {/if}
                  <button class="btn ghost" onclick={() => toggleOpsConsole(pkg)} disabled={lifecycleLoading === pkg.id || runtimeEventsLoading === pkg.id}>
                    {isConsoleOpen(pkg) ? 'Ops Close' : 'Ops Console'}
                  </button>
                  <button class="btn ghost" onclick={() => openCloneDialog(pkg)}>
                    Clone
                  </button>
                  <button class="btn ghost" onclick={() => downloadInstalledPackage(pkg)}>
                    <Download size={14} />
                    Export
                  </button>
                  <button class="btn danger" onclick={() => openPackageDeleteReview(pkg)} disabled={isPackageDeleteBusy(pkg.id)}>
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
                {#if isConsoleOpen(pkg)}
                  <div class="ops-console">
                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Release Channel</div>
                        <div class="ops-inline">
                          {#each ['stable', 'beta', 'alpha', 'canary'] as channel}
                            <button
                              class="btn tiny {getLifecycleCurrentChannel(pkg) === channel ? 'primary' : 'ghost'}"
                              onclick={() => setReleaseChannel(pkg, channel)}
                              disabled={Boolean(lifecycleActioning)}
                            >
                              {channel}
                            </button>
                          {/each}
                        </div>
                      </div>
                      <div class="ops-group">
                        <div class="ops-label">Recover Flow</div>
                        <div class="ops-inline">
                          <button class="btn tiny ghost" onclick={() => recoverRuntime(pkg)} disabled={lifecycleActioning === `${pkg.id}:recover`}>
                            {lifecycleActioning === `${pkg.id}:recover` ? 'Recovering...' : 'Recover'}
                          </button>
                          <button class="btn tiny ghost" onclick={() => loadRuntimeEvents(pkg.id)} disabled={runtimeEventsLoading === pkg.id}>
                            {runtimeEventsLoading === pkg.id ? 'Loading events...' : 'Reload events'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Create Backup</div>
                        <div class="ops-inline">
                          <input
                            type="text"
                            placeholder="backup note"
                            value={getBackupNote(pkg.id)}
                            oninput={(event) => setBackupNote(pkg.id, event.currentTarget.value)}
                          />
                          <button class="btn tiny ghost" onclick={() => createLifecycleBackup(pkg)} disabled={lifecycleActioning === `${pkg.id}:backup`}>
                            {lifecycleActioning === `${pkg.id}:backup` ? 'Backing up...' : 'Backup'}
                          </button>
                          <button class="btn tiny ghost" onclick={() => createBackupJob(pkg)} disabled={lifecycleActioning === `${pkg.id}:backup-job:create`}>
                            {lifecycleActioning === `${pkg.id}:backup-job:create` ? 'Queueing...' : 'Queue Job'}
                          </button>
                          <button class="btn tiny ghost" onclick={() => loadBackupJobs(pkg.id)} disabled={isBackupJobsLoading(pkg.id)}>
                            {isBackupJobsLoading(pkg.id) ? 'Loading jobs...' : 'Reload Jobs'}
                          </button>
                        </div>
                        {#if getBackupJobs(pkg.id).length === 0}
                          <div class="runtime-log-empty">No backup jobs.</div>
                        {:else}
                          <div class="backup-jobs-list">
                            {#each getBackupJobs(pkg.id) as job (job.id)}
                              <div class="backup-job-row">
                                <div class="backup-job-head">
                                  <span class="job-id">{job.id}</span>
                                  <span class="status {getBackupJobStatusClass(job.status)}">{job.status || 'unknown'}</span>
                                </div>
                                <div class="backup-job-meta">
                                  <span>created {formatDateTime(job.createdAt)}</span>
                                  <span>started {formatDateTime(job.startedAt)}</span>
                                  <span>finished {formatDateTime(job.finishedAt)}</span>
                                  <span>backup {job.backupId || '-'}</span>
                                </div>
                                {#if job.note}
                                  <div class="backup-job-note">{job.note}</div>
                                {/if}
                                {#if job.error?.message}
                                  <div class="runtime-event error">{job.error.message}</div>
                                {/if}
                                {#if isBackupJobCancelable(job)}
                                  <div class="ops-inline">
                                    <button
                                      class="btn tiny danger"
                                      onclick={() => cancelBackupJob(pkg, job)}
                                      disabled={isBackupJobActioning(pkg.id, job.id, 'cancel')}
                                    >
                                      {isBackupJobActioning(pkg.id, job.id, 'cancel') ? 'Canceling...' : 'Cancel Job'}
                                    </button>
                                  </div>
                                {/if}
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Backup Retention</div>
                        <div class="ops-inline">
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={getBackupPolicyDraft(pkg.id, pkg).maxBackups}
                            oninput={(event) => setBackupPolicyDraftField(pkg.id, 'maxBackups', event.currentTarget.value)}
                          />
                          <button class="btn tiny ghost" onclick={() => saveBackupPolicy(pkg)} disabled={lifecycleActioning === `${pkg.id}:backup-policy`}>
                            {lifecycleActioning === `${pkg.id}:backup-policy` ? 'Saving...' : 'Save Policy'}
                          </button>
                          <span class="runtime-event">
                            current max: {getBackupPolicyMax(pkg)}
                          </span>
                        </div>
                      </div>
                      <div class="ops-group">
                        <div class="ops-label">Backup Schedule</div>
                        <div class="ops-inline">
                          <label class="preflight-bypass">
                            <input
                              type="checkbox"
                              checked={getBackupPolicyDraft(pkg.id, pkg).enabled === 'true'}
                              disabled={getBackupPolicyDraft(pkg.id, pkg).interval === 'manual'}
                              onchange={(event) => setBackupPolicyDraftField(pkg.id, 'enabled', event.currentTarget.checked ? 'true' : 'false')}
                            />
                            <span>Enable</span>
                          </label>
                          <select
                            value={getBackupPolicyDraft(pkg.id, pkg).interval}
                            onchange={(event) => {
                              const value = String(event.currentTarget.value || 'manual').trim().toLowerCase();
                              setBackupPolicyDraftField(pkg.id, 'interval', BACKUP_SCHEDULE_OPTIONS.includes(value) ? value : 'manual');
                              if (value === 'manual') {
                                setBackupPolicyDraftField(pkg.id, 'enabled', 'false');
                              }
                            }}
                          >
                            {#each BACKUP_SCHEDULE_OPTIONS as option}
                              <option value={option}>{option}</option>
                            {/each}
                          </select>
                          <input
                            type="time"
                            value={getBackupPolicyDraft(pkg.id, pkg).timeOfDay}
                            oninput={(event) => setBackupPolicyDraftField(pkg.id, 'timeOfDay', event.currentTarget.value)}
                          />
                          <span class="runtime-event">
                            current interval: {getBackupPolicySchedule(pkg).interval}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Rollback</div>
                        <div class="ops-inline">
                          <select
                            onchange={(event) => setSelectedBackup(pkg.id, event.currentTarget.value)}
                            value={selectedBackupByApp[pkg.id] || ''}
                          >
                            <option value="">select backup</option>
                            {#each getAvailableBackups(pkg) as backup}
                              <option value={backup.id}>
                                {backup.id} | {backup.version} | {formatDateTime(backup.createdAt)}
                              </option>
                            {/each}
                          </select>
                          <button class="btn tiny danger" onclick={() => openRollbackReview(pkg)} disabled={lifecycleActioning === `${pkg.id}:rollback` || rollbackReview?.loading}>
                            {lifecycleActioning === `${pkg.id}:rollback` ? 'Reviewing...' : 'Rollback'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Manifest Editor</div>
                        <div class="ops-inline">
                          <button class="btn tiny ghost" onclick={() => toggleManifestEditor(pkg)}>
                            {isManifestEditorOpen(pkg.id) ? 'Close Editor' : 'Open Editor'}
                          </button>
                          {#if isManifestEditorOpen(pkg.id)}
                            <button
                              class="btn tiny ghost"
                              onclick={() => openManifestEditor(pkg)}
                              disabled={Boolean(getManifestEditorState(pkg.id)?.loading) || Boolean(getManifestEditorState(pkg.id)?.saving)}
                            >
                              {getManifestEditorState(pkg.id)?.loading ? 'Loading...' : 'Reload'}
                            </button>
                          {/if}
                        </div>
                        {#if isManifestEditorOpen(pkg.id)}
                          <div class="manifest-editor-panel">
                            {#if getManifestEditorState(pkg.id)?.loading}
                              <div class="runtime-log-empty">Loading manifest...</div>
                            {:else if getManifestEditorState(pkg.id)?.loadError}
                              <div class="preflight-blocked-reason">{getManifestEditorState(pkg.id)?.loadError}</div>
                            {:else}
                              <textarea
                                class="manifest-editor-textarea"
                                value={getManifestEditorState(pkg.id)?.text || ''}
                                oninput={(event) => onManifestEditorInput(pkg, event.currentTarget.value)}
                                spellcheck="false"
                              ></textarea>
                              {#if getManifestEditorState(pkg.id)?.parseError}
                                <div class="manifest-parse-error">{getManifestEditorState(pkg.id)?.parseError}</div>
                              {/if}
                              {#if getManifestEditorState(pkg.id)?.preflight}
                                <div class="manifest-preflight-head">
                                  <span class="preflight-decision {getManifestEditorState(pkg.id)?.preflight?.blocked ? 'blocked' : getManifestEditorState(pkg.id)?.preflight?.decision}">
                                    {getManifestEditorState(pkg.id)?.preflight?.blocked ? 'BLOCKED' : getInstallReviewDecisionLabel(getManifestEditorState(pkg.id)?.preflight)}
                                  </span>
                                  <span class="preflight-summary-inline">{getManifestEditorState(pkg.id)?.preflight?.summary}</span>
                                </div>
                                {#if getManifestMediaScopeReview(getManifestEditorState(pkg.id))}
                                  <div class="preflight-group">
                                    <div class="preflight-label">Media Scope Review</div>
                                    <div class="preflight-summary-inline">
                                      {getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.summary}
                                    </div>
                                    <div class="manifest-review-meta">
                                      <span class="preflight-decision {getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalRequired && !getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalAccepted ? 'warn' : getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalAccepted ? 'pass' : getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.status}">
                                        {getManifestMediaScopeStatusLabel(getManifestMediaScopeReview(getManifestEditorState(pkg.id)))}
                                      </span>
                                      <span class="manifest-review-chip">
                                        Risk: {getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.risk || 'unknown'}
                                      </span>
                                      <span class="manifest-review-chip">
                                        {getManifestMediaScopeApprovalHint(getManifestMediaScopeReview(getManifestEditorState(pkg.id)))}
                                      </span>
                                    </div>
                                    {#if getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.scopes?.length}
                                      <div class="preflight-list">
                                        {#each getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.scopes || [] as scope}
                                          <div class="preflight-item">
                                            <span class="preflight-item-status {scope.status}">{String(scope.status || 'info').toUpperCase()}</span>
                                            <span>{scope.label}</span>
                                            {#if scope.detail}
                                              <span class="preflight-item-detail">{scope.detail}</span>
                                            {/if}
                                          </div>
                                        {/each}
                                      </div>
                                    {/if}
                                    {#if getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalRequired}
                                      <label class="preflight-bypass manifest-approval-toggle">
                                        <input
                                          type="checkbox"
                                          checked={getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalAccepted === true}
                                          onchange={(event) => setManifestMediaScopesAccepted(pkg, event.currentTarget.checked)}
                                        />
                                        I reviewed and approve the media scope changes
                                      </label>
                                    {/if}
                                  </div>
                                {/if}
                                {#if getManifestEditorState(pkg.id)?.preflight?.blockers?.length}
                                  <div class="preflight-list">
                                    {#each getManifestEditorState(pkg.id)?.preflight?.blockers || [] as blocker}
                                      <div class="preflight-item">
                                        <span class="preflight-item-status fail">FAIL</span>
                                        <span>{blocker.label}</span>
                                        {#if blocker.detail}
                                          <span class="preflight-item-detail">{blocker.detail}</span>
                                        {/if}
                                      </div>
                                    {/each}
                                  </div>
                                {/if}
                                <label class="approval-field">
                                  <span>Type {getLifecycleTypedConfirmation(getManifestEditorState(pkg.id)?.preflight)} to approve</span>
                                  <input
                                    value={getManifestEditorState(pkg.id)?.lifecycleTypedInput || ''}
                                    oninput={(event) => setManifestLifecycleTypedInput(pkg, event.currentTarget.value)}
                                    disabled={Boolean(getManifestEditorState(pkg.id)?.saving)}
                                    autocomplete="off"
                                  />
                                </label>
                              {/if}
                              <div class="manifest-editor-actions">
                                <button
                                  class="btn tiny ghost"
                                  onclick={() => runManifestPreflight(pkg)}
                                  disabled={
                                    Boolean(getManifestEditorState(pkg.id)?.preflightLoading)
                                    || Boolean(getManifestEditorState(pkg.id)?.saving)
                                    || Boolean(getManifestEditorState(pkg.id)?.parseError)
                                    || !getManifestEditorState(pkg.id)?.parsed
                                  }
                                >
                                  {getManifestEditorState(pkg.id)?.preflightLoading ? 'Preflight...' : 'Run Preflight'}
                                </button>
                                <button
                                  class="btn tiny primary"
                                  onclick={() => saveManifestUpdate(pkg)}
                                  disabled={
                                  Boolean(getManifestEditorState(pkg.id)?.saving)
                                  || Boolean(getManifestEditorState(pkg.id)?.preflightLoading)
                                  || Boolean(getManifestEditorState(pkg.id)?.parseError)
                                  || !getManifestEditorState(pkg.id)?.parsed
                                  || !getManifestEditorState(pkg.id)?.preflight
                                  || Boolean(getManifestEditorState(pkg.id)?.preflight?.blocked)
                                  || (
                                    Boolean(getManifestEditorState(pkg.id)?.preflight)
                                    && (getManifestEditorState(pkg.id)?.lifecycleTypedInput || '').trim() !== getLifecycleTypedConfirmation(getManifestEditorState(pkg.id)?.preflight)
                                  )
                                  || (
                                    getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalRequired
                                    && !getManifestMediaScopeReview(getManifestEditorState(pkg.id))?.approvalAccepted
                                  )
                                }
                                >
                                  {getManifestEditorState(pkg.id)?.saving ? 'Saving...' : 'Save Manifest'}
                                </button>
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Package Files</div>
                        <div class="ops-inline">
                          <button
                            class="btn tiny ghost"
                            onclick={() => openPackageDirectory(pkg, getParentDirectory(getPackageFilesState(pkg.id).path))}
                            disabled={Boolean(packageFilesLoadingByApp[pkg.id]) || !getPackageFilesState(pkg.id).path}
                          >
                            Up
                          </button>
                          <button
                            class="btn tiny ghost"
                            onclick={() => refreshPackageDirectory(pkg)}
                            disabled={Boolean(packageFilesLoadingByApp[pkg.id])}
                          >
                            {packageFilesLoadingByApp[pkg.id] ? 'Loading...' : 'Reload'}
                          </button>
                          <span class="package-files-path">/{getPackageFilesState(pkg.id).path || ''}</span>
                        </div>

                        {#if packageFilesErrorByApp[pkg.id]}
                          <div class="preflight-blocked-reason">{packageFilesErrorByApp[pkg.id]}</div>
                        {:else if packageFilesLoadingByApp[pkg.id]}
                          <div class="runtime-log-empty">Loading package files...</div>
                        {:else if getPackageFilesState(pkg.id).entries.length === 0}
                          <div class="runtime-log-empty">No files in this directory.</div>
                        {:else}
                          <div class="package-files-list">
                            {#each getPackageFilesState(pkg.id).entries as entry}
                              <div class="package-file-row">
                                <span class="package-file-name {entry.type}">
                                  {entry.type === 'directory' ? '[DIR]' : '[FILE]'} {entry.name}
                                </span>
                                <div class="package-file-actions">
                                  {#if entry.type === 'directory'}
                                    <button class="btn tiny ghost" onclick={() => openPackageDirectory(pkg, entry.path)}>Enter</button>
                                  {:else}
                                    <button class="btn tiny ghost" onclick={() => openPackageFileEditor(pkg.id, entry.path)}>Edit</button>
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>

                    <div class="ops-row split">
                      <div class="ops-panel">
                        <div class="ops-panel-title">Lifecycle Summary</div>
                        {#if lifecycleLoading === pkg.id}
                          <div class="runtime-log-empty">Loading lifecycle...</div>
                        {:else if !getLifecycle(pkg)}
                          <div class="runtime-log-empty">No lifecycle data.</div>
                        {:else}
                          <div class="ops-meta-list">
                            <div>Current: {getLifecycle(pkg)?.current?.version || '-'}</div>
                            <div>Installed: {formatDateTime(getLifecycle(pkg)?.current?.installedAt)}</div>
                            <div>Source: {getLifecycle(pkg)?.current?.source || '-'}</div>
                            <div>Boundary: {getWorkspaceBoundaryLabel(pkg)}</div>
                            <div>Local Workspace: {getWorkspaceBridge(pkg)?.path || '-'}</div>
                            <div>Backups: {getAvailableBackups(pkg).length}</div>
                          </div>
                        {/if}
                      </div>
                      <div class="ops-panel">
                        <div class="ops-panel-title">Recent Runtime Events</div>
                        {#if runtimeEventsLoading === pkg.id}
                          <div class="runtime-log-empty">Loading events...</div>
                        {:else if !runtimeEventsByApp[pkg.id] || runtimeEventsByApp[pkg.id].length === 0}
                          <div class="runtime-log-empty">No events.</div>
                        {:else}
                          <div class="event-list">
                            {#each runtimeEventsByApp[pkg.id].slice(-10).reverse() as event}
                              <div class="event-row">
                                <span>{formatDateTime(event.timestamp)}</span>
                                <span>{formatEventLabel(event)}</span>
                                <span>{event.reason || event.message || '-'}</span>
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </div>

                    <div class="ops-row">
                      <div class="ops-group">
                        <div class="ops-label">Last Health/QA</div>
                        {#if getHealthReport(pkg)}
                          <div class="ops-meta-list">
                            <div>Status: {String(getHealthStatus(pkg)).toUpperCase()}</div>
                            <div>Checked: {formatDateTime(getHealthReport(pkg)?.checkedAt)}</div>
                            <div>Summary: {getHealthReport(pkg)?.summary || '-'}</div>
                          </div>
                        {:else}
                          <div class="runtime-log-empty">No health report yet.</div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/if}
                {#if runtimeLogsByApp[pkg.id]}
                  <div class="runtime-log-panel">
                    {#if runtimeLogsByApp[pkg.id].length === 0}
                      <div class="runtime-log-empty">No logs.</div>
                    {:else}
                      {#each runtimeLogsByApp[pkg.id] as row}
                        <div class="runtime-log-line">
                          <span>[{new Date(row.timestamp).toLocaleTimeString()}]</span>
                          <span class="runtime-log-stream {row.stream}">{row.stream}</span>
                          <span>{row.message}</span>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>

  {#if rollbackReview}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="rollbackReviewTitle">
        <div class="approval-head">
          <h3 id="rollbackReviewTitle">Rollback Package</h3>
          <span class="risk-chip danger">HIGH IMPACT</span>
        </div>
        <div class="approval-section">
          <span>Target</span>
          <strong>{rollbackReview.pkg?.title || rollbackReview.pkg?.id}</strong>
        </div>
        <div class="approval-section">
          <span>Backup</span>
          <code>{rollbackReview.backupId}</code>
        </div>
        <div class="approval-section">
          <span>Review</span>
          <p>{rollbackReview.summary}</p>
        </div>
        {#if rollbackReview.blockers?.length}
          <div class="approval-section">
            <span>Blockers</span>
            <ul class="approval-list">
              {#each rollbackReview.blockers as blocker}
                <li>{blocker.message || blocker.reason || blocker.code || 'Rollback blocker'}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if rollbackReview.error}
          <div class="approval-error">{rollbackReview.error}</div>
        {/if}
        <label class="dialog-field">
          <span>Type {rollbackReview.typedConfirmation} to approve rollback</span>
          <input
            bind:value={rollbackLifecycleTypedInput}
            disabled={rollbackReview.loading}
            autocomplete="off"
          />
        </label>
        <div class="approval-actions">
          <button class="dialog-btn secondary" onclick={closeRollbackReview} disabled={rollbackReview.loading}>Cancel</button>
          <button
            class="dialog-btn danger"
            onclick={executeRollbackReview}
            disabled={rollbackReview.loading || rollbackReview.blocked || rollbackLifecycleTypedInput.trim() !== rollbackReview.typedConfirmation}
          >
            {rollbackReview.loading ? 'Working...' : 'Approve Rollback'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if cloneDialog}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="cloneDialogTitle">
        <div class="approval-head">
          <h3 id="cloneDialogTitle">Clone Package</h3>
          <span class="risk-chip neutral">PACKAGE COPY</span>
        </div>
        <div class="approval-section">
          <span>Source</span>
          <strong>{cloneDialog.pkg.title || cloneDialog.pkg.id}</strong>
        </div>
        <label class="dialog-field">
          <span>Clone target id</span>
          <input
            value={cloneDialog.targetId}
            oninput={(event) => setCloneDialogField('targetId', event.currentTarget.value)}
            disabled={cloneDialog.loading}
            autocomplete="off"
          />
        </label>
        <label class="dialog-field">
          <span>Clone title</span>
          <input
            value={cloneDialog.title}
            oninput={(event) => setCloneDialogField('title', event.currentTarget.value)}
            disabled={cloneDialog.loading}
            autocomplete="off"
          />
        </label>
        {#if cloneDialog.error}
          <div class="approval-error">{cloneDialog.error}</div>
        {/if}
        <div class="approval-actions">
          <button class="dialog-btn ghost" onclick={closeCloneDialog} disabled={cloneDialog.loading}>Cancel</button>
          <button class="dialog-btn primary" onclick={submitCloneDialog} disabled={cloneDialog.loading}>
            {cloneDialog.loading ? 'Cloning...' : 'Create Clone'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if packageDeleteReview}
    {@const deletePreflight = packageDeleteReview.preflight}
    {@const deleteTypedConfirmation = deletePreflight?.approval?.typedConfirmation || packageDeleteReview.appId}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="packageDeleteTitle">
        <div class="approval-head">
          <h3 id="packageDeleteTitle">Remove Package</h3>
          <span class="risk-chip">HIGH IMPACT</span>
        </div>
        <div class="approval-section">
          <span>Target</span>
          <strong>{deletePreflight?.target?.label || packageDeleteReview.pkg?.title || packageDeleteReview.appId}</strong>
        </div>
        <div class="approval-section">
          <span>Impact</span>
          {#if deletePreflight?.impact?.length > 0}
            <ul class="approval-list">
              {#each deletePreflight.impact as item}
                <li>{item}</li>
              {/each}
            </ul>
          {:else}
            <p>Removes the installed package, runtime registration, and package-owned inventory state.</p>
          {/if}
        </div>
        <div class="approval-section">
          <span>Recoverability</span>
          <p>
            {deletePreflight?.recoverability?.backupAvailable
              ? `Backup available${deletePreflight.recoverability.latestBackupId ? `: ${deletePreflight.recoverability.latestBackupId}` : ''}.`
              : 'Recoverability depends on existing package backups or reinstall source availability.'}
          </p>
        </div>
        {#if deletePreflight?.approval?.expiresAt}
          <div class="approval-section">
            <span>Approval expires</span>
            <code>{deletePreflight.approval.expiresAt}</code>
          </div>
        {/if}
        {#if packageDeleteReview.loading}
          <div class="runtime-log-empty">Loading delete preflight...</div>
        {/if}
        {#if packageDeleteReview.error}
          <div class="approval-error">{packageDeleteReview.error}</div>
        {/if}
        <label class="dialog-field">
          <span>Type <code>{deleteTypedConfirmation}</code> to approve</span>
          <input bind:value={packageDeleteTypedInput} disabled={packageDeleteReview.loading || removingPackageId || !deletePreflight} autocomplete="off" />
        </label>
        <div class="approval-actions">
          <button class="dialog-btn ghost" onclick={closePackageDeleteReview} disabled={Boolean(removingPackageId)}>Cancel</button>
          <button class="dialog-btn danger" onclick={executePackageDelete} disabled={Boolean(removingPackageId) || packageDeleteReview.loading || !deletePreflight}>
            {removingPackageId ? 'Removing...' : 'Approve & Remove'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .package-center {
    height: 100%;
    min-height: 0;
    padding: 14px;
    display: grid;
    grid-template-columns: minmax(360px, 440px) minmax(0, 1fr);
    gap: 10px;
    color: var(--text-main);
    background: linear-gradient(180deg, #111827 0%, #0b1120 42%, #070b12 100%);
    overflow: hidden;
  }

  .category-panel {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    background: rgba(8, 13, 22, 0.92);
  }

  .panel-title {
    font-size: 12px;
    color: #93c5fd;
    letter-spacing: 0;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .panel-kicker {
    color: #f8fafc;
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .category {
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #cbd5e1;
    padding: 9px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    text-align: left;
  }

  .category span {
    flex: 1;
  }

  .category small {
    color: #94a3b8;
    font-size: 11px;
  }

  .category.active {
    border-color: rgba(96, 165, 250, 0.38);
    background: linear-gradient(90deg, rgba(37, 99, 235, 0.42), rgba(14, 165, 233, 0.12));
    color: #f8fafc;
  }

  .panel-divider {
    height: 1px;
    background: rgba(148, 163, 184, 0.16);
    margin: 8px 0;
  }

  .content {
    min-height: 0;
    display: grid;
    gap: 12px;
    align-content: start;
    overflow: auto;
    padding-right: 4px;
  }

  .package-list-panel {
    flex: 1;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    overflow: hidden;
  }

  .package-list-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }

  .package-list-title {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .package-list-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .package-list-actions .btn.icon.active {
    border-color: rgba(56, 189, 248, 0.36);
    background: rgba(14, 165, 233, 0.18);
    color: #e0f2fe;
  }

  .package-list-head span {
    color: #93c5fd;
    font-size: 11px;
    text-transform: uppercase;
  }

  .package-list-head strong {
    color: #f8fafc;
    font-size: 15px;
  }

  .library-search {
    margin: 10px 12px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 0;
    background: rgba(2, 6, 23, 0.62);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    color: #94a3b8;
  }

  .library-search input {
    border: 0;
    outline: 0;
    background: transparent;
    color: #e2e8f0;
    width: 100%;
    min-width: 0;
    font-size: 13px;
  }

  .package-list-controls {
    min-height: 0;
    max-height: 44vh;
    overflow: auto;
    display: grid;
    gap: 8px;
    padding: 0 12px 10px;
  }

  .compact-create-panel {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.38);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .compact-create-head {
    display: grid;
    gap: 3px;
  }

  .compact-create-head h3 {
    font-size: 13px;
  }

  .compact-create-panel .starter-apps,
  .compact-create-panel .ecosystem-templates,
  .compact-create-panel .wizard-panel {
    border-radius: 8px;
    padding: 8px;
    gap: 8px;
  }

  .compact-create-panel .starter-apps-list {
    gap: 6px;
  }

  .compact-create-panel .template-list {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .compact-create-panel .template-card {
    padding: 8px;
    gap: 6px;
  }

  .compact-create-panel .wizard-form-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .compact-create-panel .wizard-form-grid input,
  .compact-create-panel .wizard-form-grid select {
    padding: 8px 9px;
    border-radius: 8px;
    font-size: 12px;
  }

  .compact-create-panel .wizard-actions {
    gap: 6px;
  }

  .compact-create-panel .preflight-panel {
    max-height: 260px;
    overflow: auto;
  }

  .package-utility-panel {
    border: 1px solid rgba(56, 189, 248, 0.2);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.5);
    padding: 10px;
    display: grid;
    gap: 10px;
  }

  .package-utility-head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 8px;
  }

  .package-utility-head h3 {
    font-size: 13px;
  }

  .package-utility-panel .source-form,
  .package-utility-panel .quick-install-grid,
  .package-utility-panel .zip-import-grid {
    grid-template-columns: 1fr;
  }

  .package-utility-panel .source-hints,
  .package-utility-panel .quick-install-profile,
  .package-utility-panel .zip-import-panel {
    border-radius: 8px;
  }

  .package-utility-panel .preflight-panel {
    max-height: 320px;
    overflow: auto;
  }

  .compact-source-filter {
    display: grid;
    gap: 4px;
    padding: 0;
  }

  .source-row {
    border: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: #cbd5e1;
    padding: 7px 9px;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    cursor: pointer;
    text-align: left;
  }

  .source-row.active {
    border-color: rgba(56, 189, 248, 0.24);
    background: rgba(14, 165, 233, 0.12);
    color: #f8fafc;
  }

  .source-row small {
    color: #94a3b8;
  }

  .package-list {
    min-height: 0;
    overflow: auto;
    padding: 0 0 6px;
    display: grid;
    align-content: start;
    gap: 0;
  }

  .package-list-item {
    width: 100%;
    min-width: 0;
    border: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 0;
    background: transparent;
    color: #e2e8f0;
    padding: 8px;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    text-align: left;
  }

  .package-list-item:hover {
    background: rgba(51, 65, 85, 0.45);
  }

  .package-list-item.active {
    border-left: 3px solid rgba(96, 165, 250, 0.8);
    background: linear-gradient(90deg, rgba(37, 99, 235, 0.34), rgba(15, 23, 42, 0.3));
  }

  .list-icon {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bfdbfe;
    background: rgba(30, 41, 59, 0.86);
  }

  .list-copy {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .list-copy strong,
  .list-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list-copy strong {
    font-size: 13px;
  }

  .list-copy span,
  .list-meta small {
    color: #94a3b8;
    font-size: 11px;
  }

  .list-meta {
    display: grid;
    justify-items: end;
    gap: 3px;
    font-size: 11px;
    color: #cbd5e1;
    text-transform: uppercase;
  }

  .list-meta small.running,
  .list-meta small.degraded,
  .list-meta small.starting {
    color: #bbf7d0;
  }

  .selected-package-detail {
    border: 1px solid rgba(96, 165, 250, 0.2);
    border-radius: 8px;
    padding: 16px;
    background:
      linear-gradient(180deg, rgba(30, 41, 59, 0.94), rgba(10, 15, 25, 0.9)),
      rgba(15, 23, 42, 0.9);
    display: grid;
    gap: 14px;
  }

  .feedback {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13px;
    background: rgba(15, 23, 36, 0.7);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .feedback-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .feedback-copy strong {
    color: #fff1f2;
    font-size: 12px;
  }

  .feedback-copy span {
    line-height: 1.35;
  }

  .feedback-retry {
    flex-shrink: 0;
  }

  .feedback.info {
    color: #bbf7d0;
    border-color: rgba(16, 185, 129, 0.35);
  }

  .feedback.error {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.3);
  }

  .block {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    padding: 14px;
    background: rgba(12, 18, 30, 0.82);
    display: grid;
    gap: 12px;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .installed-management .selected-package-management {
    order: 1;
  }

  .selected-package-management {
    grid-template-columns: 1fr;
  }

  .installed-app-summary {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  .installed-app-icon .icon-box {
    width: 52px;
    height: 52px;
  }

  .installed-app-main {
    min-width: 0;
    display: grid;
    gap: 10px;
  }

  .installed-app-title-row {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 12px;
  }

  .installed-app-title-row h3 {
    margin: 0;
    color: #f8fafc;
    font-size: 20px;
    line-height: 1.15;
  }

  .installed-app-title-row span {
    display: block;
    margin-top: 3px;
    color: #94a3b8;
    font-size: 12px;
  }

  .installed-primary-actions,
  .installed-status-line,
  .installed-management-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .installed-primary-actions {
    justify-content: flex-end;
  }

  .installed-status-line {
    color: #cbd5e1;
    font-size: 12px;
    text-transform: uppercase;
  }

  .installed-detail-layout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .installed-spec-panel {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    padding: 10px;
    background: rgba(15, 23, 42, 0.38);
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .installed-description-panel {
    grid-column: 1 / -1;
  }

  .installed-description-panel p {
    margin: 0;
    color: #cbd5e1;
    font-size: 13px;
    line-height: 1.45;
  }

  .installed-spec-title {
    color: #93c5fd;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .installed-spec-list {
    display: grid;
    gap: 7px;
  }

  .installed-spec-list div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .installed-spec-list span {
    color: #94a3b8;
    font-size: 11px;
    text-transform: uppercase;
  }

  .installed-spec-list strong,
  .installed-spec-panel > strong {
    color: #e2e8f0;
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .installed-health-field {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .installed-health-field > span {
    grid-column: 1 / -1;
  }

  .installed-health-field .health.pass {
    color: #bbf7d0;
  }

  .installed-health-field .health.warn {
    color: #fde68a;
  }

  .installed-health-field .health.fail,
  .installed-health-field .health.error {
    color: #fecaca;
  }

  .installed-health-field .health.unknown {
    color: #cbd5e1;
  }

  .installed-dependency-list {
    display: grid;
    gap: 6px;
    color: #e2e8f0;
    font-size: 13px;
  }

  h3 {
    margin: 0;
    font-size: 16px;
  }

  .source-form {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto;
    gap: 8px;
  }

  .source-hints {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.45);
    padding: 8px 10px;
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: #cbd5e1;
  }

  .source-preview {
    margin-top: 4px;
    display: grid;
    gap: 4px;
  }

  .source-preview span {
    font-size: 11px;
    color: #93c5fd;
  }

  .source-preview code {
    font-size: 11px;
    color: #bae6fd;
    background: rgba(15, 23, 36, 0.75);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 8px;
    padding: 6px 8px;
    overflow-x: auto;
    white-space: nowrap;
  }

  .quick-install-profile {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.4);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .quick-install-head {
    display: grid;
    gap: 3px;
  }

  .quick-install-head strong {
    font-size: 13px;
    color: #dbeafe;
  }

  .quick-install-head span {
    font-size: 11px;
    color: #93a7c0;
  }

  .quick-install-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px;
    gap: 8px;
  }

  .quick-install-grid select {
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.65);
    color: #e2e8f0;
    padding: 9px 10px;
  }

  .zip-import-panel {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.35);
    display: grid;
    gap: 10px;
  }

  .zip-import-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }

  input {
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.65);
    color: #e2e8f0;
    padding: 9px 10px;
  }

  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .source-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    padding: 6px 10px;
    background: rgba(148, 163, 184, 0.08);
    font-size: 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .ecosystem-templates {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.35);
    display: grid;
    gap: 10px;
  }

  .section-title {
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #bae6fd;
  }

  .template-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .starter-apps {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.35);
    display: grid;
    gap: 10px;
  }

  .starter-apps-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .template-card {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: rgba(15, 23, 36, 0.7);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .template-top {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: center;
  }

  .template-top strong {
    font-size: 13px;
  }

  .template-top span {
    font-size: 11px;
    color: #93c5fd;
    border: 1px solid rgba(96, 165, 250, 0.35);
    border-radius: 999px;
    padding: 2px 7px;
  }

  .template-card p {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.4;
  }

  .store-categories {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .wizard-panel {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.35);
    display: grid;
    gap: 10px;
  }

  .wizard-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .wizard-steps {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .wizard-step {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.25);
  }

  .wizard-step.active {
    color: #dbeafe;
    border-color: rgba(56, 189, 248, 0.34);
    background: rgba(14, 165, 233, 0.16);
  }

  .wizard-form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }

  .wizard-form-grid select {
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.65);
    color: #e2e8f0;
    padding: 9px 10px;
  }

  .wizard-actions {
    display: inline-flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .store-filter {
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 999px;
    padding: 6px 10px;
    background: rgba(2, 6, 23, 0.45);
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
  }

  .store-filter.active {
    color: #dbeafe;
    border-color: rgba(56, 189, 248, 0.34);
    background: rgba(14, 165, 233, 0.16);
  }

  .source-errors {
    display: grid;
    gap: 8px;
  }

  .source-error {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px dashed rgba(248, 113, 113, 0.35);
    border-radius: 10px;
    background: rgba(127, 29, 29, 0.14);
    padding: 8px 10px;
    font-size: 12px;
    color: #fecaca;
  }

  .card {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 12px;
    display: grid;
    gap: 10px;
    background: rgba(2, 6, 23, 0.36);
  }

  .card-head {
    display: flex;
    gap: 10px;
  }

  .icon-box {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7dd3fc;
    background: rgba(14, 165, 233, 0.14);
    flex-shrink: 0;
  }

  .icon-image {
    width: 18px;
    height: 18px;
    object-fit: contain;
    border-radius: 4px;
  }

  .meta h4 {
    margin: 0;
    font-size: 14px;
  }

  .meta p {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.35;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips span {
    padding: 5px 8px;
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-dim);
    background: rgba(148, 163, 184, 0.08);
  }

  .package-widgets {
    display: grid;
    gap: 8px;
    padding: 8px;
    border: 1px solid rgba(125, 211, 252, 0.18);
    border-radius: 10px;
    background: rgba(14, 165, 233, 0.06);
  }

  .package-widget-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .package-widget-row div {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .package-widget-row strong {
    font-size: 12px;
    color: #e0f2fe;
  }

  .package-widget-row span {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .btn {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: transparent;
    color: var(--text-main);
    padding: 8px 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .btn.primary {
    color: #dbeafe;
    border-color: rgba(56, 189, 248, 0.3);
    background: rgba(14, 165, 233, 0.16);
  }

  .btn.ghost {
    background: rgba(15, 23, 36, 0.72);
  }

  .btn.danger {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.3);
    background: rgba(127, 29, 29, 0.2);
  }

  .btn.tiny {
    padding: 4px 8px;
    font-size: 11px;
    border-radius: 999px;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .empty {
    min-height: 120px;
    border: 1px dashed rgba(148, 163, 184, 0.25);
    border-radius: 12px;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 13px;
  }

  .empty.compact {
    min-height: 112px;
    margin: 8px 0;
    border: 0;
    border-radius: 0;
    padding: 12px;
    text-align: center;
  }

  .ops-console {
    margin-top: 2px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 10px;
    background: rgba(2, 6, 23, 0.5);
    display: grid;
    gap: 10px;
  }

  .ops-row {
    display: grid;
    gap: 8px;
  }

  .ops-row.split {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .ops-group {
    display: grid;
    gap: 6px;
  }

  .ops-group label,
  .ops-label {
    font-size: 11px;
    color: #93c5fd;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .ops-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .ops-inline input,
  .ops-inline select {
    min-width: 160px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.65);
    color: #e2e8f0;
    padding: 6px 8px;
    font-size: 12px;
  }

  .backup-jobs-list {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.62);
    max-height: 220px;
    overflow: auto;
    padding: 6px;
    display: grid;
    gap: 6px;
  }

  .backup-job-row {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 6px 8px;
    display: grid;
    gap: 4px;
    background: rgba(15, 23, 42, 0.35);
  }

  .backup-job-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .backup-job-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .backup-job-note {
    font-size: 12px;
    color: #cbd5e1;
  }

  .backup-job-head .status {
    border-radius: 999px;
    padding: 2px 7px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(51, 65, 85, 0.25);
    font-size: 10px;
    font-weight: 600;
  }

  .backup-job-head .status.completed {
    color: #bbf7d0;
    border-color: rgba(22, 163, 74, 0.4);
    background: rgba(22, 163, 74, 0.2);
  }

  .backup-job-head .status.failed {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(185, 28, 28, 0.2);
  }

  .backup-job-head .status.error {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(185, 28, 28, 0.2);
  }

  .backup-job-head .status.running {
    color: #93c5fd;
    border-color: rgba(96, 165, 250, 0.45);
    background: rgba(37, 99, 235, 0.2);
  }

  .backup-job-head .status.queued {
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.45);
    background: rgba(51, 65, 85, 0.35);
  }

  .backup-job-head .status.cancelled {
    color: #fde68a;
    border-color: rgba(217, 119, 6, 0.45);
    background: rgba(180, 83, 9, 0.18);
  }

  .backup-job-head .status.unknown {
    color: #cbd5e1;
    border-color: rgba(148, 163, 184, 0.3);
    background: rgba(51, 65, 85, 0.3);
  }

  .package-files-path {
    font-size: 11px;
    color: var(--text-dim);
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .package-files-list {
    max-height: 220px;
    overflow: auto;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.62);
    padding: 6px;
    display: grid;
    gap: 6px;
  }

  .package-file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 8px;
    background: rgba(15, 23, 36, 0.45);
    padding: 6px 8px;
  }

  .package-file-name {
    font-size: 12px;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .package-file-name.directory {
    color: #bae6fd;
  }

  .package-file-name.file {
    color: #e2e8f0;
  }

  .package-file-actions {
    display: inline-flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .ops-panel {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    padding: 8px;
    background: rgba(15, 23, 36, 0.45);
    display: grid;
    gap: 8px;
  }

  .ops-panel-title {
    font-size: 12px;
    font-weight: 600;
    color: #dbeafe;
  }

  .ops-meta-list {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: #cbd5e1;
  }

  .event-list {
    max-height: 170px;
    overflow: auto;
    display: grid;
    gap: 6px;
  }

  .event-row {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr 1fr;
    gap: 8px;
    font-size: 11px;
    color: #cbd5e1;
  }

  .preflight-panel {
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.58);
    padding: 10px;
    display: grid;
    gap: 10px;
  }

  .preflight-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .preflight-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .preflight-decision {
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.25);
  }

  .preflight-decision.pass {
    color: #bbf7d0;
    border-color: rgba(22, 163, 74, 0.42);
    background: rgba(22, 163, 74, 0.2);
  }

  .preflight-decision.warn {
    color: #fde68a;
    border-color: rgba(202, 138, 4, 0.42);
    background: rgba(202, 138, 4, 0.2);
  }

  .preflight-decision.blocked {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.42);
    background: rgba(185, 28, 28, 0.22);
  }

  .preflight-summary,
  .preflight-summary-inline {
    font-size: 12px;
    color: #cbd5e1;
    line-height: 1.4;
  }

  .preflight-blocked-reason {
    border: 1px dashed rgba(248, 113, 113, 0.35);
    border-radius: 8px;
    background: rgba(127, 29, 29, 0.2);
    color: #fecaca;
    padding: 8px;
    font-size: 12px;
  }

  .preflight-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
  }

  .preflight-group {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    background: rgba(15, 23, 36, 0.45);
    padding: 8px;
    display: grid;
    gap: 6px;
  }

  .preflight-group label,
  .preflight-label {
    font-size: 11px;
    color: #93c5fd;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .preflight-list {
    display: grid;
    gap: 6px;
  }

  .manifest-review-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .manifest-review-chip {
    border-radius: 999px;
    padding: 3px 8px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(51, 65, 85, 0.24);
    color: #cbd5e1;
    font-size: 11px;
  }

  .preflight-item {
    display: grid;
    gap: 2px;
    font-size: 12px;
    color: #e2e8f0;
  }

  .preflight-item-status {
    width: fit-content;
    border-radius: 999px;
    padding: 2px 7px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(51, 65, 85, 0.25);
    font-size: 10px;
    color: #cbd5e1;
  }

  .preflight-item-status.pass {
    color: #bbf7d0;
    border-color: rgba(22, 163, 74, 0.4);
    background: rgba(22, 163, 74, 0.2);
  }

  .preflight-item-status.warn {
    color: #fde68a;
    border-color: rgba(202, 138, 4, 0.4);
    background: rgba(202, 138, 4, 0.2);
  }

  .preflight-item-status.fail {
    color: #fecaca;
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(185, 28, 28, 0.2);
  }

  .preflight-item-detail {
    color: var(--text-dim);
    font-size: 11px;
  }

  .preflight-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .preflight-bypass {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #cbd5e1;
  }

  .preflight-bypass input[type='checkbox'] {
    width: 14px;
    height: 14px;
    margin: 0;
    padding: 0;
    border-radius: 4px;
  }

  .manifest-approval-toggle {
    margin-top: 2px;
  }

  .approval-field {
    display: grid;
    gap: 5px;
    min-width: min(100%, 260px);
    color: #cbd5e1;
    font-size: 12px;
  }

  .approval-field input {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.8);
    color: var(--text-main);
    padding: 7px 9px;
  }

  .preflight-buttons {
    display: inline-flex;
    gap: 8px;
  }

  .manifest-editor-panel {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.52);
    padding: 8px;
    display: grid;
    gap: 8px;
  }

  .manifest-editor-textarea {
    width: 100%;
    min-height: 220px;
    resize: vertical;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.72);
    color: #e2e8f0;
    padding: 8px;
    font-size: 12px;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  }

  .manifest-parse-error {
    border: 1px dashed rgba(248, 113, 113, 0.38);
    border-radius: 8px;
    background: rgba(127, 29, 29, 0.22);
    color: #fecaca;
    font-size: 12px;
    padding: 7px 8px;
  }

  .manifest-preflight-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .manifest-editor-actions {
    display: inline-flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(2, 6, 23, 0.72);
  }

  .approval-dialog {
    width: min(580px, 100%);
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: #111827;
    color: var(--text-main);
    padding: 16px;
    display: grid;
    gap: 12px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  }

  .approval-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .approval-head h3 {
    margin: 0;
    font-size: 16px;
  }

  .risk-chip {
    border: 1px solid rgba(248, 113, 113, 0.42);
    border-radius: 999px;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.28);
    padding: 3px 8px;
    font-size: 11px;
    white-space: nowrap;
  }

  .risk-chip.neutral {
    color: #bfdbfe;
    border-color: rgba(96, 165, 250, 0.42);
    background: rgba(30, 64, 175, 0.24);
  }

  .approval-section {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 8px;
    display: grid;
    gap: 4px;
    background: rgba(15, 23, 42, 0.75);
  }

  .approval-section span,
  .dialog-field span {
    color: var(--text-dim);
    font-size: 12px;
  }

  .approval-section strong {
    overflow-wrap: anywhere;
  }

  .approval-section p {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
  }

  .approval-list {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    color: #e2e8f0;
  }

  .approval-error {
    border: 1px dashed rgba(248, 113, 113, 0.4);
    border-radius: 8px;
    padding: 8px;
    color: #fecaca;
    background: rgba(127, 29, 29, 0.22);
    font-size: 12px;
  }

  .dialog-field {
    display: grid;
    gap: 6px;
  }

  .dialog-field input {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.8);
    color: var(--text-main);
    padding: 9px 10px;
  }

  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .dialog-btn {
    border: 1px solid rgba(148, 163, 184, 0.28);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-main);
    padding: 8px 11px;
    cursor: pointer;
  }

  .dialog-btn.primary {
    border-color: rgba(96, 165, 250, 0.46);
    color: #bfdbfe;
    background: rgba(30, 64, 175, 0.28);
  }

  .dialog-btn.danger {
    border-color: rgba(248, 113, 113, 0.46);
    color: #fecaca;
    background: rgba(127, 29, 29, 0.28);
  }

  .dialog-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (max-width: 1280px) {
    .package-center {
      grid-template-columns: minmax(330px, 390px) minmax(0, 1fr);
    }
  }

  @media (max-width: 1000px) {
    .package-center {
      grid-template-columns: 1fr;
      overflow: auto;
    }

    .category-panel,
    .package-list-panel,
    .content {
      min-height: auto;
      overflow: visible;
    }

    .source-form {
      grid-template-columns: 1fr;
    }

    .quick-install-grid {
      grid-template-columns: 1fr;
    }

    .zip-import-grid {
      grid-template-columns: 1fr;
    }

    .ops-row.split {
      grid-template-columns: 1fr;
    }
  }

  .runtime-log-panel {
    margin-top: 4px;
    max-height: 180px;
    overflow: auto;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(2, 6, 23, 0.65);
    padding: 8px;
    display: grid;
    gap: 4px;
  }

  .runtime-log-line {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 8px;
    font-size: 11px;
    color: #cbd5e1;
    line-height: 1.35;
  }

  .runtime-log-stream {
    text-transform: uppercase;
    opacity: 0.9;
  }

  .runtime-log-stream.stderr {
    color: #fecaca;
  }

  .runtime-log-stream.system {
    color: #bae6fd;
  }

  .runtime-log-empty {
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
