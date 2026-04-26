#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_FRONTEND_URL = 'http://127.0.0.1:5173';
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';

const frontendUrl = process.env.WEBOS_FRONTEND_URL || DEFAULT_FRONTEND_URL;
const backendUrl = process.env.WEBOS_BACKEND_URL || DEFAULT_BACKEND_URL;
const timeoutMs = Number(process.env.WEBOS_UI_SMOKE_TIMEOUT_MS || 3500);
const repoRoot = path.resolve(__dirname, '..');
const promptPattern = /globalThis\.(confirm|prompt)|\bconfirm\s*\(|\bprompt\s*\(|terminal:approval/g;

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertFileIncludes(relativePath, patterns, label) {
  const text = readRepoFile(relativePath);
  const missing = patterns.filter((pattern) => !pattern.test(text));
  if (missing.length > 0) {
    throw new Error(`${label} is missing expected workflow markers: ${missing.map((item) => item.source).join(', ')}`);
  }
  return `${label} source contract`;
}

function checkNoNativePrompts() {
  const targets = [
    'client/src/apps/system/docker-manager/DockerManager.svelte',
    'client/src/apps/system/package-center/PackageCenter.svelte',
    'client/src/apps/system/terminal/Terminal.svelte',
    'client/src/apps/system/settings/BackupJobManager.svelte'
  ];
  const offenders = [];
  for (const target of targets) {
    const text = readRepoFile(target);
    const matches = text.match(promptPattern);
    if (matches) {
      offenders.push(`${target}: ${Array.from(new Set(matches)).join(', ')}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(`native prompt cleanup regressed:\n${offenders.join('\n')}`);
  }
  return 'targeted system apps native-prompt free';
}

function checkWorkflowSourceContracts() {
  return [
    assertFileIncludes('client/src/core/Login.svelte', [
      /login\(data\.token\)/,
      /Invalid username or password|Login failed/i
    ], 'login recoverability'),
    assertFileIncludes('client/src/apps/system/file-explorer/FileExplorer.svelte', [
      /preflightDelete/,
      /approveDelete/,
      /executeDelete/,
      /preflightEmptyTrash/,
      /approveEmptyTrash/,
      /executeEmptyTrash/,
      /preflightOverwrite/,
      /approveOverwrite/,
      /executeOverwrite/,
      /preflightRestore/,
      /approveRestore/,
      /executeRestore/,
      /preflightExtract/,
      /approveExtract/,
      /executeExtract/
    ], 'File Station destructive preflight'),
    assertFileIncludes('client/src/apps/system/package-center/PackageCenter.svelte', [
      /preflightPackageDelete/,
      /approvePackageDelete/,
      /openPackageDeleteReview/,
      /packageDeleteTypedInput/,
      /installLifecycleTypedInput/,
      /zipImportLifecycleTypedInput/,
      /rollbackLifecycleTypedInput/,
      /assertLifecycleTypedConfirmation/
    ], 'Package Center approval'),
    assertFileIncludes('client/src/apps/system/package-center/api.js', [
      /approvePackageLifecycle\(preflight = \{\}, typedConfirmation = ''\)/,
      /typedConfirmation: String\(typedConfirmation \|\| ''\)/
    ], 'Package lifecycle typed approval API'),
    assertFileIncludes('client/src/apps/system/transfer/TransferUI.svelte', [
      /overwrite/i,
      /approval/i,
      /durable|job/i
    ], 'Transfer durable approval state'),
    assertFileIncludes('client/src/core/components/SandboxAppFrame.svelte', [
      /SANDBOX_BRIDGE_READY_TIMEOUT/,
      /raw-ticket|ticket/i
    ], 'Sandbox frame timeout and ticket state')
    ,
    assertFileIncludes('client/src/apps/addons/document-viewer/package/index.html', [
      /WebOS\.files\.rawTicket/,
      /WebOS\.files\.rawUrl\(rawTicket\)/
    ], 'Document Viewer raw ticket contract'),
    assertFileIncludes('client/src/apps/addons/model-viewer/package/index.html', [
      /WebOS\.files\.rawTicket/,
      /profile:\s*'media'/,
      /WebOS\.files\.rawUrl\(rawTicket\)/
    ], 'Model Viewer raw ticket contract'),
    assertFileIncludes('client/src/apps/addons/code-editor/package/index.html', [
      /WebOS\.files\.writePreflight/,
      /WebOS\.files\.approveWrite/,
      /operationId/,
      /targetHash/
    ], 'Code Editor scoped overwrite approval'),
    assertFileIncludes('server/routes/sandbox.js', [
      /SANDBOX_RAW_GRANT_URL_DISABLED/,
      /status\(410\)/
    ], 'Sandbox legacy raw endpoint disabled'),
    assertFileIncludes('client/src/apps/system/terminal/Terminal.svelte', [
      /sessionPreflight/,
      /typedConfirmation/,
      /approveAndStartSession/,
      /Approve And Start/
    ], 'Terminal typed session approval UX')
  ];
}

function withTimeout(promise, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return promise(controller.signal)
    .finally(() => clearTimeout(timer))
    .catch((err) => {
      if (err?.name === 'AbortError') {
        throw new Error(`${label} timed out after ${timeoutMs}ms`);
      }
      if (err instanceof TypeError && /fetch failed/i.test(err.message || '')) {
        throw new Error(`${label} is unreachable; start the backend and frontend dev servers first`);
      }
      throw err;
    });
}

async function fetchText(url, label) {
  return withTimeout(async (signal) => {
    const res = await fetch(url, { signal });
    const text = await res.text();
    return { res, text };
  }, label);
}

async function checkBackend() {
  const { res } = await fetchText(`${backendUrl.replace(/\/+$/, '')}/health`, 'backend health');
  if (!res.ok) {
    throw new Error(`backend health returned HTTP ${res.status}`);
  }
  return `backend health ${res.status}`;
}

async function checkFrontendShell() {
  const { res, text } = await fetchText(frontendUrl, 'frontend shell');
  if (!res.ok) {
    throw new Error(`frontend shell returned HTTP ${res.status}`);
  }
  if (!/<div[^>]+id=["']app["']/i.test(text) && !/src=["'][^"']*\/src\/main\./i.test(text)) {
    throw new Error('frontend shell did not expose the app mount or Vite entry script');
  }
  return `frontend shell ${res.status}`;
}

async function main() {
  const results = [];
  results.push(checkNoNativePrompts());
  results.push(...checkWorkflowSourceContracts());
  results.push(await checkBackend());
  results.push(await checkFrontendShell());

  console.log('UI smoke gate passed:');
  for (const result of results) {
    console.log(`- ${result}`);
  }
  console.log('');
  console.log('Coverage: deterministic workflow source guards, local server reachability, and frontend shell boot contract.');
  console.log('This is still not a full browser automation gate; click-through workflow coverage remains blocked until a browser runner is added.');
}

main().catch((err) => {
  console.error(`UI smoke gate failed: ${err.message}`);
  process.exit(1);
});
