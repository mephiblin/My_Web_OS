<script>
  import { onMount } from 'svelte';
  import { 
    Folder, File, FileText, ChevronLeft, ChevronRight, RotateCcw, 
    Plus, Trash2, LayoutGrid, List, Pencil, Home, Download, Image, Video, Clock, Package, Box, Lock, Unlock, ShieldAlert,
    Search, Undo, Cloud, Share2, ExternalLink, ArrowDownToLine
  } from 'lucide-svelte';
  import { notifications } from '../../../core/stores/notificationStore.js';
  import { agentStore } from '../../../core/stores/agentStore.js';
  import { openWindow } from '../../../core/stores/windowStore.js';
  import { openContextMenu } from '../../../core/stores/contextMenuStore.js';
  import { addShortcut } from '../../../core/stores/shortcutStore.js';
  import { contextMenuSettings } from '../../../core/stores/contextMenuStore.js';
  import * as fsApi from './api.js';
  import {
    findAssociationMatches,
    getFileExtension,
    inferPreferredActionByExtension,
    resolveOpenPlan
  } from './services/fileAssociations.js';
  import { listTransferJobs, isRunningStatus } from '../transfer/api.js';

  let currentPath = $state('/');
  let initialPath = $state('/');
  let items = $state([]);
  let loading = $state(false);
  let selectedItem = $state(null);
  let viewMode = $state('grid');
  let inventoryPath = $state('');
  let allowedRoots = $state([]);
  let activeFileGrants = $state([]);
  let showGrantPanel = $state(false);
  let lockedFolders = $state(JSON.parse(localStorage.getItem('web_os_locked_folders') || '[]'));

  // Search & Trash State
  let searchQuery = $state('');
  let searchMeta = $state(null);
  let filterQuery = $state('');
  let isSearchView = $state(false);
  let isTrashView = $state(false);
  let cloudRemotes = $state([]);
  let desktopApps = $state([]);
  let transferJobs = $state([]);
  let transferPolling = $state(null);
  let cloudUploadPolling = $state(null);
  let cloudUploadStatusAvailable = $state(true);
  let cancelingUploadIds = $state(new Set());

  // Preview State
  let previewContent = $state(null);
  let showPreview = $state(false);
  let previewLoading = $state(false);

  // Upload State
  let isDragging = $state(false);
  let uploadQueue = $state([]);
  let currentUpload = $state(null);

  // Share State
  let showShareDialog = $state(false);
  let shareTarget = $state(null);
  let shareExpiryHours = $state(24);
  let generatedLink = $state(null);

  // Cloud Connect State
  let showAddCloudDialog = $state(false);
  let cloudName = $state('');
  let cloudUrl = $state('');
  let cloudUser = $state('');
  let cloudPass = $state('');

  let sidebarLinks = $state([
    { id: 'home', label: 'Home', icon: Home, path: '/' },
  ]);

  function notifyApiError(err, fallbackTitle = 'Request Failed') {
    const payload = fsApi.toUserNotification(err, fallbackTitle);
    notifications.add(payload);
  }

  function addToast(message, type = 'info', title = 'File Station') {
    notifications.add({ title, message, type });
  }

  async function refreshTransferStatus() {
    try {
      const payload = await listTransferJobs();
      transferJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    } catch (_err) {
      transferJobs = [];
    }
  }

  const transferRunningCount = $derived(transferJobs.filter((item) => isRunningStatus(item.status)).length);

  const canonicalUploadStatus = (item) => {
    const value = String(item?.status || '').toLowerCase();
    if (value === 'pending') return 'queued';
    if (value === 'uploading' || value === 'active' || value === 'working') return 'running';
    if (value === 'done' || value === 'success' || value === 'complete') return 'completed';
    if (value === 'error') return 'failed';
    if (value === 'cancelled') return 'canceled';
    return value || 'unknown';
  };

  const activeUploadCount = $derived(uploadQueue.filter((item) => ['queued', 'running'].includes(canonicalUploadStatus(item))).length);
  const completedUploadCount = $derived(uploadQueue.filter((item) => canonicalUploadStatus(item) === 'completed').length);

  function isTerminalUploadStatus(status) {
    return ['completed', 'failed', 'canceled'].includes(String(status || '').toLowerCase());
  }

  function isCloudUpload(item) {
    return String(item?.path || '').startsWith('cloud://') || Boolean(item?.cloudJobId);
  }

  function uploadFileName(item) {
    return item?.file?.name || item?.fileName || 'upload.bin';
  }

  function uploadStatusLabel(item) {
    const status = canonicalUploadStatus(item);
    const labels = {
      queued: 'Queued',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      canceled: 'Canceled'
    };
    return labels[status] || 'Unknown';
  }

  function uploadStatusClass(item) {
    const status = canonicalUploadStatus(item);
    if (status === 'completed') return 'success';
    if (status === 'failed') return 'err';
    if (status === 'canceled') return 'canceled';
    if (status === 'running') return 'running';
    return 'pending';
  }

  function shouldShowProgress(item) {
    const status = canonicalUploadStatus(item);
    return status === 'running' || (status === 'queued' && Number(item?.progress || 0) > 0);
  }

  function isUploadCancelable(item) {
    const status = canonicalUploadStatus(item);
    return ['queued', 'running'].includes(status) && item?.cancelUnavailable !== true;
  }

  function applyCloudUploadJob(job) {
    if (!job?.id) return;
    const existing = uploadQueue.find((item) => item.cloudJobId === job.id || item.id === job.id);
    const previousStatus = existing ? canonicalUploadStatus(existing) : '';
    const nextStatus = job.status === 'completed' ? 'done'
      : job.status === 'failed' ? 'error'
      : job.status || 'running';

    if (existing) {
      existing.cloudJobId = job.id;
      existing.status = nextStatus;
      existing.progress = job.progress;
      existing.errorMessage = job.error || '';
      existing.cancelUnavailable = job.cancelable === false;
      existing.fileName = job.fileName || existing.fileName || uploadFileName(existing);
    } else {
      uploadQueue.push({
        id: job.id,
        cloudJobId: job.id,
        file: null,
        fileName: job.fileName || job.id,
        path: job.remote ? `cloud://${job.remote}/${job.path || ''}` : '',
        progress: job.progress,
        status: nextStatus,
        errorMessage: job.error || '',
        cancelUnavailable: job.cancelable === false
      });
    }

    const current = existing || uploadQueue[uploadQueue.length - 1];
    const currentStatus = canonicalUploadStatus(current);
    if (previousStatus && previousStatus !== currentStatus && isTerminalUploadStatus(currentStatus) && !current.notified) {
      current.notified = true;
      if (currentStatus === 'completed') {
        addToast(`Uploaded ${uploadFileName(current)}`, 'success');
        agentStore.notifyUploadComplete();
        if (current.path === currentPath) fetchItems(currentPath);
      } else if (currentStatus === 'failed') {
        agentStore.notifyError(`Upload failed: ${uploadFileName(current)}`);
      }
    }
  }

  async function refreshCloudUploadStatus() {
    if (!cloudUploadStatusAvailable) return;
    try {
      const payload = await fsApi.listCloudUploadJobs();
      const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
      for (const job of jobs) applyCloudUploadJob(job);
      uploadQueue = [...uploadQueue];
      const hasActiveCloudUpload = uploadQueue.some((item) => isCloudUpload(item) && ['queued', 'running'].includes(canonicalUploadStatus(item)));
      if (!hasActiveCloudUpload && cloudUploadPolling) {
        clearInterval(cloudUploadPolling);
        cloudUploadPolling = null;
      }
    } catch (_err) {
      cloudUploadStatusAvailable = false;
    }
  }

  function startCloudUploadPolling() {
    if (cloudUploadPolling || !cloudUploadStatusAvailable) return;
    cloudUploadPolling = setInterval(() => refreshCloudUploadStatus(), 2500);
  }

  function resolvePreferredOpenWith(extension) {
    const ext = String(extension || '').trim().toLowerCase();
    if (!ext) return '';
    const table = $contextMenuSettings?.openWithByExtension || {};
    const preferred = String(table[ext] || '').trim();
    return preferred;
  }

  function resolveAppMeta(appId) {
    const normalizedId = String(appId || '').trim();
    return desktopApps.find((app) => app.id === normalizedId) || null;
  }

  function buildWindowAppForFile(appMeta, appId, item) {
    const source = appMeta && typeof appMeta === 'object' ? appMeta : {};
    return {
      ...source,
      id: source.id || appId,
      title: item?.name || source.title || appId,
      icon: source.icon || FileText,
      singleton: source.singleton === true
    };
  }

  function setDefaultOpenWith(extension, appId) {
    const ext = String(extension || '').trim().toLowerCase();
    const normalizedAppId = String(appId || '').trim();
    if (!ext || !normalizedAppId) return;
    contextMenuSettings.updateSettings({
      openWithByExtension: {
        ...($contextMenuSettings?.openWithByExtension || {}),
        [ext]: normalizedAppId
      }
    });
    const appMeta = resolveAppMeta(normalizedAppId);
    addToast(`.${ext} files will open with ${appMeta?.title || normalizedAppId}.`, 'success');
  }

  function clearDefaultOpenWith(extension) {
    const ext = String(extension || '').trim().toLowerCase();
    if (!ext) return;
    const next = { ...($contextMenuSettings?.openWithByExtension || {}) };
    delete next[ext];
    contextMenuSettings.updateSettings({ openWithByExtension: next });
    addToast(`Default app for .${ext} cleared.`, 'info');
  }

  async function openFileWithApp(item, appId, action) {
    const extension = getFileExtension(item?.name || '');
    const mode = action === 'edit' ? 'readwrite' : 'read';
    const grantResponse = await fsApi.createFileGrant(item.path, mode, appId, 'file-station').catch(() => null);
    const grant = grantResponse?.grant || null;
    if (grant?.id) {
      loadActiveFileGrants().catch(() => {});
    }
    const fileContext = {
      source: 'file-station',
      file: {
        path: item.path,
        name: item.name,
        extension,
        mode
      },
      permissionContext: {
        grantId: grant?.id || '',
        scope: grant?.scope || 'single-file',
        expiresOnWindowClose: true
      }
    };

    const appMeta = resolveAppMeta(appId);
    openWindow(buildWindowAppForFile(appMeta, appId, item), {
      path: item.path,
      fileContext
    });
  }

  async function openFileWithByAppId(item, appId) {
    const extension = getFileExtension(item?.name || '');
    const matches = findAssociationMatches(desktopApps, extension);
    const match = matches.find((candidate) => candidate.appId === appId);
    await openFileWithApp(item, appId, match?.defaultAction || inferPreferredActionByExtension(extension));
  }

  function buildSidebarLinks(homePath, dirs) {
    const links = [
      { id: 'home', label: 'Home', icon: Home, path: homePath },
    ];

    if (dirs.documents?.path) links.push({ id: 'documents', label: 'Documents', icon: FileText, path: dirs.documents.path });
    if (dirs.downloads?.path) links.push({ id: 'downloads', label: 'Downloads', icon: Download, path: dirs.downloads.path });
    if (dirs.pictures?.path) links.push({ id: 'pictures', label: 'Pictures', icon: Image, path: dirs.pictures.path });
    if (dirs.videos?.path) links.push({ id: 'videos', label: 'Videos', icon: Video, path: dirs.videos.path });
    if (dirs.music?.path) links.push({ id: 'music', label: 'Music', icon: Clock, path: dirs.music.path });

    // Always add Inventory and Trash
    if (inventoryPath) {
      links.push({ id: 'inventory', label: 'Inventory', icon: Package, path: inventoryPath });
    }
    
    // Add Cloud Remotes
    cloudRemotes.forEach(remote => {
      links.push({
        id: `cloud-${remote.name}`,
        label: remote.name,
        icon: Cloud,
        path: `cloud://${remote.name}/`,
        mountStatus: String(remote?.mountStatus || 'unmounted').toLowerCase(),
        mountUrl: String(remote?.mountUrl || '')
      });
    });

    links.push({ id: 'trash', label: 'Trash', icon: Trash2, path: 'trash' });

    return links;
  }

  async function loadActiveFileGrants() {
    try {
      const response = await fsApi.fetchActiveFileGrants('file-station');
      activeFileGrants = Array.isArray(response?.grants) ? response.grants : [];
    } catch (_err) {
      activeFileGrants = [];
    }
  }

  function handleContextMenu(e, item) {
    e.preventDefault();
    e.stopPropagation();
    selectedItem = item;
    
    let itemsInfo = [];
    if (isTrashView && item) {
      itemsInfo = [
        { label: 'Restore', icon: Undo, action: () => handleRestore(item) },
        { label: 'Erase Permanently', icon: Trash2, action: () => notifications.add({ title: 'Safety', message: 'Use Empty Trash to clear all items permanently.', type: 'info' }), danger: true }
      ];
    } else if (item) {
      const isLocked = lockedFolders.includes(item.path);
      const extension = item?.isDirectory ? '' : getFileExtension(item.name);
      const associationMatches = item?.isDirectory ? [] : findAssociationMatches(desktopApps, extension);
      const preferredApp = resolvePreferredOpenWith(extension);
      itemsInfo = [
        { label: 'Open', icon: Folder, action: () => handleDblClick(item) },
        ...(!item.isDirectory && associationMatches.length > 0
          ? associationMatches.slice(0, 6).map((match) => {
            const appMeta = match.app || resolveAppMeta(match.appId);
            return {
              label: `Open With ${appMeta?.title || match.appId}`,
              icon: LayoutGrid,
              action: () => openFileWithByAppId(item, match.appId)
            };
          })
          : []),
        ...(!item.isDirectory && associationMatches.length > 0
          ? associationMatches.slice(0, 6).map((match) => {
            const appMeta = match.app || resolveAppMeta(match.appId);
            return {
              label: `Always Open .${extension} With ${appMeta?.title || match.appId}`,
              icon: ShieldAlert,
              action: () => setDefaultOpenWith(extension, match.appId)
            };
          })
          : []),
        ...(!item.isDirectory && preferredApp
          ? [{ label: `Clear Default App for .${extension}`, icon: RotateCcw, action: () => clearDefaultOpenWith(extension) }]
          : []),
        { label: 'Rename', icon: Pencil, action: () => handleRename(item) },
        { label: 'Create Desktop Shortcut', icon: ExternalLink, action: () => addShortcut(item) },
        ...(item.name.toLowerCase().endsWith('.zip') ? [{ label: 'Extract Here', icon: Package, action: () => handleExtract(item) }] : []),
        { 
          label: isLocked ? 'Unlock Folder' : 'Secure Folder', 
          icon: isLocked ? Unlock : Lock, 
          action: () => toggleLockFolder(item) 
        },
        ...(!item.isDirectory ? [{ label: 'Share Link', icon: Share2, action: () => openShareDialog(item) }] : []),
        { label: 'Move to Trash', icon: Trash2, action: handleDelete, danger: true }
      ];
    } else if (isTrashView) {
      itemsInfo = [
        { label: 'Empty Trash', icon: Trash2, action: handleEmptyTrash, danger: true },
        { label: 'Refresh', icon: RotateCcw, action: fetchTrash }
      ];
    } else {
      itemsInfo = [
        { label: 'New File', icon: FileText, action: createFile },
        { label: 'New Folder', icon: Plus, action: createFolder },
        { label: 'Refresh', icon: RotateCcw, action: () => fetchItems(currentPath) }
      ];
    }

    openContextMenu(e.clientX, e.clientY, itemsInfo);
  }

  async function fetchItems(path) {
    loading = true;
    isSearchView = false;
    isTrashView = false;
    filterQuery = '';
    try {
      if (path === 'trash') {
        return fetchTrash();
      }

      // Handle Cloud Paths (cloud://remote/path)
      if (path.startsWith('cloud://')) {
        const parts = path.replace('cloud://', '').split('/');
        const remote = parts[0];
        const remotePath = parts.slice(1).join('/');
        const remoteMeta = cloudRemotes.find((item) => item?.name === remote) || null;
        const mountStatus = String(remoteMeta?.mountStatus || '').toLowerCase();
        if (!remoteMeta || mountStatus !== 'mounted') {
          notifications.add({
            title: 'Cloud',
            message: `Mounting ${remote}...`,
            type: 'info'
          });
          await fsApi.mountCloudRemote(remote);
          cloudRemotes = await fsApi.fetchCloudRemotes();
          const userDirs = await fsApi.fetchUserDirs();
          sidebarLinks = buildSidebarLinks(userDirs.home || initialPath, userDirs);
        }
        const data = await fsApi.listCloudDir(remote, remotePath);
        items = data.map(item => ({
          ...item,
          path: `cloud://${remote}/${item.path}` // Keep virtual path consistency
        }));
        currentPath = path;
        return;
      }

      const data = await fsApi.listDir(path);
      if (!data.error) {
        items = data.items;
        currentPath = data.path;
      }
    } catch (err) {
      notifyApiError(err, 'Browse Failed');
    } finally {
      loading = false;
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    loading = true;
    isSearchView = true;
    isTrashView = false;
    showPreview = false;
    filterQuery = '';
    try {
      const data = await fsApi.searchFiles(searchQuery, currentPath);
      items = data.items || [];
      searchMeta = data.meta || null;
    } catch (err) {
      notifyApiError(err, 'Search Failed');
    } finally {
      loading = false;
    }
  }

  // Reactive derived state for filtered items
  let filteredItems = $derived.by(() => {
    if (!isSearchView || !filterQuery.trim()) return items;
    const f = filterQuery.toLowerCase();
    return items.filter(item => item.name.toLowerCase().includes(f));
  });

  function openShareDialog(item) {
    shareTarget = item;
    generatedLink = null;
    showShareDialog = true;
  }

  async function generateShareLink() {
    try {
      const res = await fsApi.createShareLink(shareTarget.path, shareExpiryHours);
      if (res.success) {
        generatedLink = `${window.location.origin}/api/share/download/${res.linkId}`;
      }
    } catch (e) {
      notifyApiError(e, 'Share Failed');
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(generatedLink);
    notifications.add({ title: 'Share', message: 'Link copied to clipboard', type: 'success' });
  }

  async function handleExtract(item) {
    if (!item.name.toLowerCase().endsWith('.zip')) return;
    try {
      loading = true;
      notifications.add({ title: 'Extracting...', message: item.name, type: 'info' });
      const res = await fsApi.extractArchive(item.path);
      if (res.success) {
        notifications.add({ title: 'Extracted', message: item.name, type: 'success' });
        agentStore.triggerEmotion('happy', `Extracted ${item.name}!`, 3000);
        fetchItems(currentPath);
      }
    } catch (err) {
      notifyApiError(err, 'Extract Failed');
      agentStore.notifyError('Archive extraction failed.');
    } finally {
      loading = false;
    }
  }

  async function fetchTrash() {
    loading = true;
    isTrashView = true;
    isSearchView = false;
    currentPath = 'trash';
    try {
      const data = await fsApi.fetchTrash();
      items = data.map(item => ({
        ...item,
        name: item.fileName,
        path: item.id, // Use ID for trash operations
        isDirectory: false // Simplification: display as files
      }));
    } catch (err) {
      notifyApiError(err, 'Trash Failed');
    } finally {
      loading = false;
    }
  }

  async function handleRestore(item) {
    try {
      await fsApi.restoreItem(item.id);
      notifications.add({ title: 'Trash', message: `Restored ${item.name}`, type: 'success' });
      fetchTrash();
    } catch (err) {
      notifyApiError(err, 'Restore Failed');
    }
  }

  async function handleEmptyTrash() {
    if (!confirm('Are you sure you want to permanently delete all items in trash?')) return;
    try {
      await fsApi.emptyTrash();
      notifications.add({ title: 'Trash', message: 'Trash emptied.', type: 'success' });
      fetchTrash();
    } catch (err) {
      notifyApiError(err, 'Empty Trash Failed');
    }
  }

  async function handleDblClick(item) {
    if (isTrashView) return;

    // Cloud support for dblclick
    if (currentPath.startsWith('cloud://')) {
      if (item.isDirectory) {
        fetchItems(item.path);
      } else {
        notifications.add({ title: 'Cloud', message: 'Fetching cloud file...', type: 'info' });
        const remote = currentPath.replace('cloud://', '').split('/')[0];
        const remotePath = item.path.replace(`cloud://${remote}/`, '');
        try {
          const res = await fsApi.readCloudFile(remote, remotePath);
          openWindow({ id: 'editor', title: `Cloud Edit - ${item.name}`, icon: FileText }, { content: res.content, readonly: true });
        } catch (e) {
          notifyApiError(e, 'Cloud Read Failed');
        }
      }
      return;
    }

    if (item.isDirectory) {
      if (lockedFolders.includes(item.path)) {
        const password = prompt(`'${item.name}' is a Secure Folder. Enter Password:`);
        if (password === '1234') { // Mock password
          notifications.add({ title: 'Security', message: `Authorized access to ${item.name}`, type: 'success' });
          fetchItems(item.path);
        } else {
          notifications.add({ title: 'Security', message: `Unauthorized access attempt! Incorrect password.`, type: 'error' });
        }
        return;
      }
      fetchItems(item.path);
    } else {
      const extension = getFileExtension(item.name);
      const preferredApp = resolvePreferredOpenWith(extension);
      const plan = resolveOpenPlan(desktopApps, extension, preferredApp);
      await openFileWithApp(item, plan.appId, plan.action);
    }
  }

  async function handleItemClick(e, item) {
    e.stopPropagation();
    selectedItem = item;
    
    if (!item.isDirectory && !isTrashView) {
       const ext = item.name.split('.').pop()?.toLowerCase();
       const isCode = ['md', 'txt', 'js', 'json', 'css', 'html', 'svelte'].includes(ext);
       if (isCode) {
           showPreview = true;
           previewLoading = true;
           previewContent = 'Loading...';
           try {
             // For cloud files we'd need readCloudFile but let's assume local local files for side preview first
             // or we can handle cloud file generic
             let res;
             if (currentPath.startsWith('cloud://')) {
                const remote = currentPath.replace('cloud://', '').split('/')[0];
                const remotePath = item.path.replace(`cloud://${remote}/`, '');
                res = await fsApi.readCloudFile(remote, remotePath);
             } else {
                res = await fsApi.readFile(item.path);
             }
             previewContent = res.content;
           } catch (err) {
             previewContent = 'Cannot render preview.';
             notifyApiError(err, 'Preview Failed');
           } finally {
             previewLoading = false;
           }
       } else {
           showPreview = false;
           previewContent = null;
       }
    } else {
       showPreview = false;
    }
  }

  function goBack() {
    const parts = currentPath.split('/');
    parts.pop();
    const parentPath = parts.join('/') || '/';
    fetchItems(parentPath);
  }

  function generateId() { return Math.random().toString(36).substr(2, 9); }

  function createUploadCanceledError() {
    const err = new Error('Upload canceled.');
    err.code = 'UPLOAD_CANCELED';
    return err;
  }

  function resolveCloudPathParts(path) {
    const normalized = String(path || '').replace(/^cloud:\/\//, '');
    const segments = normalized.split('/');
    const remote = String(segments.shift() || '').trim();
    const remotePath = segments.join('/');
    return { remote, remotePath };
  }

  function handleDragOver(e) {
    e.preventDefault();
    isDragging = true;
  }
  function handleDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    isDragging = false;
  }
  async function handleDrop(e) {
    e.preventDefault();
    isDragging = false;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
         uploadQueue.push({ file, path: currentPath, progress: 0, status: 'pending', id: generateId() });
      }
      uploadQueue = [...uploadQueue];
      processUploadQueue();
    }
  }

  async function processUploadQueue() {
    if (currentUpload) return;
    const next = uploadQueue.find(u => u.status === 'pending');
    if (!next) return;

    currentUpload = next;
    currentUpload.status = isCloudUpload(currentUpload) ? 'running' : 'uploading';
    uploadQueue = [...uploadQueue];

    let deferredCloudJob = false;
    try {
      if (String(currentUpload.path || '').startsWith('cloud://')) {
        const { remote, remotePath } = resolveCloudPathParts(currentUpload.path);
        if (!remote) {
          throw new Error('Invalid cloud remote path.');
        }
        if (currentUpload.status === 'canceled') {
          throw createUploadCanceledError();
        }
        const result = await fsApi.uploadCloudFile(remote, remotePath, currentUpload.file);
        const job = result?.cloudUploadJob || null;
        if (job?.id) {
          currentUpload.cloudJobId = job.id;
          currentUpload.status = job.status || 'running';
          currentUpload.progress = job.progress || 0;
          currentUpload.errorMessage = job.error || '';
          currentUpload.cancelUnavailable = job.cancelable === false;
          uploadQueue = [...uploadQueue];

          if (!isTerminalUploadStatus(canonicalUploadStatus(currentUpload))) {
            cloudUploadStatusAvailable = true;
            startCloudUploadPolling();
            deferredCloudJob = true;
          }
        }
        const cloudStatus = canonicalUploadStatus(currentUpload);
        if (!deferredCloudJob && cloudStatus === 'canceled') {
          throw createUploadCanceledError();
        }
        if (!deferredCloudJob && cloudStatus === 'failed') {
          throw new Error(currentUpload.errorMessage || 'Cloud upload failed.');
        }
        if (!deferredCloudJob && cloudStatus === 'completed') {
          currentUpload.progress = 100;
          uploadQueue = [...uploadQueue];
        }
      } else {
        const chunkSize = 1024 * 1024 * 5; // 5MB
        const totalChunks = Math.max(1, Math.ceil(currentUpload.file.size / chunkSize));
        const uploadId = currentUpload.id;

        for (let i = 0; i < totalChunks; i++) {
           if (currentUpload.status === 'canceled') {
             throw createUploadCanceledError();
           }
           const start = i * chunkSize;
           const end = Math.min(start + chunkSize, currentUpload.file.size);
           const chunk = currentUpload.file.slice(start, end);

           await fsApi.uploadChunk(currentUpload.path, chunk, uploadId, i, totalChunks, currentUpload.file.name);
           currentUpload.progress = Math.round(((i + 1) / totalChunks) * 100);
           uploadQueue = [...uploadQueue];
        }
      }
      if (!deferredCloudJob) {
        currentUpload.status = 'done';
        addToast(`Uploaded ${uploadFileName(currentUpload)}`, 'success');
        agentStore.notifyUploadComplete();
        if (currentUpload.path === currentPath) fetchItems(currentPath);
      }
    } catch (e) {
      if (e?.code === 'UPLOAD_CANCELED') {
        currentUpload.status = 'canceled';
        currentUpload.errorMessage = '';
      } else {
        currentUpload.status = 'error';
        currentUpload.errorMessage = e?.message || 'Upload failed.';
        notifyApiError(e, 'Upload Failed');
        agentStore.notifyError(`Upload failed: ${uploadFileName(currentUpload)}`);
      }
    }

    currentUpload = null;
    uploadQueue = [...uploadQueue];
    processUploadQueue();
  }

  function clearUploads() {
    uploadQueue = uploadQueue.filter((u) => ['queued', 'running'].includes(canonicalUploadStatus(u)));
  }

  async function cancelUpload(uploadId) {
    const target = uploadQueue.find((item) => item.id === uploadId);
    if (!target) return;

    if (!isUploadCancelable(target)) return;

    if (target.cloudJobId) {
      const nextSet = new Set(cancelingUploadIds);
      nextSet.add(uploadId);
      cancelingUploadIds = nextSet;
      try {
        await fsApi.cancelCloudUploadJob(target.cloudJobId);
        target.status = 'canceled';
        target.errorMessage = '';
        addToast(`Cancel accepted for ${uploadFileName(target)}`, 'info');
      } catch (err) {
        target.cancelUnavailable = true;
        target.errorMessage = err?.message || 'Cancel unavailable for this upload.';
        notifyApiError(err, 'Cloud Upload Cancel Failed');
      } finally {
        const doneSet = new Set(cancelingUploadIds);
        doneSet.delete(uploadId);
        cancelingUploadIds = doneSet;
        uploadQueue = [...uploadQueue];
      }
      return;
    }

    if (isCloudUpload(target) && canonicalUploadStatus(target) === 'running') {
      target.cancelUnavailable = true;
      target.errorMessage = 'Cancel unavailable until the backend exposes this upload as a job.';
      addToast('Cancel is unavailable for this cloud upload.', 'warning');
      uploadQueue = [...uploadQueue];
      return;
    }

    if (['queued', 'running'].includes(canonicalUploadStatus(target))) {
      target.status = 'canceled';
      target.errorMessage = '';
      uploadQueue = [...uploadQueue];
      addToast(`Cancel accepted for ${uploadFileName(target)}`, 'info');
    }
  }

  function retryUpload(uploadId) {
    const target = uploadQueue.find((item) => item.id === uploadId);
    if (!target) return;
    const status = canonicalUploadStatus(target);
    if (status === 'failed' || status === 'canceled') {
      target.status = 'pending';
      target.progress = 0;
      target.errorMessage = '';
      target.cloudJobId = '';
      target.cancelUnavailable = false;
      target.notified = false;
      uploadQueue = [...uploadQueue];
      processUploadQueue();
    }
  }

  async function createFile() {
    const name = prompt('Enter file name:');
    if (!name) return;
    try {
      await fsApi.writeFile(`${currentPath}/${name}`, '');
      fetchItems(currentPath);
    } catch (err) {
      notifyApiError(err, 'Save Failed');
    }
  }

  async function createFolder() {
    const name = prompt('Enter folder name:');
    if (!name) return;
    try {
      await fsApi.createDir(`${currentPath}/${name}`);
      fetchItems(currentPath);
    } catch (err) {
      notifyApiError(err, 'Create Folder Failed');
    }
  }

  async function handleDelete() {
    if (!selectedItem) return;
    if (!confirm(`Delete ${selectedItem.name}?`)) return;
    try {
      await fsApi.deleteItem(selectedItem.path);
      agentStore.triggerEmotion('alert', `Deleted ${selectedItem.name}`, 3000);
      selectedItem = null;
      fetchItems(currentPath);
    } catch (err) {
      notifyApiError(err, 'Delete Failed');
      agentStore.notifyError(`Failed to delete ${selectedItem?.name || 'item'}.`);
    }
  }

  async function handleRename(item) {
    const target = item || selectedItem;
    if (!target) return;
    const newName = prompt('Enter new name:', target.name);
    if (!newName || newName === target.name) return;
    try {
      await fsApi.renameItem(target.path, newName);
      selectedItem = null;
      fetchItems(currentPath);
    } catch (err) {
      notifyApiError(err, 'Rename Failed');
    }
  }

  function toggleLockFolder(item) {
    if (lockedFolders.includes(item.path)) {
      lockedFolders = lockedFolders.filter(p => p !== item.path);
    } else {
      lockedFolders = [...lockedFolders, item.path];
    }
    localStorage.setItem('web_os_locked_folders', JSON.stringify(lockedFolders));
  }

  function handlePathKeydown(e) {
    if (e.key === 'Enter') fetchItems(currentPath);
  }

  onMount(async () => {
    try {
      const [config, userDirs, remotes, apps, grants] = await Promise.all([
        fsApi.fetchConfig(),
        fsApi.fetchUserDirs(),
        fsApi.fetchCloudRemotes(),
        fsApi.fetchDesktopApps(),
        fsApi.fetchActiveFileGrants('file-station').catch(() => ({ grants: [] }))
      ]);

      if (config.initialPath) {
        initialPath = config.initialPath;
        currentPath = initialPath;
      }
      allowedRoots = Array.isArray(config.allowedRoots) ? config.allowedRoots : [];

      cloudRemotes = remotes || [];
      desktopApps = Array.isArray(apps) ? apps : [];
      activeFileGrants = Array.isArray(grants?.grants) ? grants.grants : [];
      inventoryPath = userDirs._inventoryPath || '';
      sidebarLinks = buildSidebarLinks(userDirs.home || initialPath, userDirs);
    } catch (e) {
      notifyApiError(e, 'File Station Load Failed');
    }
    fetchItems(currentPath);
    refreshTransferStatus();
    transferPolling = setInterval(() => refreshTransferStatus(), 3000);
    refreshCloudUploadStatus();
    return () => {
      if (transferPolling) clearInterval(transferPolling);
      if (cloudUploadPolling) clearInterval(cloudUploadPolling);
    };
  });

  async function handleAddCloud() {
    if (!cloudName.trim() || !cloudUrl.trim()) {
      notifications.add({ title: 'Cloud Connect Failed', message: 'Name and URL are required.', type: 'error' });
      return;
    }
    loading = true;
    try {
      const res = await fsApi.addWebDAV(cloudName.trim(), cloudUrl.trim(), cloudUser.trim(), cloudPass.trim());
      if (res.success) {
        notifications.add({ title: 'Success', message: 'Network location added.', type: 'success' });
        showAddCloudDialog = false;
        
        // Refresh sidebar
        const [userDirs, remotes] = await Promise.all([fsApi.fetchUserDirs(), fsApi.fetchCloudRemotes()]);
        cloudRemotes = remotes || [];
        sidebarLinks = buildSidebarLinks(userDirs.home || initialPath, userDirs);
        
        // Reset form
        cloudName = ''; cloudUrl = ''; cloudUser = ''; cloudPass = '';
      } else {
        notifyApiError(res, 'Cloud Connect Failed');
      }
    } catch (e) {
      notifyApiError(e, 'Cloud Connect Failed');
    } finally {
      loading = false;
    }
  }
</script>

<div
  class="file-explorer"
  role="button"
  aria-label="File Station workspace"
  tabindex="-1"
  oncontextmenu={(e) => handleContextMenu(e, null)}
  onclick={() => selectedItem = null}
  onkeydown={(event) => {
    if (event.key === 'Escape') selectedItem = null;
  }}
>
  <div class="toolbar">
    <div class="nav-controls">
      <button onclick={goBack} disabled={currentPath === '/'}><ChevronLeft size={16} /></button>
      <button disabled><ChevronRight size={16} /></button>
      <button onclick={() => fetchItems(currentPath)}><RotateCcw size={16} /></button>
    </div>
    <div class="path-bar">
      {#if isSearchView}
        <div class="search-indicator">
          <Search size={14} />
          <span class="search-text">
            "{searchQuery}" in {currentPath}
            {#if searchMeta}
              <span class="search-meta">({searchMeta.total} results via {searchMeta.source})</span>
            {/if}
          </span>
          <input 
            type="text" 
            class="filter-input" 
            placeholder="Filter results..." 
            bind:value={filterQuery} 
          />
          <button class="clear-search" onclick={() => fetchItems(currentPath)}>X</button>
        </div>
      {:else if isTrashView}
        <div class="trash-indicator">
          <Trash2 size={14} />
          <span>Trash Bin</span>
          <button class="empty-trash-btn" onclick={handleEmptyTrash}>Empty Trash</button>
        </div>
      {:else}
        <input type="text" bind:value={currentPath} onkeydown={handlePathKeydown} />
      {/if}
    </div>
    <div class="search-box">
      <input 
        type="text" 
        placeholder="Search files..." 
        bind:value={searchQuery} 
        onkeydown={(e) => e.key === 'Enter' && handleSearch()}
      />
      <button onclick={handleSearch}><Search size={16} /></button>
    </div>
    <div class="actions">
      <button title="Transfer Manager" onclick={() => openWindow({ id: 'transfer', title: 'Transfer', icon: ArrowDownToLine, singleton: true })}>
        <ArrowDownToLine size={16} />
        {#if transferRunningCount > 0}
          <span class="transfer-badge">{transferRunningCount}</span>
        {/if}
      </button>
      <button class={viewMode === 'grid' ? 'active' : ''} onclick={() => viewMode = 'grid'}><LayoutGrid size={16} /></button>
      <button class={viewMode === 'list' ? 'active' : ''} onclick={() => viewMode = 'list'}><List size={16} /></button>
      <div class="separator"></div>
      <button title="New File" onclick={createFile}><FileText size={16} /></button>
      <button title="New Folder" onclick={createFolder}><Plus size={16} /></button>
      <button title="Delete" class="delete" onclick={handleDelete} disabled={!selectedItem}><Trash2 size={16} /></button>
    </div>
  </div>

  <div class="layout-body">
    <aside class="sidebar glass-effect">
      <div class="sidebar-section">
        <h3>Places</h3>
        {#if allowedRoots.length > 0}
          <button
            class="allowed-roots-hint"
            onclick={() => (showGrantPanel = !showGrantPanel)}
            title="Show allowed roots and active file grants"
          >
            Allowed roots: {allowedRoots.length} | Active grants: {activeFileGrants.length}
          </button>
          {#if showGrantPanel}
            <div class="grants-panel">
              <div class="grants-label">Allowed Roots</div>
              <div class="grants-list">
                {#each allowedRoots as root}
                  <code>{root}</code>
                {/each}
              </div>
              <div class="grants-label">Active File Grants (file-station)</div>
              {#if activeFileGrants.length === 0}
                <div class="runtime-log-empty">No active grants.</div>
              {:else}
                <div class="grants-list">
                  {#each activeFileGrants as grant}
                    <div class="grant-row">
                      <span>{grant.mode}</span>
                      <code>{grant.path}</code>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/if}
        {#each sidebarLinks as link}
          {@const LinkIcon = link.icon}
          <button
            class="sidebar-item {currentPath === link.path ? 'active' : ''}" 
            onclick={() => fetchItems(link.path)}
          >
            <LinkIcon size={16} />
            <span>{link.label}</span>
            {#if link.id.startsWith('cloud-')}
              <span class="cloud-status {link.mountStatus || 'unmounted'}" title={link.mountUrl || (link.mountStatus || 'unmounted')}>
                {link.mountStatus === 'mounted' ? 'mounted' : (link.mountStatus || 'unmounted')}
              </span>
            {/if}
          </button>
        {/each}
        <div style="height: 12px;"></div>
        <button class="sidebar-item add-cloud-btn" onclick={() => showAddCloudDialog = true}>
          <Plus size={16} />
          <span>Add Network Drive</span>
        </button>
      </div>
    </aside>

    <div class="content-area {isDragging ? 'dragging' : ''}"
         role="presentation"
         ondragover={handleDragOver}
         ondragleave={handleDragLeave}
         ondrop={handleDrop}>
      {#if loading}
        <div class="loading">Loading...</div>
      {:else}
        <div class="view-container {viewMode}">
          {#each filteredItems as item}
            <div
              class="item {selectedItem?.path === item.path ? 'selected' : ''}"
              role="button"
              tabindex="0"
              onclick={(e) => handleItemClick(e, item)}
              ondblclick={() => handleDblClick(item)}
              oncontextmenu={(e) => handleContextMenu(e, item)}
              onkeydown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleDblClick(item);
                } else if (event.key === ' ') {
                  event.preventDefault();
                  handleItemClick(event, item);
                }
              }}
            >
              <div class="icon">
                {#if item.isDirectory}
                  <div class="folder-wrapper">
                    <Folder size={viewMode === 'list' ? 32 : 48} color="var(--accent-blue)" fill="var(--accent-blue)" fill-opacity="0.2" />
                    {#if lockedFolders.includes(item.path)}
                      <div class="lock-overlay" title="Secure Folder">
                        <Lock size={viewMode === 'list' ? 10 : 14} color="white" />
                      </div>
                    {/if}
                  </div>
                {:else if isTrashView}
                  <Trash2 size={viewMode === 'list' ? 32 : 48} color="var(--accent-red)" />
                {:else}
                  <File size={viewMode === 'list' ? 32 : 48} color="var(--text-dim)" />
                {/if}
              </div>
              <div class="item-info">
                <span class="name">{item.name}</span>
                {#if isSearchView}
                  <span class="original-path">{item.path}</span>
                {:else if isTrashView && item.deletedAt}
                  <span class="delete-date">Deleted: {new Date(item.deletedAt).toLocaleDateString()}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if showPreview && previewContent !== null}
       <aside class="preview-panel glass-effect">
         <div class="preview-header">
           <span class="preview-title">{selectedItem?.name}</span>
           <button class="close-btn" onclick={() => showPreview = false}>X</button>
         </div>
         {#if previewLoading}
           <div class="preview-loading">Loading preview...</div>
         {:else}
           <pre class="preview-content"><code>{previewContent}</code></pre>
         {/if}
       </aside>
    {/if}
  </div>

  {#if uploadQueue.length > 0}
  <div class="upload-popover glass-effect">
    <div class="popover-header">
       <span>Transfers ({completedUploadCount}/{uploadQueue.length}){#if activeUploadCount > 0} <em>{activeUploadCount} active</em>{/if}</span>
       <button onclick={clearUploads}>X</button>
    </div>
    <div class="upload-list">
       {#each uploadQueue as u}
         <div class="upload-item">
           <span class="u-name" title={uploadFileName(u)}>{uploadFileName(u)}</span>
           {#if shouldShowProgress(u)}
             <div class="u-progress-bg">
               <div class="u-progress-bar" style="width: {u.progress}%"></div>
             </div>
           {:else}
             <span class="u-status {uploadStatusClass(u)}">{uploadStatusLabel(u)}</span>
           {/if}
           {#if isUploadCancelable(u)}
             <button
               class="u-action danger"
               onclick={() => cancelUpload(u.id)}
               disabled={cancelingUploadIds.has(u.id)}
               title="Cancel upload"
             >
               {cancelingUploadIds.has(u.id) ? 'Canceling' : 'Cancel'}
             </button>
           {:else if canonicalUploadStatus(u) === 'failed' || canonicalUploadStatus(u) === 'canceled'}
             <button class="u-action" onclick={() => retryUpload(u.id)} title="Retry upload">Retry</button>
           {/if}
         </div>
         {#if u.errorMessage}
           <div class="u-error">{u.errorMessage}</div>
         {/if}
       {/each}
    </div>
  </div>
  {/if}

  {#if showShareDialog}
    <div class="share-dialog-overlay" onclick={() => showShareDialog = false} role="presentation">
      <div class="share-dialog glass-effect" onclick={(e) => e.stopPropagation()} role="presentation">
         <div class="share-header">Share Link</div>
         <div class="share-body">
           <p class="share-target">File: <strong>{shareTarget.name}</strong></p>
           {#if generatedLink}
             <div class="link-box">
                <input class="link-input" readonly value={generatedLink} onclick={(e) => e.target.select()} />
                <button class="copy-btn" onclick={copyLink}>Copy</button>
             </div>
             <p class="expiry-msg">Link expires in: {shareExpiryHours > 0 ? shareExpiryHours + ' hours' : 'Never'}</p>
           {:else}
             <label class="share-label" for="expirySelect">Expires in:</label>
             <select id="expirySelect" class="share-select" bind:value={shareExpiryHours}>
               <option value={1}>1 Hour</option>
               <option value={24}>1 Day (24 Hours)</option>
               <option value={168}>1 Week (168 Hours)</option>
               <option value={0}>Never Expires</option>
             </select>
           {/if}
         </div>
         <div class="share-footer">
           {#if !generatedLink}
             <button class="share-btn cancel" onclick={() => showShareDialog = false}>Cancel</button>
             <button class="share-btn primary" onclick={generateShareLink}>Generate Link</button>
           {:else}
             <button class="share-btn primary" onclick={() => showShareDialog = false}>Close</button>
           {/if}
         </div>
      </div>
    </div>
  {/if}

  {#if showAddCloudDialog}
    <div class="share-dialog-overlay" onclick={() => showAddCloudDialog = false} role="presentation">
      <div class="share-dialog glass-effect" onclick={(e) => e.stopPropagation()} role="presentation">
         <div class="share-header">Add Network Drive (WebDAV)</div>
         <div class="share-body" style="gap: 8px;">
           <label class="share-label" style="text-align: left;" for="cloudName">Name (Alias)</label>
           <input id="cloudName" class="link-input" type="text" placeholder="e.g. MyNAS" bind:value={cloudName} />
           
           <label class="share-label" style="text-align: left;" for="cloudUrl">WebDAV URL</label>
           <input id="cloudUrl" class="link-input" type="text" placeholder="http://192.168.1.100:5005/webdav" bind:value={cloudUrl} />
           
           <label class="share-label" style="text-align: left;" for="cloudUser">Username (Optional)</label>
           <input id="cloudUser" class="link-input" type="text" placeholder="admin" bind:value={cloudUser} />
           
           <label class="share-label" style="text-align: left;" for="cloudPass">Password (Optional)</label>
           <input id="cloudPass" class="link-input" type="password" placeholder="password123" bind:value={cloudPass} />
         </div>
         <div class="share-footer">
           <button class="share-btn cancel" onclick={() => showAddCloudDialog = false}>Cancel</button>
           <button class="share-btn primary" default onclick={handleAddCloud}>Connect</button>
         </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .file-explorer { display: flex; flex-direction: column; height: 100%; color: var(--text-main); }
  .toolbar { height: 48px; background: rgba(0,0,0,0.2); display: flex; align-items: center; padding: 0 12px; gap: 12px; border-bottom: 1px solid var(--glass-border); }
  .nav-controls, .actions { display: flex; gap: 4px; }
  .toolbar button { background: transparent; border: none; color: var(--text-dim); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px; cursor: pointer; }
  .toolbar button { position: relative; }
  .toolbar button:hover { background: rgba(255,255,255,0.1); color: white; }
  .toolbar button.active { background: rgba(255,255,255,0.15); color: var(--accent-blue); }
  .toolbar button:disabled { opacity: 0.3; cursor: not-allowed; }
  .transfer-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 14px;
    height: 14px;
    border-radius: 999px;
    background: var(--accent-blue);
    color: #fff;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0 3px;
  }
  .separator { width: 1px; background: var(--glass-border); margin: 0 4px; height: 24px; align-self: center; }
  
  .path-bar { flex: 1; min-width: 0; }
  .path-bar input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 4px; color: white; padding: 4px 12px; font-size: 13px; }
  
  .search-box { display: flex; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 4px; padding: 2px 4px; gap: 4px; }
  .search-box input { background: transparent; border: none; color: white; padding: 2px 8px; font-size: 12px; width: 150px; outline: none; }
  
  .search-indicator, .trash-indicator { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 4px; font-size: 12px; flex: 1; }
  .search-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .search-meta { opacity: 0.6; font-size: 11px; margin-left: 4px; }
  .filter-input { background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 4px; color: white; padding: 2px 8px; font-size: 11px; width: 120px; outline: none; transition: width 0.3s; }
  .filter-input:focus { width: 180px; border-color: var(--accent-blue); }
  .clear-search, .empty-trash-btn { background: rgba(255,255,255,0.1) !important; padding: 2px 8px !important; width: auto !important; height: auto !important; font-size: 10px !important; }

  .layout-body { flex: 1; display: flex; overflow: hidden; }
  .sidebar { width: 180px; background: rgba(0,0,0,0.15); border-right: 1px solid var(--glass-border); display: flex; flex-direction: column; padding: 12px 8px; flex-shrink: 0; }
  .sidebar-section h3 { font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin: 0 0 8px 8px; letter-spacing: 0.5px; }
  .allowed-roots-hint {
    font-size: 11px;
    color: var(--text-dim);
    margin: 0 0 8px 8px;
    opacity: 0.9;
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    padding: 6px 8px;
    width: calc(100% - 16px);
    text-align: left;
    cursor: pointer;
  }
  .allowed-roots-hint:hover {
    background: rgba(255,255,255,0.08);
    color: var(--text-main);
  }
  .grants-panel {
    margin: 0 0 10px 8px;
    padding: 8px;
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    background: rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .grants-label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
  }
  .grants-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 120px;
    overflow: auto;
  }
  .grants-list code {
    font-size: 10px;
    color: #dbeafe;
    word-break: break-all;
  }
  .grant-row {
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .grant-row span {
    font-size: 10px;
    color: #9fb3cc;
    text-transform: uppercase;
  }
  .sidebar-item { background: transparent; border: none; color: var(--text-main); display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; cursor: pointer; width: 100%; text-align: left; font-size: 13px; transition: all 0.2s; }
  .sidebar-item:hover { background: rgba(255,255,255,0.08); }
  .sidebar-item.active { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); font-weight: 500; }
  .cloud-status {
    margin-left: auto;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: var(--text-dim);
  }
  .cloud-status.mounted {
    color: #7ee787;
    border-color: rgba(126, 231, 135, 0.45);
    background: rgba(126, 231, 135, 0.14);
  }
  .cloud-status.unmounted {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.35);
    background: rgba(245, 158, 11, 0.12);
  }

  .content-area { flex: 1; overflow: auto; padding: 20px; }
  .view-container.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 20px; }
  .view-container.list { display: flex; flex-direction: column; gap: 4px; }
  .item { display: flex; border-radius: 8px; cursor: pointer; transition: background 0.2s; border: 1px solid transparent; }
  .view-container.grid .item { flex-direction: column; align-items: center; gap: 8px; padding: 10px; }
  .view-container.list .item { flex-direction: row; align-items: center; gap: 12px; padding: 6px 12px; }
  .item:hover { background: rgba(255,255,255,0.05); }
  .item.selected { background: rgba(88, 166, 255, 0.2); border: 1px solid var(--accent-blue); }
  
  .item-info { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; min-width: 0; }
  .view-container.list .item-info { align-items: flex-start; }
  .original-path, .delete-date { font-size: 10px; color: var(--text-dim); opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
  
  .icon { display: flex; align-items: center; justify-content: center; }
  .folder-wrapper { position: relative; display: flex; align-items: center; justify-content: center; }
  .lock-overlay { 
    position: absolute; 
    bottom: 2px; 
    right: 2px; 
    background: var(--accent-red); 
    border-radius: 50%; 
    padding: 3px; 
    display: flex; 
    align-items: center; 
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    border: 1.5px solid #000;
  }
  .name { font-size: 12px; text-align: center; word-break: break-all; max-width: 100%; border: none; background: transparent; color: inherit; outline: none; }
  .loading { display: flex; justify-content: center; align-items: center; height: 100%; color: var(--text-dim); }

  .preview-panel {
    width: 250px;
    border-left: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    background: rgba(0,0,0,0.15);
    flex-shrink: 0;
  }
  .preview-header { padding: 12px; border-bottom: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center; }
  .preview-title { font-size: 13px; font-weight: 600; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .close-btn { background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  .close-btn:hover { color: white; background: rgba(255,255,255,0.1); }
  .preview-content { flex: 1; padding: 12px; margin: 0; overflow: auto; font-size: 11px; color: #a5d6ff; line-height: 1.4; white-space: pre-wrap; word-break: break-all; font-family: monospace; }
  .preview-loading { padding: 20px; color: var(--text-dim); text-align: center; font-size: 12px; }

  .content-area.dragging {
    outline: 2px dashed var(--accent-blue);
    outline-offset: -4px;
    background: rgba(88, 166, 255, 0.05);
  }
  .upload-popover {
    position: absolute;
    bottom: 20px;
    right: 20px;
    width: 250px;
    max-height: 200px;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    border: 1px solid var(--glass-border);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    z-index: 100;
  }
  .popover-header { padding: 8px 12px; display: flex; justify-content: space-between; border-bottom: 1px solid var(--glass-border); font-size: 12px; font-weight: bold; }
  .popover-header em { margin-left: 4px; color: var(--text-dim); font-style: normal; font-weight: 500; }
  .popover-header button { background: none; border: none; color: var(--text-dim); cursor: pointer; }
  .popover-header button:hover { color: white; }
  .upload-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .upload-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; }
  .u-name { text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 100px; flex: 1; }
  .u-progress-bg { flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
  .u-progress-bar { height: 100%; background: var(--accent-blue); transition: width 0.2s; }
  .u-status { font-weight: 500; font-size: 10px; }
  .u-status.success { color: #4CAF50; }
  .u-status.err { color: #F44336; }
  .u-status.canceled { color: #fbbf24; }
  .u-status.running { color: var(--accent-blue); }
  .u-status.pending { color: var(--text-dim); }
  .u-action {
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.6);
    color: #e2e8f0;
    font-size: 10px;
    padding: 2px 6px;
    cursor: pointer;
  }
  .u-action.danger { color: #fecaca; border-color: rgba(248, 113, 113, 0.45); }
  .u-action:disabled { opacity: 0.55; cursor: wait; }
  .u-error { font-size: 10px; color: #fca5a5; margin-top: -4px; }

  /* Share Dialog */
  .share-dialog-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
  .share-dialog { width: 340px; border-radius: 8px; border: 1px solid var(--glass-border); display: flex; flex-direction: column; overflow: hidden; background: rgba(30, 35, 45, 0.95); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
  .share-header { padding: 12px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid var(--glass-border); background: rgba(255,255,255,0.05); }
  .share-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .share-target { font-size: 13px; margin: 0; color: var(--text-dim); }
  .share-target strong { color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .share-label { font-size: 12px; color: var(--text-dim); }
  .share-select { padding: 8px; border-radius: 4px; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: white; outline: none; }
  .link-box { display: flex; gap: 8px; align-items: center; }
  .link-input { flex: 1; padding: 8px; border-radius: 4px; background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); color: var(--accent-blue); font-family: monospace; font-size: 11px; outline: none; }
  .copy-btn { padding: 6px 12px; border-radius: 4px; background: rgba(255,255,255,0.1); border: none; color: white; cursor: pointer; font-size: 12px; font-weight: 500; transition: background 0.2s; }
  .copy-btn:hover { background: rgba(255,255,255,0.2); }
  .expiry-msg { font-size: 11px; color: #4CAF50; margin: 0; }
  .share-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--glass-border); background: rgba(0,0,0,0.2); }
  .share-btn { padding: 6px 16px; border-radius: 4px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; background: transparent; color: var(--text-dim); transition: all 0.2s; }
  .share-btn:hover { color: white; background: rgba(255,255,255,0.1); }
  .share-btn.primary { background: var(--accent-blue); color: white; }
  .share-btn.primary:hover { filter: brightness(1.1); background: var(--accent-blue); }
</style>
