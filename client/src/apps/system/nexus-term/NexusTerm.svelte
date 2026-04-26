<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    Check,
    ChevronLeft,
    ChevronDown,
    ChevronRight,
    ClipboardPaste,
    Code2,
    Columns2,
    Copy,
    Edit3,
    Eye,
    File,
    FilePlus,
    FileText,
    Folder,
    FolderPlus,
    FolderOpen,
    Image as ImageIcon,
    Loader,
    PanelLeftClose,
    PanelRightClose,
    Pencil,
    Plus,
    RefreshCw,
    Save,
    Search,
    Shield,
    Scissors,
    Terminal as TerminalIcon,
    Trash2,
    X
  } from 'lucide-svelte';
  import * as fsApi from '../file-explorer/api.js';
  import NexusShellSession from './NexusShellSession.svelte';
  import { createTerminalAppAccessClient } from './services/terminalSessionClient.js';

  const TEXT_EXTENSIONS = new Set([
    'md', 'markdown', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'svelte', 'css', 'scss',
    'html', 'xml', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
    'hpp', 'yml', 'yaml', 'toml', 'ini', 'env', 'log', 'csv', 'sql', 'dockerfile'
  ]);
  const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
  const MOBILE_TABS = [
    { id: 'terminal', label: 'Terminal', icon: TerminalIcon },
    { id: 'explorer', label: 'Explorer', icon: Folder },
    { id: 'viewer', label: 'Viewer', icon: FileText },
    { id: 'search', label: 'Search', icon: Search }
  ];
  const DEFAULT_EXPLORER_RATIO = 0.15;
  const DEFAULT_TERMINAL_RATIO = 0.70;
  const DEFAULT_EXPLORER_PANE_WIDTH = 210;
  const DEFAULT_TERMINAL_PANE_WIDTH = 980;
  const VISIBLE_EXPLORER_MIN_WIDTH = 180;
  const MIN_TERMINAL_PANE_WIDTH = 320;
  const EXPLORER_MAX_WIDTH = 440;
  const COLLAPSE_SNAP_WIDTH = 72;
  const RESIZER_TOTAL_WIDTH = 12;
  const createTerminalTab = (() => {
    let index = 0;
    return () => {
      index += 1;
      return {
        id: `shell-${Date.now()}-${index}`,
        title: `Shell ${index}`,
        state: { ready: false, starting: false, error: '', hasPreflight: false }
      };
    };
  })();

  const initialTerminalTab = createTerminalTab();
  const terminalAppInstanceId = `nexus-term-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let mainElement;
  let terminalTabs = $state([initialTerminalTab]);
  let activeTerminalId = $state(initialTerminalTab.id);
  let pendingTerminalInput = $state(null);
  let terminalResizeSignal = $state(0);
  let terminalAccessClient;
  let terminalAccessPreflight = $state(null);
  let terminalAccessGrant = $state(null);
  let terminalAccessTypedConfirmation = $state('');
  let terminalAccessLoading = $state(false);
  let terminalAccessError = $state('');

  let loadingWorkspace = $state(false);
  let workspaceError = $state(null);
  let roots = $state([]);
  let currentPath = $state('/');
  let folderItems = $state([]);
  let treeNodes = $state({});
  let treeListElement;
  let selectedFile = $state(null);
  let explorerFilter = $state('');
  let createMode = $state('');
  let createName = $state('');
  let createError = $state('');
  let createLoading = $state(false);
  let explorerActionError = $state('');
  let contextMenu = $state({ visible: false, x: 0, y: 0, target: null });
  let renameReview = $state(null);
  let renameInput = $state('');
  let renameLoading = $state(false);
  let clipboardEntry = $state(null);
  let deleteReview = $state(null);
  let deleteTypedConfirmation = $state('');
  let deleteLoading = $state(false);
  let copyMoveReview = $state(null);
  let copyMoveTypedConfirmation = $state('');
  let copyMoveLoading = $state(false);

  let documentLoading = $state(false);
  let documentError = $state(null);
  let openDocuments = $state([]);
  let activeDocumentId = $state('');

  let saveLoading = $state(false);
  let saveError = $state('');
  let overwriteReview = $state(null);
  let overwriteTypedConfirmation = $state('');
  let closeReviewId = $state('');

  let searchQuery = $state('');
  let searchLoading = $state(false);
  let searchError = $state('');
  let searchResults = $state([]);

  let sideTool = $state('explorer');
  let activeMobileTab = $state('terminal');
  let explorerPaneWidth = $state(DEFAULT_EXPLORER_PANE_WIDTH);
  let terminalPaneWidth = $state(DEFAULT_TERMINAL_PANE_WIDTH);
  let resizingPane = $state('');

  let activeDocument = $derived(openDocuments.find((doc) => doc.id === activeDocumentId) || null);
  let activeTerminal = $derived(terminalTabs.find((tab) => tab.id === activeTerminalId) || terminalTabs[0] || null);
  let activeTerminalState = $derived(activeTerminal?.state || {});
  let activeTerminalReady = $derived(activeTerminalState.ready === true);
  let terminalAccessReady = $derived(Boolean(terminalAccessGrant?.grantId));
  let documentPath = $derived(activeDocument?.path || '');
  let dirty = $derived(Boolean(activeDocument && activeDocument.content !== activeDocument.savedContent));
  let selectedExtension = $derived(getExtension(activeDocument?.path || selectedFile?.name || ''));
  let isMarkdown = $derived(['md', 'markdown'].includes(selectedExtension));
  let isTextDocument = $derived(Boolean(activeDocument && !activeDocument.unsupported && activeDocument.kind !== 'image'));
  let isImageDocument = $derived(activeDocument?.kind === 'image');
  let overwritePreflight = $derived(overwriteReview?.preflight || null);
  let closeReviewDocument = $derived(openDocuments.find((doc) => doc.id === closeReviewId) || null);
  let deletePreflight = $derived(deleteReview?.preflight || null);
  let copyMovePreflight = $derived(copyMoveReview?.preflight || null);
  let treeRows = $derived(buildTreeRows());

  function addTerminalTab() {
    const next = createTerminalTab();
    terminalTabs = [...terminalTabs, next];
    activeTerminalId = next.id;
    activeMobileTab = 'terminal';
    applyTerminalFitSoon();
  }

  function closeTerminalTab(tabId, event) {
    event?.stopPropagation?.();
    if (terminalTabs.length <= 1) return;
    const index = terminalTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = terminalTabs.filter((tab) => tab.id !== tabId);
    terminalTabs = nextTabs;
    if (activeTerminalId === tabId) {
      activeTerminalId = (nextTabs[index] || nextTabs[index - 1] || nextTabs[0])?.id || '';
    }
    applyTerminalFitSoon();
  }

  function updateTerminalState(sessionId, state) {
    terminalTabs = terminalTabs.map((tab) => tab.id === sessionId ? { ...tab, state: { ...tab.state, ...state } } : tab);
  }

  function writeToActiveTerminal(text) {
    if (!activeTerminalId) return;
    pendingTerminalInput = {
      id: `input-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      targetSessionId: activeTerminalId,
      text
    };
    activeMobileTab = 'terminal';
  }

  function getTerminalAccessClient() {
    if (!terminalAccessClient) {
      terminalAccessClient = createTerminalAppAccessClient();
    }
    return terminalAccessClient;
  }

  async function requestTerminalAccessPreflight() {
    if (terminalAccessLoading || terminalAccessReady) return;
    terminalAccessLoading = true;
    terminalAccessError = '';
    terminalAccessTypedConfirmation = '';
    try {
      terminalAccessPreflight = await getTerminalAccessClient().requestPreflight(terminalAppInstanceId);
    } catch (err) {
      terminalAccessError = normalizeError(err, 'Could not prepare terminal approval.').message;
    } finally {
      terminalAccessLoading = false;
    }
  }

  async function approveTerminalAccess() {
    if (!terminalAccessPreflight || terminalAccessLoading || terminalAccessReady) return;
    terminalAccessLoading = true;
    terminalAccessError = '';
    try {
      terminalAccessGrant = await getTerminalAccessClient().approveAccess(
        terminalAccessPreflight,
        terminalAccessTypedConfirmation
      );
      terminalAccessTypedConfirmation = '';
      terminalResizeSignal += 1;
    } catch (err) {
      terminalAccessError = normalizeError(err, 'Could not start terminal session.').message;
    } finally {
      terminalAccessLoading = false;
    }
  }

  function getExtension(path = '') {
    const name = String(path || '').split('/').pop()?.toLowerCase() || '';
    if (name === 'dockerfile') return 'dockerfile';
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index + 1) : '';
  }

  function isDirectory(item) {
    return Boolean(item?.isDirectory || item?.type === 'directory' || item?.kind === 'directory');
  }

  function itemPath(item) {
    const explicit = String(item?.path || '').trim();
    if (explicit) return explicit;
    const name = String(item?.name || '').trim();
    const base = String(currentPath || '/').replace(/\/+$/, '');
    return base ? `${base}/${name}` : `/${name}`;
  }

  function parentPath(path) {
    const normalized = String(path || '/').replace(/\/+$/, '');
    if (!normalized || normalized === '/') return '/';
    const next = normalized.split('/').slice(0, -1).join('/');
    return next || '/';
  }

  function joinPath(basePath, name) {
    const base = String(basePath || '/').replace(/\/+$/, '');
    const cleanName = String(name || '').replace(/^\/+/, '');
    return base && base !== '/' ? `${base}/${cleanName}` : `/${cleanName}`;
  }

  function fileName(path) {
    return String(path || '').split('/').filter(Boolean).pop() || path || 'No file';
  }

  function itemName(item, path = '') {
    return String(item?.name || fileName(item?.path || path) || '').trim();
  }

  function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
  }

  function inferItemFromPath(path, overrides = {}) {
    return {
      name: fileName(path),
      path,
      type: overrides.type || 'file',
      isDirectory: overrides.isDirectory === true,
      ...overrides
    };
  }

  function pathForTerminal(target = null) {
    const path = String(target?.path || currentPath || '').trim();
    if (!path) return '';
    return target?.isDirectory ? path : parentPath(path);
  }

  function uniqueSiblingPath(sourcePath, preferredName = '') {
    const baseDir = parentPath(sourcePath);
    const original = preferredName || fileName(sourcePath);
    const dotIndex = original.lastIndexOf('.');
    const stem = dotIndex > 0 ? original.slice(0, dotIndex) : original;
    const ext = dotIndex > 0 ? original.slice(dotIndex) : '';
    const knownNames = new Set((treeNodes[baseDir]?.items || []).map((item) => String(item?.name || '')));
    let index = 1;
    let nextName = `${stem} copy${ext}`;
    while (knownNames.has(nextName)) {
      index += 1;
      nextName = `${stem} copy ${index}${ext}`;
    }
    return joinPath(baseDir, nextName);
  }

  function documentId(path) {
    return `doc:${String(path || '')}`;
  }

  function childPath(parent, item) {
    const explicit = String(item?.path || '').trim();
    if (explicit) return explicit;
    const name = String(item?.name || '').trim();
    const base = String(parent || '/').replace(/\/+$/, '');
    return base ? `${base}/${name}` : `/${name}`;
  }

  function sortItems(items) {
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
      const aDir = isDirectory(a) ? 0 : 1;
      const bDir = isDirectory(b) ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
  }

  function buildTreeRows() {
    const query = explorerFilter.trim().toLowerCase();
    const rows = [];
    const visitChildren = (parent, depth) => {
      const node = treeNodes[parent] || {};
      if (!node.expanded) return;
      for (const item of sortItems(node.items)) {
        const path = childPath(parent, item);
        const label = String(item?.name || fileName(path));
        const matches = !query || label.toLowerCase().includes(query) || path.toLowerCase().includes(query);
        const childNode = treeNodes[path] || {};
        if (matches || isDirectory(item)) {
          rows.push({
            id: path,
            path,
            item,
            label,
            depth,
            isDirectory: isDirectory(item),
            expanded: childNode.expanded === true,
            loading: childNode.loading === true,
            size: item?.size
          });
        }
        visitChildren(path, depth + 1);
      }
    };

    for (const root of roots) {
      const path = root.path;
      const node = treeNodes[path] || {};
      rows.push({
        id: path,
        path,
        item: { name: root.label, path, type: 'directory', isDirectory: true },
        label: root.label,
        depth: 0,
        isDirectory: true,
        expanded: node.expanded === true,
        loading: node.loading === true
      });
      visitChildren(path, 1);
    }
    return rows;
  }

  function createDocument(path, item, data, content, options = {}) {
    const ext = getExtension(path);
    const kind = options.kind || (IMAGE_EXTENSIONS.has(ext) ? 'image' : 'text');
    return {
      id: documentId(path),
      path: data?.path || path,
      name: fileName(data?.path || path),
      content,
      savedContent: content,
      meta: { ...(item || {}), ...(data || {}) },
      unsupported: options.unsupported === true,
      kind,
      rawUrl: options.rawUrl || '',
      viewerMode: kind === 'image' ? 'preview' : ['md', 'markdown'].includes(ext) ? 'split' : 'source'
    };
  }

  function updateDocument(docId, patch) {
    openDocuments = openDocuments.map((doc) => doc.id === docId ? { ...doc, ...patch } : doc);
  }

  function activateDocument(docId) {
    const doc = openDocuments.find((item) => item.id === docId);
    if (!doc) return;
    activeDocumentId = docId;
    selectedFile = { ...(doc.meta || {}), path: doc.path, name: doc.name };
    activeMobileTab = 'viewer';
  }

  function removeDocument(docId) {
    const index = openDocuments.findIndex((doc) => doc.id === docId);
    if (index < 0) return;
    const nextDocuments = openDocuments.filter((doc) => doc.id !== docId);
    openDocuments = nextDocuments;
    if (activeDocumentId === docId) {
      const next = nextDocuments[index] || nextDocuments[index - 1] || nextDocuments[0] || null;
      activeDocumentId = next?.id || '';
      selectedFile = next ? { ...(next.meta || {}), path: next.path, name: next.name } : null;
    }
    if (overwriteReview?.docId === docId) {
      overwriteReview = null;
      overwriteTypedConfirmation = '';
    }
    if (closeReviewId === docId) closeReviewId = '';
  }

  function requestCloseDocument(docId, event) {
    event?.stopPropagation?.();
    const doc = openDocuments.find((item) => item.id === docId);
    if (!doc) return;
    if (doc.content !== doc.savedContent) {
      closeReviewId = docId;
      return;
    }
    removeDocument(docId);
  }

  function sizeLabel(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function normalizeError(err, fallback = 'Request failed.') {
    return {
      code: err?.code || err?.status || 'REQUEST_FAILED',
      message: err?.message || fallback,
      details: err?.details || err?.payload?.details || null
    };
  }

  async function loadWorkspace() {
    loadingWorkspace = true;
    workspaceError = null;
    try {
      const dirs = await fsApi.fetchUserDirs();
      roots = [
        { id: 'home', label: 'Home', path: dirs?.home },
        { id: 'documents', label: 'Documents', path: dirs?.documents?.path },
        { id: 'downloads', label: 'Downloads', path: dirs?.downloads?.path }
      ].filter((item) => item.path);
      const startPath = roots[0]?.path || dirs?.home || '/';
      await openFolder(startPath, { preserveScroll: false, mobileTab: 'explorer' });
    } catch (err) {
      workspaceError = normalizeError(err, 'Could not load workspace roots.');
    } finally {
      loadingWorkspace = false;
    }
  }

  async function openFolder(path, options = {}) {
    if (!path) return;
    const preserveScroll = options.preserveScroll !== false;
    const previousScrollTop = preserveScroll ? (treeListElement?.scrollTop || 0) : 0;
    workspaceError = null;
    treeNodes = {
      ...treeNodes,
      [path]: {
        ...(treeNodes[path] || {}),
        loading: true,
        expanded: true,
        error: ''
      }
    };
    try {
      const data = await fsApi.listDir(path);
      const items = Array.isArray(data?.items) ? data.items : [];
      folderItems = items;
      currentPath = data?.path || path;
      const nextPath = data?.path || path;
      const previousNode = treeNodes[nextPath] || {};
      treeNodes = {
        ...treeNodes,
        [nextPath]: {
          ...previousNode,
          items,
          loading: false,
          expanded: true,
          error: ''
        }
      };
      if (options.mobileTab) activeMobileTab = options.mobileTab;
      if (preserveScroll) {
        await tick();
        if (treeListElement) treeListElement.scrollTop = previousScrollTop;
      }
    } catch (err) {
      workspaceError = normalizeError(err, 'Could not open this folder.');
      treeNodes = {
        ...treeNodes,
        [path]: {
          ...(treeNodes[path] || {}),
          loading: false,
          error: workspaceError.message
        }
      };
      if (preserveScroll) {
        await tick();
        if (treeListElement) treeListElement.scrollTop = previousScrollTop;
      }
    }
  }

  async function openItem(item) {
    const path = itemPath(item);
    if (isDirectory(item)) {
      await openFolder(path, { mobileTab: 'explorer' });
      return;
    }
    selectedFile = { ...item, path };
    await openDocument(path, item);
    activeMobileTab = 'viewer';
  }

  async function openTreeRow(row) {
    if (row?.isDirectory) {
      await openFolder(row.path, { mobileTab: 'explorer' });
      return;
    }
    selectedFile = { ...(row.item || {}), path: row.path, name: row.label };
    await openDocument(row.path, row.item);
    activeMobileTab = 'viewer';
  }

  async function toggleTreeFolder(row, event) {
    event?.stopPropagation?.();
    if (!row?.path || !row.isDirectory) return;
    const node = treeNodes[row.path] || {};
    if (node.expanded && Array.isArray(node.items)) {
      treeNodes = {
        ...treeNodes,
        [row.path]: {
          ...node,
          expanded: false
        }
      };
      return;
    }
    await openFolder(row.path, { mobileTab: 'explorer' });
  }

  async function openDocument(path, item = null, options = {}) {
    const existingId = documentId(path);
    if (options.force !== true && openDocuments.some((doc) => doc.id === existingId)) {
      activateDocument(existingId);
      return;
    }
    documentLoading = true;
    documentError = null;
    saveError = '';
    overwriteReview = null;
    overwriteTypedConfirmation = '';
    try {
      const ext = getExtension(path);
      let nextDocument;
      if (IMAGE_EXTENSIONS.has(ext)) {
        const ticket = await fsApi.createRawTicket(path, {
          appId: 'nexus-term',
          profile: 'preview',
          ttlMs: 5 * 60 * 1000
        });
        nextDocument = createDocument(path, item, { path }, '', {
          kind: 'image',
          rawUrl: ticket?.url || ''
        });
      } else if (!TEXT_EXTENSIONS.has(ext)) {
        nextDocument = createDocument(path, item, { path, unsupported: true }, '', { unsupported: true });
      } else {
        const data = await fsApi.readFile(path);
        const content = typeof data?.content === 'string'
          ? data.content
          : typeof data?.text === 'string'
            ? data.text
            : typeof data?.data?.content === 'string'
              ? data.data.content
              : '';
        nextDocument = createDocument(path, item, data, content);
      }
      openDocuments = options.force === true
        ? [...openDocuments.filter((doc) => doc.id !== nextDocument.id), nextDocument]
        : [...openDocuments, nextDocument];
      activeDocumentId = nextDocument.id;
      selectedFile = { ...(item || {}), path: nextDocument.path, name: nextDocument.name };
    } catch (err) {
      documentError = normalizeError(err, 'Could not read this file.');
    } finally {
      documentLoading = false;
    }
  }

  async function reloadDocument() {
    if (!activeDocument?.path) return;
    await openDocument(activeDocument.path, selectedFile, { force: true });
  }

  async function beginSave() {
    if (!activeDocument?.path || !dirty || saveLoading || activeDocument.unsupported) return;
    saveLoading = true;
    saveError = '';
    overwriteReview = null;
    overwriteTypedConfirmation = '';
    try {
      const response = await fsApi.preflightOverwrite(activeDocument.path);
      overwriteReview = {
        docId: activeDocument.id,
        path: activeDocument.path,
        preflight: response?.preflight || response
      };
    } catch (err) {
      saveError = normalizeError(err, 'Could not prepare overwrite approval.').message;
    } finally {
      saveLoading = false;
    }
  }

  async function approveSave() {
    const review = overwriteReview;
    const doc = openDocuments.find((item) => item.id === review?.docId);
    if (!doc?.path || !review?.preflight || saveLoading) return;
    saveLoading = true;
    saveError = '';
    try {
      const approved = await fsApi.approveOverwrite(doc.path, review.preflight, overwriteTypedConfirmation);
      const approval = approved?.approval || approved;
      await fsApi.executeOverwrite(doc.path, doc.content, {
        operationId: review.preflight.operationId,
        targetHash: review.preflight.targetHash,
        nonce: approval?.nonce
      });
      updateDocument(doc.id, { savedContent: doc.content });
      overwriteReview = null;
      overwriteTypedConfirmation = '';
      await openFolder(currentPath, { preserveScroll: true });
      activeMobileTab = 'viewer';
    } catch (err) {
      saveError = normalizeError(err, 'Could not save this file.').message;
    } finally {
      saveLoading = false;
    }
  }

  async function runSearch() {
    const query = searchQuery.trim();
    if (!query) {
      searchResults = [];
      return;
    }
    searchLoading = true;
    searchError = '';
    try {
      const data = await fsApi.searchFiles(query, currentPath);
      searchResults = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    } catch (err) {
      const local = folderItems.filter((item) => String(item?.name || '').toLowerCase().includes(query.toLowerCase()));
      if (local.length) {
        searchResults = local;
        searchError = 'Backend search failed; showing matches from the loaded folder.';
      } else {
        searchError = normalizeError(err, 'Search failed.').message;
        searchResults = [];
      }
    } finally {
      searchLoading = false;
    }
  }

  function renderMarkdown(source) {
    const escaped = escapeHtml(source || '');
    const blocks = escaped.split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      const first = lines[0] || '';
      if (/^#{1,4}\s/.test(first)) {
        const level = Math.min(4, first.match(/^#+/)?.[0]?.length || 2);
        return `<h${level}>${first.replace(/^#{1,4}\s+/, '')}</h${level}>`;
      }
      if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
        return `<ul>${lines.map((line) => `<li>${line.trim().replace(/^[-*]\s+/, '')}</li>`).join('')}</ul>`;
      }
      if (block.startsWith('```')) {
        return `<pre><code>${block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>`;
      }
      return `<p>${lines.join('<br />')}</p>`;
    });
    return blocks.join('');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function openSideTool(tool) {
    sideTool = tool;
    activeMobileTab = tool;
  }

  function beginCreate(mode) {
    createMode = mode;
    createName = '';
    createError = '';
    activeMobileTab = 'explorer';
  }

  function cancelCreate() {
    createMode = '';
    createName = '';
    createError = '';
  }

  async function submitCreate() {
    const name = createName.trim();
    if (!createMode || createLoading) return;
    if (!name || name.includes('/')) {
      createError = 'Enter a single file or folder name.';
      return;
    }
    const targetPath = joinPath(currentPath, name);
    createLoading = true;
    createError = '';
    try {
      if (createMode === 'folder') {
        await fsApi.createDir(targetPath);
      } else {
        await fsApi.writeFile(targetPath, '');
      }
      const mode = createMode;
      cancelCreate();
      await openFolder(currentPath, { preserveScroll: true });
      if (mode === 'file') {
        await openDocument(targetPath, { name, path: targetPath, type: 'file' }, { force: true });
      }
    } catch (err) {
      createError = normalizeError(err, `Could not create ${createMode}.`).message;
    } finally {
      createLoading = false;
    }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false };
  }

  function buildExplorerContextItems(target = null) {
    const normalizedTarget = target
      ? {
        ...target,
        name: itemName(target.item || target, target.path),
        path: target.path || itemPath(target.item || target),
        isDirectory: target.isDirectory === true || isDirectory(target.item || target)
      }
      : null;
    const items = [
      { label: 'New File', icon: FilePlus, action: () => beginCreate('file') },
      { label: 'New Folder', icon: FolderPlus, action: () => beginCreate('folder') }
    ];
    if (clipboardEntry) {
      items.push({ label: `Paste ${clipboardEntry.mode === 'cut' ? 'Move' : 'Copy'}`, icon: ClipboardPaste, action: pasteClipboardEntry });
    }
    if (normalizedTarget) {
      items.push(
        { type: 'separator' },
        { label: 'Rename', icon: Pencil, action: () => beginRename(normalizedTarget) },
        { label: 'Copy', icon: Copy, action: () => copyExplorerItem(normalizedTarget, 'copy') },
        { label: 'Duplicate', icon: Copy, disabled: normalizedTarget.isDirectory, action: () => duplicateExplorerItem(normalizedTarget) },
        { label: 'Cut', icon: Scissors, action: () => copyExplorerItem(normalizedTarget, 'cut') },
        { label: 'Delete', icon: Trash2, danger: true, action: () => beginDelete(normalizedTarget) },
        { type: 'separator' },
        { label: 'Open In New Terminal', icon: TerminalIcon, action: () => openPathInNewTerminal(normalizedTarget) },
        { label: 'Write Path To Terminal', icon: TerminalIcon, action: () => writePathToCurrentTerminal(normalizedTarget) }
      );
    } else {
      items.push(
        { type: 'separator' },
        { label: 'Open Folder In New Terminal', icon: TerminalIcon, action: () => openPathInNewTerminal({ path: currentPath, name: fileName(currentPath), isDirectory: true }) },
        { label: 'Write Folder Path To Terminal', icon: TerminalIcon, action: () => writePathToCurrentTerminal({ path: currentPath, name: fileName(currentPath), isDirectory: true }) }
      );
    }
    return items;
  }

  function openExplorerContextMenu(event, target = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    contextMenu = {
      visible: true,
      x: event?.clientX || 0,
      y: event?.clientY || 0,
      target,
      items: buildExplorerContextItems(target)
    };
    if (target?.path) {
      if (target.isDirectory) currentPath = target.path;
      selectedFile = target.isDirectory ? selectedFile : { ...(target.item || {}), path: target.path, name: target.label || itemName(target.item, target.path) };
    }
  }

  function runContextAction(item) {
    if (!item || item.disabled || item.type === 'separator') return;
    closeContextMenu();
    item.action?.();
  }

  function beginRename(target) {
    renameReview = target;
    renameInput = target.name || fileName(target.path);
    explorerActionError = '';
  }

  async function submitRename() {
    const target = renameReview;
    const nextName = renameInput.trim();
    if (!target?.path || !nextName || nextName.includes('/') || renameLoading) return;
    renameLoading = true;
    explorerActionError = '';
    try {
      await fsApi.renameItem(target.path, nextName);
      renameReview = null;
      renameInput = '';
      await openFolder(parentPath(target.path), { preserveScroll: true });
    } catch (err) {
      explorerActionError = normalizeError(err, 'Could not rename this item.').message;
    } finally {
      renameLoading = false;
    }
  }

  function copyExplorerItem(target, mode = 'copy') {
    clipboardEntry = { ...target, mode };
    explorerActionError = '';
  }

  async function duplicateExplorerItem(target) {
    if (!target?.path) return;
    explorerActionError = '';
    try {
      const nextPath = uniqueSiblingPath(target.path, target.name);
      await beginCopyMove('copy', target, nextPath);
    } catch (err) {
      explorerActionError = normalizeError(err, 'Could not duplicate this item.').message;
    }
  }

  async function pasteClipboardEntry() {
    const entry = clipboardEntry;
    if (!entry?.path) return;
    explorerActionError = '';
    try {
      let targetPath = joinPath(currentPath, entry.name || fileName(entry.path));
      if ((treeNodes[currentPath]?.items || []).some((item) => String(item?.name || '') === fileName(targetPath))) {
        targetPath = uniqueSiblingPath(targetPath, fileName(targetPath));
      }
      await beginCopyMove(entry.mode === 'cut' ? 'move' : 'copy', entry, targetPath, {
        afterComplete: () => { if (entry.mode === 'cut') clipboardEntry = null; }
      });
    } catch (err) {
      explorerActionError = normalizeError(err, 'Could not paste this item.').message;
    }
  }

  async function beginCopyMove(action, source, destinationPath, options = {}) {
    if (!source?.path || !destinationPath || copyMoveLoading) return;
    copyMoveLoading = true;
    copyMoveTypedConfirmation = '';
    explorerActionError = '';
    try {
      const response = action === 'move'
        ? await fsApi.preflightMove(source.path, destinationPath)
        : await fsApi.preflightCopy(source.path, destinationPath);
      copyMoveReview = {
        action,
        source,
        destinationPath,
        preflight: response?.preflight || response,
        afterComplete: options.afterComplete || null
      };
    } catch (err) {
      explorerActionError = normalizeError(err, `Could not prepare ${action} approval.`).message;
    } finally {
      copyMoveLoading = false;
    }
  }

  async function approveCopyMove() {
    const review = copyMoveReview;
    if (!review?.source?.path || !review?.destinationPath || !review?.preflight || copyMoveLoading) return;
    copyMoveLoading = true;
    explorerActionError = '';
    try {
      const approved = review.action === 'move'
        ? await fsApi.approveMove(review.source.path, review.destinationPath, review.preflight, copyMoveTypedConfirmation)
        : await fsApi.approveCopy(review.source.path, review.destinationPath, review.preflight, copyMoveTypedConfirmation);
      const approval = approved?.approval || approved;
      const approvalEvidence = {
        operationId: review.preflight.operationId,
        targetHash: review.preflight.targetHash,
        nonce: approval?.nonce
      };
      if (review.action === 'move') {
        await fsApi.executeMove(review.source.path, review.destinationPath, approvalEvidence);
      } else {
        await fsApi.executeCopy(review.source.path, review.destinationPath, approvalEvidence);
      }
      review.afterComplete?.();
      copyMoveReview = null;
      copyMoveTypedConfirmation = '';
      await openFolder(parentPath(review.destinationPath), { preserveScroll: true });
      const sourceParent = parentPath(review.source.path);
      if (sourceParent !== parentPath(review.destinationPath)) {
        await openFolder(sourceParent, { preserveScroll: true });
      }
    } catch (err) {
      explorerActionError = normalizeError(err, `Could not ${review.action} this item.`).message;
    } finally {
      copyMoveLoading = false;
    }
  }

  async function beginDelete(target, options = {}) {
    if (!target?.path || deleteLoading) return;
    deleteLoading = true;
    deleteTypedConfirmation = '';
    explorerActionError = '';
    try {
      const response = await fsApi.preflightDelete(target.path);
      deleteReview = {
        ...target,
        preflight: response?.preflight || response,
        afterDelete: options.afterDelete || null
      };
    } catch (err) {
      explorerActionError = normalizeError(err, 'Could not prepare delete approval.').message;
    } finally {
      deleteLoading = false;
    }
  }

  async function approveDelete() {
    const review = deleteReview;
    if (!review?.path || !review?.preflight || deleteLoading) return;
    deleteLoading = true;
    explorerActionError = '';
    try {
      const approved = await fsApi.approveDelete(review.path, review.preflight, deleteTypedConfirmation);
      const approval = approved?.approval || approved;
      await fsApi.executeDelete(review.path, {
        operationId: review.preflight.operationId,
        targetHash: review.preflight.targetHash,
        nonce: approval?.nonce
      });
      review.afterDelete?.();
      deleteReview = null;
      deleteTypedConfirmation = '';
      await openFolder(parentPath(review.path), { preserveScroll: true });
      if (selectedFile?.path === review.path) selectedFile = null;
    } catch (err) {
      explorerActionError = normalizeError(err, 'Could not delete this item.').message;
    } finally {
      deleteLoading = false;
    }
  }

  function openPathInNewTerminal(target) {
    const path = pathForTerminal(target);
    if (!path) return;
    const next = createTerminalTab();
    terminalTabs = [...terminalTabs, next];
    activeTerminalId = next.id;
    writeToActiveTerminal(`cd ${shellQuote(path)}\r`);
  }

  function writePathToCurrentTerminal(target) {
    const path = String(target?.path || currentPath || '').trim();
    if (!path) return;
    writeToActiveTerminal(shellQuote(path));
  }

  function discardCloseReviewDocument() {
    const docId = closeReviewId;
    closeReviewId = '';
    removeDocument(docId);
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function snapCollapsiblePaneWidth(value, visibleMin, max) {
    const clamped = clampNumber(Number(value) || 0, 0, Math.max(0, max));
    if (clamped < COLLAPSE_SNAP_WIDTH) return 0;
    return clampNumber(clamped, visibleMin, Math.max(visibleMin, max));
  }

  function getMainWidth() {
    return mainElement?.getBoundingClientRect?.().width || 0;
  }

  function getTerminalMaxWidth(explorerWidth = explorerPaneWidth) {
    const available = getMainWidth() - explorerWidth - RESIZER_TOTAL_WIDTH;
    return Math.max(MIN_TERMINAL_PANE_WIDTH, available);
  }

  function getDefaultPaneWidths() {
    const available = Math.max(0, getMainWidth() - RESIZER_TOTAL_WIDTH);
    if (!available) {
      return {
        explorer: DEFAULT_EXPLORER_PANE_WIDTH,
        terminal: DEFAULT_TERMINAL_PANE_WIDTH,
        viewer: Math.round(DEFAULT_EXPLORER_PANE_WIDTH)
      };
    }
    return {
      explorer: Math.round(available * DEFAULT_EXPLORER_RATIO),
      terminal: Math.round(available * DEFAULT_TERMINAL_RATIO),
      viewer: Math.max(0, Math.round(available * DEFAULT_EXPLORER_RATIO))
    };
  }

  function clampTerminalPaneWidth(width, explorerWidth = explorerPaneWidth) {
    return clampNumber(Number(width) || DEFAULT_TERMINAL_PANE_WIDTH, MIN_TERMINAL_PANE_WIDTH, getTerminalMaxWidth(explorerWidth));
  }

  function getViewerPaneWidth() {
    return Math.max(0, getMainWidth() - explorerPaneWidth - terminalPaneWidth - RESIZER_TOTAL_WIDTH);
  }

  function applyTerminalFitSoon() {
    setTimeout(() => {
      terminalResizeSignal += 1;
    }, 0);
  }

  function resetDefaultPaneLayout() {
    const defaults = getDefaultPaneWidths();
    explorerPaneWidth = defaults.explorer;
    terminalPaneWidth = clampTerminalPaneWidth(defaults.terminal, defaults.explorer);
    applyTerminalFitSoon();
  }

  function toggleExplorerPane() {
    const defaults = getDefaultPaneWidths();
    if (explorerPaneWidth < Math.max(COLLAPSE_SNAP_WIDTH, defaults.explorer * 0.75)) {
      resetDefaultPaneLayout();
      return;
    }
    const nextExplorerWidth = 0;
    explorerPaneWidth = nextExplorerWidth;
    terminalPaneWidth = clampTerminalPaneWidth(terminalPaneWidth, nextExplorerWidth);
    applyTerminalFitSoon();
  }

  function toggleViewerPane() {
    const defaults = getDefaultPaneWidths();
    const viewerWidth = getViewerPaneWidth();
    if (viewerWidth < Math.max(COLLAPSE_SNAP_WIDTH, defaults.viewer * 0.75)) {
      resetDefaultPaneLayout();
      return;
    }
    terminalPaneWidth = clampTerminalPaneWidth(getTerminalMaxWidth());
    applyTerminalFitSoon();
  }

  function startPaneResize(kind, event) {
    event?.preventDefault?.();
    resizingPane = kind;
    globalThis.document?.body?.classList.add('nexus-resizing');
    globalThis.document?.body?.classList.add(`nexus-resizing-${kind}`);
    globalThis.addEventListener('pointermove', handlePaneResize);
    globalThis.addEventListener('pointerup', stopPaneResize, { once: true });
  }

  function handlePaneResize(event) {
    if (resizingPane === 'explorer' && mainElement) {
      const rect = mainElement.getBoundingClientRect();
      const maxExplorerWidth = Math.min(EXPLORER_MAX_WIDTH, Math.max(0, rect.width - MIN_TERMINAL_PANE_WIDTH - RESIZER_TOTAL_WIDTH));
      explorerPaneWidth = snapCollapsiblePaneWidth(event.clientX - rect.left, VISIBLE_EXPLORER_MIN_WIDTH, maxExplorerWidth);
      terminalPaneWidth = clampTerminalPaneWidth(terminalPaneWidth, explorerPaneWidth);
      applyTerminalFitSoon();
      return;
    }
    if (resizingPane === 'terminal' && mainElement) {
      const rect = mainElement.getBoundingClientRect();
      const rawWidth = event.clientX - rect.left - explorerPaneWidth - 6;
      terminalPaneWidth = clampTerminalPaneWidth(rawWidth);
      applyTerminalFitSoon();
    }
  }

  function stopPaneResize() {
    resizingPane = '';
    globalThis.document?.body?.classList.remove('nexus-resizing');
    globalThis.document?.body?.classList.remove('nexus-resizing-explorer');
    globalThis.document?.body?.classList.remove('nexus-resizing-terminal');
    globalThis.removeEventListener('pointermove', handlePaneResize);
    applyTerminalFitSoon();
  }

  onMount(async () => {
    resetDefaultPaneLayout();
    requestTerminalAccessPreflight();
    await loadWorkspace();
    setTimeout(() => {
      terminalResizeSignal += 1;
    }, 50);
  });

  onDestroy(() => {
    globalThis.removeEventListener('pointermove', handlePaneResize);
    globalThis.document?.body?.classList.remove('nexus-resizing');
    globalThis.document?.body?.classList.remove('nexus-resizing-explorer');
    globalThis.document?.body?.classList.remove('nexus-resizing-terminal');
    terminalAccessClient?.disconnect();
  });
</script>

<svelte:window
  onclick={closeContextMenu}
  onkeydown={(event) => {
    if (event.key === 'Escape') closeContextMenu();
  }}
/>

<div class="nexus-term">
  <main
    bind:this={mainElement}
    class:resizing-explorer={resizingPane === 'explorer'}
    class:resizing-terminal={resizingPane === 'terminal'}
    class="nexus-main"
    style={`--explorer-pane-width:${explorerPaneWidth}px; --terminal-pane-width:${terminalPaneWidth}px;`}
  >
    <aside
      class:mobile-active={activeMobileTab === 'explorer' || activeMobileTab === 'search'}
      class="side-rail"
    >
      <section class:mobile-active={activeMobileTab === 'explorer'} class:desktop-active={sideTool === 'explorer'} class="explorer-pane panel side-tool">
        <div class="panel-title">
          <span><FolderOpen size={16} /> Explorer</span>
          <div class="side-switcher">
            <button class:active={sideTool === 'explorer'} title="Explorer" onclick={() => openSideTool('explorer')}><FolderOpen size={15} /></button>
            <button class:active={sideTool === 'search'} title="Search" onclick={() => openSideTool('search')}><Search size={15} /></button>
            <button title="New folder" onclick={() => beginCreate('folder')}><FolderPlus size={15} /></button>
            <button title="New file" onclick={() => beginCreate('file')}><FilePlus size={15} /></button>
            <button title="Parent folder" onclick={() => openFolder(parentPath(currentPath))} disabled={currentPath === '/' || loadingWorkspace}>
              <ChevronLeft size={16} />
            </button>
            <button title="Refresh folder" onclick={() => openFolder(currentPath, { preserveScroll: true })}>
              <RefreshCw size={15} class={treeNodes[currentPath]?.loading ? 'spin' : ''} />
            </button>
          </div>
        </div>
        <input class="filter-input" bind:value={explorerFilter} placeholder="Filter tree" />
        {#if createMode}
          <div class="create-row">
            <input
              bind:value={createName}
              onkeydown={(event) => event.key === 'Enter' && submitCreate()}
              placeholder={createMode === 'folder' ? 'Folder name' : 'File name'}
            />
            <button class="primary" onclick={submitCreate} disabled={createLoading || !createName.trim()}>
              {#if createLoading}<Loader size={14} class="spin" />{:else}<Check size={14} />{/if}
            </button>
            <button title="Cancel" onclick={cancelCreate} disabled={createLoading}><X size={14} /></button>
          </div>
        {/if}
        {#if createError || explorerActionError}<p class="error-text">{createError || explorerActionError}</p>{/if}
        {#if workspaceError}
          <div class="inline-error">
            <strong>{workspaceError.code}</strong>
            <span>{workspaceError.message}</span>
          </div>
        {/if}
        <div
          bind:this={treeListElement}
          class="tree-list"
          role="tree"
          tabindex="0"
          oncontextmenu={(event) => openExplorerContextMenu(event, null)}
        >
          {#if loadingWorkspace}
            <div class="empty-state"><Loader class="spin" size={18} /> Loading folder...</div>
          {:else if treeRows.length === 0}
            <div class="empty-state">No tree entries loaded.</div>
          {:else}
            {#each treeRows as row}
              <div
                class:selected={selectedFile?.path === row.path || currentPath === row.path}
                class="tree-row"
                role="treeitem"
                tabindex="-1"
                aria-selected={selectedFile?.path === row.path || currentPath === row.path}
                style={`--depth:${row.depth}`}
                oncontextmenu={(event) => openExplorerContextMenu(event, row)}
              >
                {#if row.isDirectory}
                  <button class="chevron" title={row.expanded ? 'Collapse folder' : 'Expand folder'} onclick={(event) => toggleTreeFolder(row, event)}>
                    {#if row.loading}<Loader size={14} class="spin" />{:else if row.expanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
                  </button>
                  <button class="tree-main" onclick={() => openTreeRow(row)}>
                    {#if row.expanded}<FolderOpen size={16} />{:else}<Folder size={16} />{/if}
                    <span>{row.label}</span>
                    <small>{row.isDirectory ? '' : sizeLabel(row.size)}</small>
                  </button>
                {:else if IMAGE_EXTENSIONS.has(getExtension(row.path))}
                  <span class="chevron"></span>
                  <button class="tree-main" onclick={() => openTreeRow(row)}>
                    <ImageIcon size={16} />
                    <span>{row.label}</span>
                    <small>{sizeLabel(row.size)}</small>
                  </button>
                {:else}
                  <span class="chevron"></span>
                  <button class="tree-main" onclick={() => openTreeRow(row)}>
                    <File size={16} />
                    <span>{row.label}</span>
                    <small>{sizeLabel(row.size)}</small>
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </section>

      <section class:mobile-active={activeMobileTab === 'search'} class:desktop-active={sideTool === 'search'} class="search-pane panel side-tool">
        <div class="panel-title">
          <span><Search size={16} /> Search</span>
          <div class="side-switcher">
            <button title="Explorer" onclick={() => openSideTool('explorer')}><FolderOpen size={15} /></button>
            <button class:active={sideTool === 'search'} title="Search" onclick={() => openSideTool('search')}><Search size={15} /></button>
          </div>
        </div>
        <div class="search-row">
          <input bind:value={searchQuery} onkeydown={(event) => event.key === 'Enter' && runSearch()} placeholder="Search current folder" />
          <button onclick={runSearch} disabled={searchLoading || !searchQuery.trim()}>
            {#if searchLoading}<Loader size={15} class="spin" />{:else}<Search size={15} />{/if}
          </button>
        </div>
        {#if searchError}<p class="error-text">{searchError}</p>{/if}
        <div class="result-list">
          {#each searchResults as result}
            <button class="file-row" onclick={() => openItem(result)}>
              {#if isDirectory(result)}<Folder size={16} />{:else}<File size={16} />{/if}
              <span>{result.name || fileName(result.path)}</span>
              <small>{result.path}</small>
            </button>
          {/each}
        </div>
      </section>
    </aside>

    <button
      aria-label="Resize explorer and terminal panes"
      class="pane-resizer vertical explorer-resizer"
      onpointerdown={(event) => startPaneResize('explorer', event)}
    ></button>

    <section class:mobile-active={activeMobileTab === 'viewer'} class="viewer-pane panel">
      <div class="panel-title">
        <span>{#if isImageDocument}<ImageIcon size={16} />{:else}<Code2 size={16} />{/if} {documentPath ? fileName(documentPath) : 'Viewer'}</span>
        <div class="viewer-actions">
          {#if isMarkdown}
            <button aria-label="Preview" title="Preview" class:active={activeDocument?.viewerMode === 'preview'} onclick={() => updateDocument(activeDocument.id, { viewerMode: 'preview' })}><Eye size={15} /></button>
            <button aria-label="Edit source" title="Edit source" class:active={activeDocument?.viewerMode === 'source'} onclick={() => updateDocument(activeDocument.id, { viewerMode: 'source' })}><Edit3 size={15} /></button>
            <button aria-label="Split view" title="Split view" class:active={activeDocument?.viewerMode === 'split'} onclick={() => updateDocument(activeDocument.id, { viewerMode: 'split' })}><Columns2 size={15} /></button>
          {:else if isImageDocument}
            <button aria-label="Image preview" title="Image preview" class="active"><ImageIcon size={15} /></button>
          {:else}
            <button aria-label="Source" title="Source" class:active={activeDocument?.viewerMode === 'source'} onclick={() => activeDocument && updateDocument(activeDocument.id, { viewerMode: 'source' })}><Code2 size={15} /></button>
          {/if}
          <button title="Reload" onclick={reloadDocument} disabled={!documentPath || documentLoading}><RefreshCw size={15} /></button>
          <button title="Save" onclick={beginSave} disabled={!dirty || saveLoading || !isTextDocument}><Save size={15} /></button>
        </div>
      </div>
      {#if openDocuments.length}
        <div class="doc-tabs">
          {#each openDocuments as doc}
            <button class:active={doc.id === activeDocumentId} onclick={() => activateDocument(doc.id)}>
              <span>{doc.content !== doc.savedContent ? '*' : ''}{doc.name}</span>
              <X size={13} onclick={(event) => requestCloseDocument(doc.id, event)} />
            </button>
          {/each}
        </div>
      {/if}
      {#if documentLoading}
        <div class="empty-state"><Loader class="spin" size={18} /> Loading file...</div>
      {:else if documentError}
        <div class="inline-error">
          <strong>{documentError.code}</strong>
          <span>{documentError.message}</span>
        </div>
      {:else if activeDocument?.unsupported}
        <div class="empty-state">Unsupported file type for inline viewing.</div>
      {:else if !documentPath}
        <div class="empty-state">Select a Markdown or code file from Explorer.</div>
      {:else if isImageDocument}
        <div class="image-preview">
          {#if activeDocument.rawUrl}
            <img src={activeDocument.rawUrl} alt={activeDocument.name} />
          {:else}
            <div class="empty-state">Image preview ticket is unavailable.</div>
          {/if}
        </div>
      {:else if activeDocument?.viewerMode === 'split' && isMarkdown}
        <div class="markdown-split">
          <textarea
            class="editor"
            value={activeDocument?.content || ''}
            oninput={(event) => activeDocument && updateDocument(activeDocument.id, { content: event.currentTarget.value })}
            spellcheck="false"
            aria-label="NexusTerm Markdown editor"
          ></textarea>
          <article class="markdown-preview">{@html renderMarkdown(activeDocument.content)}</article>
        </div>
      {:else if activeDocument?.viewerMode === 'preview' && isMarkdown}
        <article class="markdown-preview">{@html renderMarkdown(activeDocument.content)}</article>
      {:else}
        <textarea
          class="editor"
          value={activeDocument?.content || ''}
          oninput={(event) => activeDocument && updateDocument(activeDocument.id, { content: event.currentTarget.value })}
          spellcheck="false"
          aria-label="NexusTerm file editor"
        ></textarea>
      {/if}
      {#if saveError}<p class="error-text">{saveError}</p>{/if}
    </section>

    <button
      aria-label="Resize terminal and viewer panes"
      class="pane-resizer vertical terminal-resizer"
      onpointerdown={(event) => startPaneResize('terminal', event)}
    ></button>

    <section class:mobile-active={activeMobileTab === 'terminal'} class="terminal-pane panel">
      <div class="panel-title shell-tabbar">
        <div class="shell-tabs" aria-label="Shell sessions">
          {#each terminalTabs as tab}
            <button class:active={tab.id === activeTerminalId} onclick={() => activeTerminalId = tab.id}>
              <TerminalIcon size={13} />
              <span>{tab.title}</span>
              {#if tab.state.ready}<Check size={12} color="var(--green)" />{/if}
              {#if terminalTabs.length > 1}
                <X size={12} onclick={(event) => closeTerminalTab(tab.id, event)} />
              {/if}
            </button>
          {/each}
        </div>
        <div class="shell-title-actions">
          <button aria-label="New shell" title="New shell" onclick={addTerminalTab}>
            <Plus size={15} />
          </button>
          <button aria-label="Collapse or restore Explorer" title="Collapse or restore Explorer" onclick={toggleExplorerPane}>
            <PanelLeftClose size={15} />
          </button>
          <button aria-label="Collapse or restore Viewer" title="Collapse or restore Viewer" onclick={toggleViewerPane}>
            <PanelRightClose size={15} />
          </button>
        </div>
      </div>
      <div class="terminal-wrap">
        <div class="shell-stage">
          {#each terminalTabs as tab (tab.id)}
            <NexusShellSession
              active={tab.id === activeTerminalId}
              sessionId={tab.id}
              enabled={terminalAccessReady}
              appAccessGrant={terminalAccessGrant}
              pendingInput={pendingTerminalInput}
              resizeSignal={terminalResizeSignal}
              onStateChange={updateTerminalState}
            />
          {/each}
          {#if !terminalAccessReady}
            <div class="terminal-access-gate">
              <div class="approval-card terminal-approval-card">
                <div class="approval-heading">
                  <Shield size={24} />
                  <h2>Start Terminal Session</h2>
                </div>
                <p>Opens local shell access for this NexusTerm window. New shell tabs will reuse this approval until the app is closed.</p>
                {#if terminalAccessPreflight}
                  <dl>
                    <div><dt>Action</dt><dd>{terminalAccessPreflight.action}</dd></div>
                    <div><dt>Target</dt><dd>{terminalAccessPreflight.target?.label || terminalAccessPreflight.target?.id || 'NexusTerm'}</dd></div>
                    <div><dt>Impact</dt><dd>{Array.isArray(terminalAccessPreflight.impact) ? terminalAccessPreflight.impact.join(' ') : terminalAccessPreflight.impact}</dd></div>
                  </dl>
                  <label>
                    <span>Type <code>{terminalAccessPreflight.approval?.typedConfirmation}</code> to approve</span>
                    <input
                      bind:value={terminalAccessTypedConfirmation}
                      autocomplete="off"
                      spellcheck="false"
                      onkeydown={(event) => event.key === 'Enter' && approveTerminalAccess()}
                    />
                  </label>
                  <div class="dialog-actions">
                    <button class="ghost" onclick={requestTerminalAccessPreflight} disabled={terminalAccessLoading}>Refresh</button>
                    <button
                      class="primary"
                      onclick={approveTerminalAccess}
                      disabled={terminalAccessLoading || terminalAccessTypedConfirmation !== terminalAccessPreflight.approval?.typedConfirmation}
                    >
                      {#if terminalAccessLoading}<Loader size={15} class="spin" />{/if}
                      Start Shell
                    </button>
                  </div>
                {:else}
                  <p class="session-progress">
                    {terminalAccessLoading ? 'Preparing terminal approval...' : 'Terminal approval is not ready yet.'}
                  </p>
                  <button class="primary" onclick={requestTerminalAccessPreflight} disabled={terminalAccessLoading}>
                    {#if terminalAccessLoading}<Loader size={15} class="spin" />{/if}
                    Retry Approval Request
                  </button>
                {/if}
                {#if terminalAccessError}<p class="error-text">{terminalAccessError}</p>{/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </section>
  </main>

  <footer class="status-bar">
    <span><Check size={13} /> {activeTerminalReady ? 'shell ready' : 'shell gated'}</span>
    <span>{documentPath || 'no file selected'}</span>
    <span class:dirty>{dirty ? 'unsaved changes' : 'clean'}</span>
  </footer>

  <nav class="mobile-tabs" aria-label="NexusTerm mobile tabs">
    {#each MOBILE_TABS as tab}
      {@const Icon = tab.icon}
      <button class:active={activeMobileTab === tab.id} onclick={() => activeMobileTab = tab.id}>
        <Icon size={18} />
        <span>{tab.label}</span>
      </button>
    {/each}
  </nav>

  {#if contextMenu.visible}
    <div
      class="explorer-context-menu"
      style={`left:${contextMenu.x}px; top:${contextMenu.y}px;`}
      role="menu"
      tabindex="-1"
      oncontextmenu={(event) => event.preventDefault()}
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.key === 'Escape' && closeContextMenu()}
    >
      {#each contextMenu.items || [] as item}
        {#if item.type === 'separator'}
          <div class="context-separator"></div>
        {:else}
          {@const ItemIcon = item.icon}
          <button
            class:danger={item.danger}
            disabled={item.disabled}
            onclick={() => runContextAction(item)}
          >
            <ItemIcon size={15} />
            <span>{item.label}</span>
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  {#if renameReview}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-modal" role="dialog" aria-modal="true" aria-label="Rename item">
        <button class="modal-close" title="Cancel" onclick={() => { renameReview = null; renameInput = ''; }}>
          <X size={16} />
        </button>
        <Pencil size={24} />
        <h2>Rename Item</h2>
        <p><strong>{renameReview.path}</strong></p>
        <label>
          <span>New name</span>
          <input bind:value={renameInput} autocomplete="off" spellcheck="false" onkeydown={(event) => event.key === 'Enter' && submitRename()} />
        </label>
        {#if explorerActionError}<p class="error-text">{explorerActionError}</p>{/if}
        <div class="dialog-actions">
          <button class="ghost" onclick={() => { renameReview = null; renameInput = ''; }} disabled={renameLoading}>Cancel</button>
          <button class="primary" onclick={submitRename} disabled={renameLoading || !renameInput.trim()}>
            {#if renameLoading}<Loader size={15} class="spin" />{/if}
            Rename
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if closeReviewDocument}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-modal" role="dialog" aria-modal="true" aria-label="Discard unsaved changes">
        <button class="modal-close" title="Cancel" onclick={() => closeReviewId = ''}>
          <X size={16} />
        </button>
        <Edit3 size={24} />
        <h2>Close Unsaved Tab?</h2>
        <p>
          <strong>{closeReviewDocument.path}</strong> has unsaved edits. Closing
          this tab will discard those edits. Nothing will be saved automatically.
        </p>
        <div class="dialog-actions">
          <button class="ghost" onclick={() => closeReviewId = ''}>Keep Editing</button>
          <button class="primary" onclick={discardCloseReviewDocument}>Discard And Close</button>
        </div>
      </div>
    </div>
  {/if}

  {#if copyMovePreflight}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-modal" role="dialog" aria-modal="true" aria-label="Copy or move approval">
        <button class="modal-close" title="Cancel" onclick={() => { copyMoveReview = null; copyMoveTypedConfirmation = ''; }}>
          <X size={16} />
        </button>
        {#if copyMoveReview?.action === 'move'}<Scissors size={24} />{:else}<Copy size={24} />{/if}
        <h2>{copyMoveReview?.action === 'move' ? 'Move Item' : 'Copy Item'}</h2>
        <p>
          <strong>{copyMoveReview?.source?.path}</strong>
          {copyMoveReview?.action === 'move' ? ' will move to ' : ' will copy to '}
          <strong>{copyMoveReview?.destinationPath}</strong>.
        </p>
        <dl>
          <div><dt>Action</dt><dd>{copyMovePreflight.action || `fs.${copyMoveReview?.action}`}</dd></div>
          <div><dt>Target</dt><dd>{copyMovePreflight.target?.label || copyMoveReview?.destinationPath}</dd></div>
          <div><dt>Impact</dt><dd>{Array.isArray(copyMovePreflight.impact) ? copyMovePreflight.impact.join(' ') : copyMovePreflight.impact || 'File tree operation will run on the host.'}</dd></div>
        </dl>
        <label>
          <span>Type <code>{copyMovePreflight.approval?.typedConfirmation}</code> to approve</span>
          <input bind:value={copyMoveTypedConfirmation} autocomplete="off" spellcheck="false" />
        </label>
        {#if explorerActionError}<p class="error-text">{explorerActionError}</p>{/if}
        <div class="dialog-actions">
          <button class="ghost" onclick={() => { copyMoveReview = null; copyMoveTypedConfirmation = ''; }} disabled={copyMoveLoading}>Cancel</button>
          <button
            class="primary"
            onclick={approveCopyMove}
            disabled={copyMoveLoading || copyMoveTypedConfirmation !== copyMovePreflight.approval?.typedConfirmation}
          >
            {#if copyMoveLoading}<Loader size={15} class="spin" />{/if}
            {copyMoveReview?.action === 'move' ? 'Move' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if deletePreflight}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-modal" role="dialog" aria-modal="true" aria-label="Delete approval">
        <button class="modal-close" title="Cancel" onclick={() => { deleteReview = null; deleteTypedConfirmation = ''; }}>
          <X size={16} />
        </button>
        <Trash2 size={24} />
        <h2>Move To Trash</h2>
        <p><strong>{deleteReview?.path}</strong> will be moved to trash through the backend approval contract.</p>
        <dl>
          <div><dt>Action</dt><dd>{deletePreflight.action || 'Delete item'}</dd></div>
          <div><dt>Target</dt><dd>{deletePreflight.target?.label || deletePreflight.target?.id || deleteReview?.path}</dd></div>
          <div><dt>Impact</dt><dd>{Array.isArray(deletePreflight.impact) ? deletePreflight.impact.join(' ') : deletePreflight.impact || 'This item will be moved to trash.'}</dd></div>
        </dl>
        <label>
          <span>Type <code>{deletePreflight.approval?.typedConfirmation}</code> to approve</span>
          <input bind:value={deleteTypedConfirmation} autocomplete="off" spellcheck="false" />
        </label>
        {#if explorerActionError}<p class="error-text">{explorerActionError}</p>{/if}
        <div class="dialog-actions">
          <button class="ghost" onclick={() => { deleteReview = null; deleteTypedConfirmation = ''; }} disabled={deleteLoading}>Cancel</button>
          <button
            class="primary"
            onclick={approveDelete}
            disabled={deleteLoading || deleteTypedConfirmation !== deletePreflight.approval?.typedConfirmation}
          >
            {#if deleteLoading}<Loader size={15} class="spin" />{/if}
            Move To Trash
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if overwritePreflight}
    <div class="modal-backdrop" role="presentation">
      <div class="approval-modal" role="dialog" aria-modal="true" aria-label="Overwrite approval">
        <button class="modal-close" title="Cancel" onclick={() => { overwriteReview = null; overwriteTypedConfirmation = ''; }}>
          <X size={16} />
        </button>
        <Shield size={24} />
        <h2>Approve File Overwrite</h2>
        <p>Saving will overwrite <strong>{overwriteReview?.path}</strong> through the backend file approval contract.</p>
        <dl>
          <div><dt>Action</dt><dd>{overwritePreflight.action || 'Overwrite file'}</dd></div>
          <div><dt>Target</dt><dd>{overwritePreflight.target?.label || overwritePreflight.target?.id || overwriteReview?.path}</dd></div>
          <div><dt>Impact</dt><dd>{Array.isArray(overwritePreflight.impact) ? overwritePreflight.impact.join(' ') : overwritePreflight.impact || 'Existing file content will be replaced.'}</dd></div>
        </dl>
        <label>
          <span>Type <code>{overwritePreflight.approval?.typedConfirmation}</code> to approve</span>
          <input bind:value={overwriteTypedConfirmation} autocomplete="off" spellcheck="false" />
        </label>
        {#if saveError}<p class="error-text">{saveError}</p>{/if}
        <div class="dialog-actions">
          <button class="ghost" onclick={() => { overwriteReview = null; overwriteTypedConfirmation = ''; }} disabled={saveLoading}>Cancel</button>
          <button
            class="primary"
            onclick={approveSave}
            disabled={saveLoading || overwriteTypedConfirmation !== overwritePreflight.approval?.typedConfirmation}
          >
            {#if saveLoading}<Loader size={15} class="spin" />{/if}
            Save File
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(.window .content:has(.nexus-term)) {
    padding: 0;
    overflow: hidden;
  }

  .nexus-term {
    --bg: #050b18;
    --panel: #07101d;
    --panel-2: #0b1424;
    --panel-3: #111b2d;
    --line: rgba(96, 140, 207, 0.24);
    --line-strong: rgba(122, 162, 247, 0.38);
    --text: #e8edf8;
    --muted: #8c9ab3;
    --accent: #5ea1ff;
    --accent-2: #9b6cff;
    --green: #52f27a;
    --danger: #ff6b7a;
    background:
      radial-gradient(circle at 24% 0%, rgba(83, 139, 255, 0.12), transparent 34%),
      linear-gradient(180deg, #07101d 0%, var(--bg) 100%);
    color: var(--text);
    display: grid;
    grid-template-rows: minmax(0, 1fr) 28px;
    height: 100%;
    min-height: 420px;
    overflow: hidden;
    font-size: 13px;
  }

  button, input, textarea {
    font: inherit;
  }

  button {
    border: 1px solid var(--line);
    background: rgba(15, 28, 50, 0.78);
    color: var(--text);
    min-height: 34px;
    border-radius: 7px;
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    background: rgba(6, 12, 23, 0.96);
    box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.03);
  }

  .panel-title, .panel-title span, .viewer-actions, .status-bar span, .mobile-tabs button, .dialog-actions, .search-row, .side-switcher {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-bar, small {
    color: var(--muted);
  }

  .viewer-actions button, .side-switcher button {
    width: 34px;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }

  .nexus-main {
    min-height: 0;
    display: grid;
    grid-template-columns:
      minmax(0, var(--explorer-pane-width))
      6px
      minmax(320px, var(--terminal-pane-width))
      6px
      minmax(0, 1fr);
    gap: 0;
    background: var(--line);
  }

  .panel {
    min-height: 0;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-title {
    min-height: 42px;
    padding: 0 12px;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px solid var(--line);
    background: rgba(12, 21, 38, 0.92);
    color: #dbe7ff;
  }

  .panel-title > span {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-title > span :global(svg) {
    flex-shrink: 0;
  }

  .side-rail {
    grid-column: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--line);
  }

  .side-tool {
    display: none;
  }

  .side-tool.desktop-active {
    display: flex;
  }

  .explorer-resizer {
    grid-column: 2;
  }

  .terminal-pane {
    grid-column: 3;
    grid-row: 1;
  }

  .terminal-resizer {
    grid-column: 4;
    grid-row: 1;
  }

  .viewer-pane {
    grid-column: 5;
    grid-row: 1;
  }

  .pane-resizer {
    border: 0;
    border-radius: 0;
    padding: 0;
    min-height: 0;
    background: rgba(96, 140, 207, 0.16);
    position: relative;
    z-index: 3;
  }

  .pane-resizer:hover,
  .nexus-main.resizing-explorer .explorer-resizer,
  .nexus-main.resizing-terminal .terminal-resizer {
    background: rgba(94, 161, 255, 0.55);
  }

  .pane-resizer.vertical {
    cursor: col-resize;
    min-width: 6px;
  }

  :global(body.nexus-resizing) {
    user-select: none;
  }

  :global(body.nexus-resizing-explorer),
  :global(body.nexus-resizing-terminal) {
    cursor: col-resize;
  }

  .side-switcher {
    flex: 0 0 auto;
    gap: 4px;
  }

  .shell-title-actions {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 4px;
    padding-left: 8px;
    border-left: 1px solid rgba(122, 162, 247, 0.18);
  }

  .shell-title-actions button {
    width: 28px;
    min-height: 28px;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }

  .side-switcher button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(94, 161, 255, 0.12);
  }

  .terminal-wrap {
    position: relative;
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .shell-tabbar {
    padding: 0 8px 0 0;
    gap: 0;
    background: rgba(7, 14, 26, 0.97);
  }

  .shell-tabs {
    min-width: 0;
    min-height: 100%;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
    scrollbar-width: thin;
  }

  .shell-tabs button {
    min-width: 96px;
    max-width: 184px;
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 9px;
    border-radius: 7px 7px 0 0;
    border-bottom-color: transparent;
    background: rgba(15, 28, 50, 0.5);
    white-space: nowrap;
    flex: 0 0 auto;
  }

  .shell-tabs button.active {
    border-color: var(--accent);
    border-bottom-color: rgba(7, 14, 26, 0.97);
    background: rgba(94, 161, 255, 0.18);
    color: #f3f7ff;
    box-shadow: inset 0 2px 0 rgba(94, 161, 255, 0.68);
  }

  .shell-tabs span {
    min-width: 0;
    flex: 1 1 auto;
    max-width: 118px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shell-stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .terminal-access-gate {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(4, 9, 18, 0.78);
    z-index: 8;
  }

  .terminal-approval-card {
    width: min(520px, 96%);
    max-height: 94%;
    overflow: auto;
    border: 1px solid rgba(122, 162, 247, 0.3);
    background: rgba(8, 18, 34, 0.96);
    border-radius: 8px;
    padding: 22px;
    box-shadow: 0 18px 58px rgba(0, 0, 0, 0.42);
  }

  .approval-heading {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    color: #f3f7ff;
  }

  .approval-heading h2 {
    margin: 0;
    font-size: 18px;
  }

  .terminal-approval-card p {
    color: var(--muted);
    line-height: 1.45;
  }

  .session-progress {
    margin: 10px 0 12px;
  }

  .modal-backdrop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgba(9, 13, 18, 0.72);
    z-index: 2;
  }

  .approval-modal {
    width: min(520px, 100%);
    max-height: 92%;
    overflow: auto;
    background: #0b1424;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 18px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  }

  .approval-modal h2 {
    margin: 10px 0 8px;
    font-size: 18px;
  }

  .approval-modal p {
    color: var(--muted);
    line-height: 1.45;
  }

  dl {
    display: grid;
    gap: 8px;
    margin: 12px 0;
  }

  dl div {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  label {
    display: grid;
    gap: 8px;
    margin: 12px 0;
  }

  input, textarea {
    background: #070f1c;
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 9px 10px;
    min-width: 0;
  }

  code {
    color: #f5d67b;
    background: rgba(245, 214, 123, 0.1);
    padding: 1px 4px;
    border-radius: 4px;
  }

  .primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #f8fbff;
    border-color: transparent;
    padding: 0 13px;
    font-weight: 700;
  }

  .ghost {
    padding: 0 13px;
  }

  .viewer-actions button {
    min-height: 30px;
    width: 32px;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }

  .viewer-actions {
    flex: 0 0 auto;
  }

  .viewer-actions button.active {
    border-color: var(--accent);
    color: #f3f7ff;
    background: linear-gradient(135deg, rgba(77, 130, 255, 0.76), rgba(124, 85, 255, 0.64));
  }

  .filter-input {
    margin: 10px;
  }

  .explorer-context-menu {
    position: fixed;
    z-index: 10000;
    min-width: 210px;
    padding: 6px;
    border: 1px solid rgba(122, 162, 247, 0.28);
    border-radius: 8px;
    background: rgba(7, 14, 26, 0.98);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
  }

  .explorer-context-menu button {
    width: 100%;
    min-height: 32px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    text-align: left;
    padding: 0 8px;
  }

  .explorer-context-menu button:hover {
    background: rgba(94, 161, 255, 0.14);
  }

  .explorer-context-menu button.danger {
    color: #ffc4c9;
  }

  .explorer-context-menu span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-separator {
    height: 1px;
    margin: 5px 4px;
    background: var(--line);
  }

  .create-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 34px 34px;
    gap: 6px;
    padding: 0 10px 10px;
  }

  .create-row input {
    min-height: 34px;
  }

  .create-row button {
    min-height: 34px;
    padding: 0;
    display: inline-grid;
    place-items: center;
  }

  .tree-list, .result-list {
    min-height: 0;
    overflow: auto;
    padding: 4px 8px 10px;
  }

  .file-row {
    width: 100%;
    min-height: 38px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    text-align: left;
    padding: 0 8px;
  }

  .tree-row {
    width: 100%;
    min-height: 30px;
    border-radius: 6px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 4px;
    padding-left: calc(8px + var(--depth) * 18px);
  }

  .tree-main {
    min-width: 0;
    min-height: 30px;
    border: 0;
    background: transparent;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    text-align: left;
    padding: 0 8px 0 0;
  }

  .chevron {
    width: 18px;
    height: 18px;
    min-height: 18px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    display: inline-grid;
    place-items: center;
    color: #a7b7d2;
  }

  .file-row:hover, .tree-row:hover, .tree-row.selected {
    background: linear-gradient(90deg, rgba(65, 94, 165, 0.38), rgba(65, 94, 165, 0.12));
  }

  .file-row span, .file-row small, .tree-main span, .tree-main small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor {
    flex: 1;
    width: auto;
    min-height: 0;
    margin: 0;
    border: 0;
    border-radius: 0;
    resize: none;
    font-family: "D2Coding", "Noto Sans Mono", Menlo, Monaco, "Courier New", monospace;
    line-height: 1.48;
    tab-size: 2;
    background: #07101d;
  }

  .doc-tabs {
    min-height: 36px;
    display: flex;
    gap: 4px;
    padding: 5px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    background: #0a1322;
  }

  .doc-tabs button {
    max-width: 180px;
    min-width: 0;
    min-height: 26px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 7px;
    color: var(--muted);
    white-space: nowrap;
  }

  .doc-tabs button.active {
    color: var(--text);
    border-color: var(--accent);
    background: rgba(64, 92, 166, 0.42);
  }

  .doc-tabs span {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .doc-tabs button :global(svg) {
    flex: 0 0 16px;
    width: 13px;
    height: 13px;
  }

  .markdown-preview {
    overflow: auto;
    padding: 18px;
    line-height: 1.6;
    color: #dce7f7;
  }

  .markdown-split {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    border-top: 1px solid var(--line);
  }

  .markdown-split .editor {
    border-right: 1px solid var(--line);
  }

  .image-preview {
    min-height: 0;
    flex: 1;
    display: grid;
    place-items: center;
    padding: 18px;
    background:
      linear-gradient(45deg, rgba(255,255,255,0.025) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(255,255,255,0.025) 25%, transparent 25%),
      #07101d;
    background-size: 24px 24px;
  }

  .image-preview img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.38);
  }

  .markdown-preview :global(h1),
  .markdown-preview :global(h2),
  .markdown-preview :global(h3),
  .markdown-preview :global(h4) {
    margin: 0 0 12px;
  }

  .markdown-preview :global(p), .markdown-preview :global(ul), .markdown-preview :global(pre) {
    margin: 0 0 14px;
  }

  .markdown-preview :global(pre) {
    background: #07101d;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 12px;
    overflow: auto;
  }

  .search-row {
    padding: 12px;
  }

  .search-row input {
    flex: 1;
  }

  .search-row button {
    width: 40px;
    display: grid;
    place-items: center;
  }

  .empty-state, .inline-error {
    color: var(--muted);
    padding: 18px;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .inline-error {
    margin: 10px;
    color: #ffd7d4;
    background: rgba(255, 123, 114, 0.09);
    border: 1px solid rgba(255, 123, 114, 0.2);
    border-radius: 6px;
    display: grid;
  }

  .error-text {
    color: var(--danger);
    margin: 8px 12px;
  }

  .status-bar {
    border-top: 1px solid var(--line);
    border-bottom: 0;
    font-size: 12px;
    overflow: hidden;
    background: #070d18;
  }

  .status-bar span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-bar .dirty {
    color: #f5d67b;
  }

  .mobile-tabs {
    display: none;
  }

  .modal-backdrop {
    position: fixed;
    z-index: 2000;
  }

  .approval-modal {
    position: relative;
  }

  .modal-close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 32px;
    display: grid;
    place-items: center;
  }

  :global(.nexus-term .spin) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 760px) {
    .nexus-term {
      grid-template-rows: minmax(0, 1fr) 26px 62px;
      min-height: 360px;
    }

    .nexus-main {
      display: block;
      background: var(--panel);
    }

    .terminal-pane, .side-rail, .explorer-pane, .viewer-pane, .search-pane {
      display: none;
      height: 100%;
    }

    .pane-resizer {
      display: none;
    }

    .side-tool.desktop-active {
      display: none;
    }

    .terminal-pane.mobile-active {
      display: flex;
    }

    .viewer-pane.mobile-active {
      display: flex;
    }

    .side-rail.mobile-active {
      display: block;
    }

    .side-rail.mobile-active .panel.mobile-active {
      display: flex;
    }

    .side-rail {
      background: var(--panel);
    }

    .markdown-split {
      grid-template-columns: 1fr;
    }

    .markdown-split .editor {
      min-height: 42%;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }

    .viewer-actions {
      gap: 4px;
    }

    .viewer-actions button {
      min-width: 38px;
      min-height: 36px;
    }

    .status-bar {
      font-size: 11px;
      gap: 8px;
    }

    .mobile-tabs {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      background: #10161d;
      border-top: 1px solid var(--line);
    }

    .mobile-tabs button {
      justify-content: center;
      flex-direction: column;
      gap: 3px;
      border: 0;
      border-radius: 0;
      min-height: 58px;
      font-size: 11px;
      color: var(--muted);
      background: transparent;
    }

    .mobile-tabs button.active {
      color: var(--accent);
      background: rgba(87, 199, 153, 0.08);
    }

    .approval-modal {
      max-height: none;
      margin: auto 0;
    }

    dl div {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
