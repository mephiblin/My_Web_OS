<script>
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { LayoutGrid, Store, Link2, RefreshCw, Download, Play, Square, RotateCcw, Trash2 } from 'lucide-svelte';
  import { API_BASE } from '../../../utils/constants.js';
  import { apiFetch } from '../../../utils/api.js';
  import {
    cancelPackageBackupJob,
    createPackageBackup,
    createPackageBackupJob,
    cloneInstalledPackage as cloneInstalledPackageRequest,
    controlRuntimeApp,
    fetchPackageBackupJobs,
    fetchInstalledOpsSummary,
    fetchPackageFileEntries,
    fetchPackageManifest,
    preflightPackageRollback,
    fetchDesktopApps,
    fetchInstalledPackages,
    fetchRegistryInstallPreflight,
    fetchPackageLifecycle,
    preflightPackageManifestUpdate,
    fetchRuntimeApps,
    fetchRuntimeEvents,
    fetchRuntimeLogs,
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
    { title: 'Snippet Vault', templateId: 'snippet-vault' }
  ];

  let activeCategory = $state(CATEGORY.STORE);
  let loadingStore = $state(true);
  let loadingInstalled = $state(true);
  let loadingDesktopApps = $state(true);
  let savingSource = $state(false);
  let installingPackageId = $state('');
  let message = $state('');
  let error = $state('');
  let activeStoreSource = $state('all');

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
  let desktopAppModelStats = $state({
    system: 0,
    standard: 0,
    package: 0,
    total: 0
  });
  let desktopAppInventory = $state([]);
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
  let wizardPhase = $state('draft');
  let wizardLoadingPreflight = $state(false);
  let wizardCreating = $state(false);
  let wizardReview = $state(null);

  let wizardDraft = $state({
    id: '',
    title: '',
    description: '',
    version: '0.1.0',
    appType: 'app',
    runtimeType: 'sandbox-html',
    entry: 'index.html',
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
    return {
      id: String(wizardDraft.id || '').trim(),
      title: String(wizardDraft.title || '').trim(),
      description: String(wizardDraft.description || '').trim(),
      version: String(wizardDraft.version || '').trim() || '0.1.0',
      appType: String(wizardDraft.appType || 'app'),
      runtime: {
        runtimeType: String(wizardDraft.runtimeType || 'sandbox-html'),
        entry: String(wizardDraft.entry || '').trim()
      },
      permissions: normalizePermissionList(wizardDraft.permissions)
    };
  }

  async function runWizardPreflight() {
    wizardLoadingPreflight = true;
    wizardReview = null;
    clearFeedback();
    try {
      const manifest = buildWizardManifest();
      const response = await wizardPreflightPackage(manifest, wizardDraft.templateId);
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
        lifecycleSafeguards: normalizeSafeguardReview(readPreflightField(raw, ['lifecycleSafeguards'], null)),
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
      const response = await wizardCreatePackage(manifest, wizardDraft.templateId);
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

  function isServicePackage(pkg) {
    if (!pkg) return false;
    if (pkg.appType === 'service' || pkg.type === 'service') return true;
    if (pkg.appType === 'hybrid' || pkg.type === 'hybrid') return true;
    return pkg.runtimeProfile?.runtimeType && pkg.runtimeProfile.runtimeType !== 'sandbox-html';
  }

  function canOpenPackage(pkg) {
    return !pkg || (pkg.appType || pkg.type) !== 'service';
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

  function getHealthReport(pkg) {
    return healthByApp[pkg.id] || getLifecycle(pkg)?.lastQaReport || null;
  }

  function getHealthStatus(pkg) {
    return String(getHealthReport(pkg)?.status || 'unknown').toLowerCase();
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
      label: String(item?.code || item?.id || 'preflight.blocker'),
      status: 'fail',
      detail: String(item?.message || item?.reason || '')
    }));

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
      lifecycleSafeguards: normalizeSafeguardReview(readPreflightField(raw, ['lifecycleSafeguards'], null)),
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
      source: payload ? 'preflight-endpoint' : 'fallback'
    };
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
      lifecycleSafeguards: normalizeSafeguardReview(null),
      source: 'loading'
    };

    clearFeedback();
    try {
      const response = await withTimeout(
        fetchRegistryInstallPreflight({
          sourceId: pkg.source?.id,
          packageId: pkg.id,
          zipUrl: pkg.zipUrl || '',
          overwrite
        }),
        12000,
        'Preflight review request timed out.'
      );
      installReview = normalizeInstallPreflight(response, pkg, overwrite);
    } catch (err) {
      installReview = normalizeInstallPreflight(
        null,
        pkg,
        overwrite,
        err.message || 'Preflight endpoint unavailable. Please verify details before continuing.',
        { forceBlocked: true }
      );
    }
  }

  function closeInstallReview() {
    installReview = null;
  }

  function setInstallReviewBypass(checked) {
    if (!installReview) return;
    installReview = {
      ...installReview,
      forcePolicyBypass: checked === true
    };
  }

  async function executeInstallFromReview() {
    if (!installReview || installReview.loading) return;
    const target = storePackages.find((pkg) => pkg.id === installReview.packageId);
    if (!target) {
      error = 'Selected package is no longer in store results.';
      return;
    }
    if (installReview.blocked && !installReview.forcePolicyBypass) {
      error = 'Preflight is blocked. Enable policy bypass to continue.';
      return;
    }

    const ok = await installPackage(target, {
      overwrite: installReview.overwrite,
      forcePolicyBypass: installReview.forcePolicyBypass
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
      error = err.message || 'Failed to load installed packages.';
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
      error = err.message || 'Failed to load store packages.';
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

  function downloadInstalledPackage(pkg) {
    const token = localStorage.getItem('web_os_token') || '';
    if (!token) {
      error = 'Authentication required for export.';
      return;
    }
    const href = `${API_BASE}/api/packages/${encodeURIComponent(pkg.id)}/export?token=${encodeURIComponent(token)}`;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    message = `Export started: ${pkg.title}`;
  }

  async function cloneInstalledPackage(pkg) {
    clearFeedback();
    const targetId = prompt('Clone target id:', `${pkg.id}-copy`);
    if (!targetId) return;
    const title = prompt('Clone title (optional):', `${pkg.title} (Copy)`) || '';

    try {
      await cloneInstalledPackageRequest(pkg.id, targetId, title);
      message = `Package "${pkg.title}" cloned to "${targetId}".`;
      await Promise.all([loadInstalledPackages(), loadStorePackages(), loadRuntimeStatuses()]);
    } catch (err) {
      error = err.message || 'Failed to clone package.';
    }
  }

  async function installPackage(pkg, options = {}) {
    installingPackageId = pkg.id;
    clearFeedback();
    try {
      const overwrite = options.overwrite === true;
      const forcePolicyBypass = options.forcePolicyBypass === true;
      await apiFetch('/api/packages/registry/install', {
        method: 'POST',
        body: JSON.stringify({
          sourceId: pkg.source?.id,
          packageId: pkg.id,
          zipUrl: pkg.zipUrl || '',
          overwrite,
          forcePolicyBypass
        })
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
      message = `"${pkg.title}" health check completed.`;
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

  async function rollbackToBackup(pkg) {
    const backupId = selectedBackupByApp[pkg.id] || '';
    if (!backupId) {
      error = 'Select a backup to rollback.';
      return;
    }

    lifecycleActioning = `${pkg.id}:rollback`;
    clearFeedback();
    try {
      const preflight = await preflightPackageRollback(pkg.id, backupId);
      const blockers = Array.isArray(preflight?.preflight?.executionReadiness?.blockers)
        ? preflight.preflight.executionReadiness.blockers
        : [];
      if (blockers.length > 0 || preflight?.preflight?.executionReadiness?.ready === false) {
        const blockerMessage = blockers.map((item) => item?.message).filter(Boolean).join(' / ');
        throw new Error(blockerMessage || 'Rollback preflight is blocked by lifecycle safeguards.');
      }

      await rollbackPackageBackup(pkg.id, backupId);
      await Promise.all([loadLifecycle(pkg.id), loadRuntimeStatuses()]);
      message = `"${pkg.title}" rollback completed.`;
    } catch (err) {
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
        }
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
      }
    });
  }

  function normalizeAppModel(app) {
    const rawModel = String(app?.appModel || app?.model || '').trim().toLowerCase();
    if (rawModel === 'system') return 'system';
    if (rawModel === 'package') return 'package';
    if (rawModel === 'standard' || rawModel === 'app') return 'standard';

    const source = String(app?.source || '').trim().toLowerCase();
    const runtime = String(app?.runtimeType || app?.runtime || '').trim().toLowerCase();
    if (source === 'system-registry' || runtime === 'builtin') return 'system';
    if (source === 'inventory-package' || runtime === 'sandbox' || runtime.includes('process-')) return 'package';
    return 'standard';
  }

  function normalizeOwnerTier(app) {
    const raw = String(app?.ownerTier || '').trim().toLowerCase();
    if (raw) return raw;
    const model = normalizeAppModel(app);
    if (model === 'system') return 'core-system';
    if (model === 'package') return 'package-addon';
    return 'core-addon';
  }

  function normalizeDataBoundary(app) {
    const raw = String(app?.dataBoundary || '').trim().toLowerCase();
    if (raw) return raw;
    const model = normalizeAppModel(app);
    return model === 'package' ? 'inventory-app-data' : 'host-shared';
  }

  function getAppAssociationSummary(app) {
    const rows = Array.isArray(app?.fileAssociations) ? app.fileAssociations : [];
    if (rows.length === 0) return '-';
    const extensions = [];
    for (const row of rows) {
      const exts = Array.isArray(row?.extensions) ? row.extensions : [];
      for (const ext of exts) {
        if (!ext) continue;
        extensions.push(`.${ext}`);
        if (extensions.length >= 4) {
          return `${extensions.join(', ')} +${Math.max(0, rows.length - 1)}`;
        }
      }
    }
    return extensions.length > 0 ? extensions.join(', ') : `${rows.length} association(s)`;
  }

  async function loadDesktopAppModelStats() {
    loadingDesktopApps = true;
    try {
      const response = await fetchDesktopApps();
      const apps = Array.isArray(response) ? response : (Array.isArray(response?.apps) ? response.apps : []);
      desktopAppInventory = [...apps]
        .map((app) => ({
          ...app,
          appModel: normalizeAppModel(app),
          ownerTier: normalizeOwnerTier(app),
          dataBoundary: normalizeDataBoundary(app),
          runtimeType: String(app?.runtimeType || app?.runtime || '').trim().toLowerCase() || 'builtin',
          appType: String(app?.appType || app?.type || '').trim().toLowerCase() || 'app',
          permissions: Array.isArray(app?.permissions) ? app.permissions : [],
          fileAssociations: Array.isArray(app?.fileAssociations) ? app.fileAssociations : []
        }))
        .sort((a, b) => String(a.title || a.id || '').localeCompare(String(b.title || b.id || '')));
      const next = {
        system: 0,
        standard: 0,
        package: 0,
        total: apps.length
      };

      for (const app of apps) {
        const model = normalizeAppModel(app);
        if (model === 'system') next.system += 1;
        else if (model === 'package') next.package += 1;
        else next.standard += 1;
      }

      desktopAppModelStats = next;
    } catch (_err) {
      desktopAppInventory = [];
      desktopAppModelStats = {
        system: 0,
        standard: 0,
        package: 0,
        total: 0
      };
    } finally {
      loadingDesktopApps = false;
    }
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
        preflight: normalizeManifestPreflight(response)
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
        updatePackageManifest(pkg.id, current.parsed, getManifestEditorApprovals(current)),
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

  async function removeInstalledPackage(pkg) {
    clearFeedback();
    const ok = globalThis.confirm(`Remove package "${pkg.title}"?`);
    if (!ok) return;

    try {
      if (isServicePackage(pkg)) {
        await stopRuntimeApp(pkg.id).catch(() => {});
      }
      await removeInstalledPackageRequest(pkg.id);
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
    } catch (err) {
      error = err.message || 'Failed to remove package.';
    }
  }

  onMount(() => {
    Promise.all([
      loadRegistrySources(),
      loadStorePackages(),
      loadEcosystemTemplates(),
      loadInstalledPackages(),
      loadDesktopAppModelStats(),
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
    <button class="category {activeCategory === CATEGORY.STORE ? 'active' : ''}" onclick={() => activeCategory = CATEGORY.STORE}>
      <Store size={16} />
      <span>Store</span>
    </button>
    <button class="category {activeCategory === CATEGORY.INSTALLED ? 'active' : ''}" onclick={() => activeCategory = CATEGORY.INSTALLED}>
      <LayoutGrid size={16} />
      <span>Installed</span>
    </button>
  </aside>

  <section class="content">
    {#if message}
      <div class="feedback info glass-effect">{message}</div>
    {/if}
    {#if error}
      <div class="feedback error glass-effect">{error}</div>
    {/if}

    {#if activeCategory === CATEGORY.STORE}
      <div class="block glass-effect">
        <div class="block-head">
          <h3>Add Store Source</h3>
          <button class="btn ghost" onclick={loadStorePackages} disabled={loadingStore}>
            <RefreshCw size={14} />
            Reload
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

      <div class="block glass-effect">
        <div class="block-head">
          <h3>Store Packages</h3>
        </div>

        <div class="starter-apps">
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

        <div class="starter-apps">
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
          <div class="ecosystem-templates">
            <div class="section-title">Official Ecosystem Templates</div>
            <div class="template-list">
              {#each ecosystemTemplates as template}
                <article class="template-card">
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

        <div class="wizard-panel">
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
          <div class="wizard-form-grid">
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

        <div class="store-categories">
          <button class="store-filter {activeStoreSource === 'all' ? 'active' : ''}" onclick={() => activeStoreSource = 'all'}>
            All ({storePackages.length})
          </button>
          {#each registrySources as source}
            <button class="store-filter {activeStoreSource === source.id ? 'active' : ''}" onclick={() => activeStoreSource = source.id}>
              {source.title} ({getSourcePackageCount(source.id)})
            </button>
          {/each}
        </div>

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
        {:else}
          <div class="grid">
            {#each getVisibleStorePackages() as pkg}
              <article class="card">
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
                      <button class="btn primary" onclick={() => openInstallReview(pkg, { overwrite: true })} disabled={installingPackageId === pkg.id || installReview?.loading}>
                        <Download size={14} />
                        {installingPackageId === pkg.id ? 'Updating...' : 'Update'}
                      </button>
                    {:else}
                      <button class="btn ghost" disabled>Installed</button>
                    {/if}
                  {:else if !pkg.zipUrl}
                    <button class="btn ghost" disabled>No Zip</button>
                  {:else}
                    <button class="btn primary" onclick={() => openInstallReview(pkg)} disabled={installingPackageId === pkg.id || installReview?.loading}>
                      <Download size={14} />
                      {installingPackageId === pkg.id ? 'Installing...' : 'Install'}
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
                        <label class="preflight-bypass">
                          <input
                            type="checkbox"
                            checked={installReview.forcePolicyBypass}
                            onchange={(event) => setInstallReviewBypass(event.currentTarget.checked)}
                          />
                          Force policy bypass on execution
                        </label>
                        <div class="preflight-buttons">
                          <button class="btn ghost" onclick={closeInstallReview} disabled={installingPackageId === pkg.id}>Cancel</button>
                          <button
                            class="btn primary"
                            onclick={executeInstallFromReview}
                            disabled={installingPackageId === pkg.id || (installReview.blocked && !installReview.forcePolicyBypass)}
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
      </div>
    {/if}

    {#if activeCategory === CATEGORY.INSTALLED}
      <div class="block glass-effect">
        <div class="block-head">
          <h3>Installed</h3>
          <button
            class="btn ghost"
            onclick={() => Promise.all([loadInstalledPackages(), loadDesktopAppModelStats(), loadRuntimeStatuses()])}
            disabled={loadingInstalled || loadingDesktopApps}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        <div class="app-model-summary">
          <span class="model-chip system">SYS {desktopAppModelStats.system}</span>
          <span class="model-chip standard">APP {desktopAppModelStats.standard}</span>
          <span class="model-chip package">PKG {desktopAppModelStats.package}</span>
          <span class="model-chip total">TOTAL {desktopAppModelStats.total}</span>
        </div>
        <div class="desktop-app-inventory">
          <div class="desktop-app-head">
            <h4>Desktop App Contract</h4>
            <span>{desktopAppInventory.length} apps</span>
          </div>
          {#if loadingDesktopApps}
            <div class="runtime-log-empty">Loading desktop app contract...</div>
          {:else if desktopAppInventory.length === 0}
            <div class="runtime-log-empty">No desktop apps.</div>
          {:else}
            <div class="desktop-app-list">
              {#each desktopAppInventory as app}
                <div class="desktop-app-row">
                  <div class="desktop-app-main">
                    <span class="desktop-app-title">{app.title || app.id}</span>
                    <span class="desktop-app-id">{app.id}</span>
                  </div>
                  <div class="desktop-app-meta">
                    <span>{app.appModel}</span>
                    <span>{app.ownerTier}</span>
                    <span>{app.runtimeType}</span>
                    <span>{app.appType}</span>
                    <span>{app.dataBoundary}</span>
                    <span>perm:{app.permissions.length}</span>
                    <span>assoc:{getAppAssociationSummary(app)}</span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if loadingInstalled}
          <div class="empty">Loading installed packages...</div>
        {:else if installedPackages.length === 0}
          <div class="empty">No installed packages.</div>
        {:else}
          <div class="grid">
            {#each installedPackages as pkg}
              <article class="card">
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
                  <span>{pkg.runtime}</span>
                  <span>cap:{pkg.appType || pkg.type || 'app'}</span>
                  <span>channel:{getLifecycleCurrentChannel(pkg)}</span>
                  <span class="health {getHealthStatus(pkg)}">health:{String(getHealthStatus(pkg)).toUpperCase()}</span>
                  {#if isServicePackage(pkg)}
                    <span class="runtime {getRuntimeState(pkg)?.status || 'stopped'}">{getRuntimeStatusLabel(pkg)}</span>
                  {/if}
                </div>
                <div class="actions">
                  {#if canOpenPackage(pkg)}
                    <button class="btn primary" onclick={() => openInstalledPackage(pkg)}>
                      <Play size={14} />
                      Open
                    </button>
                    <button class="btn ghost" onclick={() => stopInstalledPackage(pkg)}>
                      <Square size={14} />
                      Close Windows
                    </button>
                  {/if}
                  {#if isServicePackage(pkg)}
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'start')} disabled={runtimeActioning === `${pkg.id}:start` || isRuntimeRunning(pkg)}>
                      <Play size={14} />
                      Start
                    </button>
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'stop')} disabled={runtimeActioning === `${pkg.id}:stop` || !isRuntimeRunning(pkg)}>
                      <Square size={14} />
                      Stop Service
                    </button>
                    <button class="btn ghost" onclick={() => controlRuntime(pkg, 'restart')} disabled={runtimeActioning === `${pkg.id}:restart`}>
                      <RotateCcw size={14} />
                      Restart
                    </button>
                    <button class="btn ghost" onclick={() => toggleRuntimeLogs(pkg)} disabled={runtimeLogsLoading === pkg.id}>
                      {runtimeLogsByApp[pkg.id] ? 'Hide Logs' : (runtimeLogsLoading === pkg.id ? 'Loading Logs...' : 'Logs')}
                    </button>
                  {/if}
                  <button class="btn ghost" onclick={() => runHealthCheck(pkg)} disabled={healthLoading === pkg.id}>
                    {healthLoading === pkg.id ? 'Health...' : 'Health'}
                  </button>
                  <button class="btn ghost" onclick={() => toggleOpsConsole(pkg)} disabled={lifecycleLoading === pkg.id || runtimeEventsLoading === pkg.id}>
                    {isConsoleOpen(pkg) ? 'Ops Close' : 'Ops Console'}
                  </button>
                  <button class="btn ghost" onclick={() => cloneInstalledPackage(pkg)}>
                    Clone
                  </button>
                  <button class="btn ghost" onclick={() => downloadInstalledPackage(pkg)}>
                    <Download size={14} />
                    Export
                  </button>
                  <button class="btn danger" onclick={() => removeInstalledPackage(pkg)}>
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
                          <button class="btn tiny danger" onclick={() => rollbackToBackup(pkg)} disabled={lifecycleActioning === `${pkg.id}:rollback`}>
                            {lifecycleActioning === `${pkg.id}:rollback` ? 'Rolling back...' : 'Rollback'}
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
                                  || Boolean(getManifestEditorState(pkg.id)?.preflight?.blocked)
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
</div>

<style>
  .package-center {
    height: 100%;
    padding: 20px;
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 16px;
    color: var(--text-main);
    background:
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 30%),
      linear-gradient(180deg, rgba(7, 14, 26, 0.88) 0%, rgba(5, 9, 18, 0.92) 100%);
    overflow: auto;
  }

  .category-panel {
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: fit-content;
    background: rgba(15, 23, 36, 0.7);
  }

  .panel-title {
    font-size: 13px;
    color: #7dd3fc;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .category {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    background: transparent;
    color: var(--text-main);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .category.active {
    border-color: rgba(14, 165, 233, 0.45);
    background: rgba(14, 165, 233, 0.15);
    color: #dbeafe;
  }

  .content {
    display: grid;
    gap: 12px;
  }

  .feedback {
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13px;
    background: rgba(15, 23, 36, 0.7);
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
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 14px;
    background: rgba(15, 23, 36, 0.7);
    display: grid;
    gap: 12px;
  }

  .block-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .app-model-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .model-chip {
    font-size: 11px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    border-radius: 999px;
    padding: 4px 10px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(2, 6, 23, 0.5);
    color: #e2e8f0;
  }

  .model-chip.system {
    border-color: rgba(56, 189, 248, 0.4);
    color: #bae6fd;
  }

  .model-chip.standard {
    border-color: rgba(129, 140, 248, 0.4);
    color: #c7d2fe;
  }

  .model-chip.package {
    border-color: rgba(52, 211, 153, 0.4);
    color: #bbf7d0;
  }

  .desktop-app-inventory {
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    background: rgba(2, 6, 23, 0.35);
    padding: 10px;
    display: grid;
    gap: 8px;
  }

  .desktop-app-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .desktop-app-head h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .desktop-app-head span {
    font-size: 11px;
    color: #93a7c0;
  }

  .desktop-app-list {
    display: grid;
    gap: 6px;
    max-height: 220px;
    overflow: auto;
    padding-right: 2px;
  }

  .desktop-app-row {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 10px;
    padding: 8px;
    background: rgba(15, 23, 36, 0.45);
    display: grid;
    gap: 6px;
  }

  .desktop-app-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .desktop-app-title {
    font-size: 12px;
    font-weight: 600;
    color: #dbeafe;
  }

  .desktop-app-id {
    font-size: 11px;
    color: #8ba3c5;
  }

  .desktop-app-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .desktop-app-meta span {
    font-size: 11px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 999px;
    padding: 2px 8px;
    color: #d1deef;
    background: rgba(15, 23, 42, 0.5);
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
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
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
    border-radius: 14px;
    padding: 12px;
    display: grid;
    gap: 10px;
    background: rgba(2, 6, 23, 0.45);
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

  .chips .runtime {
    font-weight: 600;
  }

  .chips .runtime.running {
    color: #bbf7d0;
    background: rgba(22, 163, 74, 0.18);
  }

  .chips .runtime.starting,
  .chips .runtime.degraded {
    color: #fde68a;
    background: rgba(202, 138, 4, 0.18);
  }

  .chips .runtime.error {
    color: #fecaca;
    background: rgba(185, 28, 28, 0.2);
  }

  .chips .runtime.stopped {
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.25);
  }

  .chips .health.pass {
    color: #bbf7d0;
    background: rgba(22, 163, 74, 0.18);
  }

  .chips .health.warn {
    color: #fde68a;
    background: rgba(202, 138, 4, 0.18);
  }

  .chips .health.fail,
  .chips .health.error {
    color: #fecaca;
    background: rgba(185, 28, 28, 0.2);
  }

  .chips .health.unknown {
    color: #cbd5e1;
    background: rgba(51, 65, 85, 0.25);
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

  @media (max-width: 1000px) {
    .package-center {
      grid-template-columns: 1fr;
    }

    .source-form {
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
