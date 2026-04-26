# AI Vibe Coding Guide For Addons

Status: `[ACTIVE]`

Use this file when an AI agent is asked to create or modify a My Web OS addon.
The goal is to keep addon work fast without weakening Host/file/package
contracts.

## Non-Negotiable Rules

1. Build ordinary addons as package apps, not core shell code.
2. Do not put addon feature logic into:
   - `client/src/core/Desktop.svelte`
   - `client/src/core/Window.svelte`
   - `client/src/core/Spotlight.svelte`
3. Use `runtime.type: "sandbox-html"` unless the task explicitly needs a
   trusted built-in system app.
4. Use `/api/sandbox/sdk.js` and wait for `window.WebOS.ready()`.
5. Declare minimal permissions in `manifest.json`.
6. Host file access must go through File Station grants and `WebOS.files.*`.
7. Do not call backend approval routes directly from addon code.
8. Do not call `WebOS.files.approveWrite()`.
9. Do not build raw URLs from `{ path, grantId }`.
10. Do not send legacy approval shortcuts such as `{ approved: true }`.

## Before Editing

1. Read `QUICKSTART_FIRST_ADDON_EN.md` if creating a new addon.
2. Read `CORE_INTEGRATION_MAP.md` before using File Station, launch data,
   grants, raw tickets, parent approval, or singleton relaunch behavior.
3. Read `PACKAGE_LIFECYCLE_AND_DISTRIBUTION.md` before changing install,
   update, ZIP, registry, rollback, manifest update, or backup flows.
4. Do not invent SDK methods. If the needed method is absent from
   `SDK_API_REFERENCE.md`, stop and classify it as a core contract change.

## Default Implementation Target

Create or edit:

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
```

If the addon is a built-in source package, also update:

```text
client/src/apps/addons/<addon>/package/
  manifest.json
  index.html
```

Keep those runtime copies behaviorally aligned.

## Task Framing For AI Agents

Before coding, classify the addon:

```text
Type:
- launcher-only utility
- file viewer
- file editor
- file creator
- preview provider
- settings panel metadata
- background service metadata only
- system app change (avoid unless requested)

Host risk:
- no host access
- host read via grant
- host write via grant
- overwrite risk
- package lifecycle risk
```

Then choose the smallest useful slice:

```text
MVP:
- manifest loads
- index.html starts inside sandbox iframe
- visible ready/error state
- one useful action works
- package doctor passes
- smoke check does not regress
```

## Manifest Template

Use this for a basic addon:

```json
{
  "id": "my-addon",
  "title": "My Addon",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": [
    "ui.notification",
    "app.data.list",
    "app.data.read",
    "app.data.write"
  ]
}
```

Add host file permissions only when needed:

```json
{
  "permissions": [
    "ui.notification",
    "host.file.read",
    "host.file.write"
  ]
}
```

## Sandbox HTML Pattern

Every addon should have explicit startup, ready, and error states.

```html
<div id="status">Starting...</div>
<script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
<script>
  const statusEl = document.getElementById('status');

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'error' : 'status';
  }

  async function main() {
    await window.WebOS.ready();
    setStatus('Ready');
  }

  main().catch((err) => {
    setStatus(err.message || 'Addon failed to start', true);
  });
</script>
```

Do not rely on top-level SDK calls before `WebOS.ready()`.

Iframe limits:

- The sandbox iframe currently uses `allow-scripts` only.
- Do not depend on cookies, `localStorage`, `sessionStorage`, forms, popups,
  browser downloads, top navigation, or parent DOM access.
- Do not fetch arbitrary backend APIs directly from addon code; use the SDK.

## UI Rules For Generated Addons

Use compact tool UI:

- toolbar at the top
- main work area
- status/error line
- no marketing hero
- no nested card-heavy layout
- no hidden failure states
- no browser `confirm()` or `prompt()` for risky operations

Use plain HTML/CSS first. Add a framework only if the addon already has one or
the task explicitly asks for it.

## Current SDK Surface

Use:

```js
await window.WebOS.ready();
window.WebOS.getContext();
window.WebOS.getApiPolicy();
window.WebOS.ui.notification({ title, message, type });
window.WebOS.window.open(appId, data);
window.WebOS.system.info();
window.WebOS.app.data.list({ path });
window.WebOS.app.data.read({ path });
window.WebOS.app.data.write({ path, content });
window.WebOS.files.read({ path, grantId });
window.WebOS.files.rawTicket({ path, grantId, profile });
window.WebOS.files.rawUrl(ticket);
window.WebOS.files.write({ path, grantId, content, overwrite: true });
```

Avoid:

```js
window.WebOS.files.approveWrite();
window.WebOS.files.rawUrl({ path, grantId });
fetch('/api/sandbox/.../file/write/approve');
```

## Host File Reader Pattern

```js
await window.WebOS.ready();

const context = window.WebOS.getContext();
const launchData = context?.app?.launchData || {};
const file = launchData?.fileContext?.file;
const permission = launchData?.fileContext?.permissionContext;

if (!file?.path || !permission?.grantId) {
  throw new Error('Open this addon from File Station with a file grant.');
}

const result = await window.WebOS.files.read({
  path: file.path,
  grantId: permission.grantId
});
```

For singleton file viewers/editors, also handle relaunch data:

```js
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const payload = event.data || {};
  if (payload.type === 'webos:launch-data') {
    loadFromLaunchData(payload.launchData || {});
  }
});
```

Do not use `context.launchData`; current launch data is
`context.app.launchData`.

## Host File Writer Pattern

```js
await window.WebOS.files.write({
  path: file.path,
  grantId: permission.grantId,
  content: nextContent,
  overwrite: true
});
```

If backend approval is needed, the parent Web OS frame opens the approval dialog
and retries the write. Addon code should not mint or receive approval nonces
except as part of the parent-mediated retry.

## Package Lifecycle Pattern

Package lifecycle work is not ordinary addon iframe code. Fresh install, ZIP
import, registry install/update, rollback, and manifest update use:

```text
preflight -> user typed confirmation -> /api/packages/lifecycle/approve
-> execute with approval { operationId, nonce, targetHash }
```

Never satisfy typed confirmation by copying
`preflight.approval.typedConfirmation` in code. It must be user-entered in
trusted Package Center UI.

## Preview URL Pattern

```js
const ticket = await window.WebOS.files.rawTicket({
  path: file.path,
  grantId: permission.grantId,
  profile: 'preview'
});

const url = window.WebOS.files.rawUrl(ticket);
```

Use this for image, PDF, model, video, and other raw preview flows.

## File Association Pattern

```json
{
  "fileAssociations": [
    {
      "extensions": ["md", "txt"],
      "actions": ["open", "edit", "preview"],
      "defaultAction": "open"
    }
  ]
}
```

For context menu integration:

```json
{
  "contributes": {
    "fileContextMenu": [
      {
        "label": "Open in My Addon",
        "action": "open",
        "extensions": ["md", "txt"]
      }
    ]
  }
}
```

## Verification Commands

For a narrow addon change:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
npm run verify:ui-smoke
git diff --check
```

When touching package lifecycle, registry, templates, or shared SDK:

```bash
npm run verify
```

If `verify:ui-smoke` needs reachability checks, start backend and frontend dev
servers first.

## AI Output Checklist

When done, report:

- files changed
- manifest permissions added or removed
- SDK APIs used
- install method tested
- verification commands and results
- skipped checks and why
- remaining limits

## Common Failure Modes

Blank iframe:

- missing SDK script
- script error before visible error render
- entry path does not match manifest
- bridge timeout due missing `WebOS.ready()`

Permission denied:

- manifest does not declare permission
- file grant missing or expired
- app id does not match grant
- parent approval was denied or another approval is already open

Overwrite fails:

- addon did not use `overwrite: true`
- user denied parent approval
- approval expired
- target file changed after preflight

Raw preview fails:

- addon used `rawUrl({ path, grantId })`
- raw ticket expired
- profile mismatch
- file changed after ticket issue

Core contract needed:

- new SDK method is required
- File Station does not provide the required launch/grant shape
- addon needs cloud-file grants
- addon needs background execution
- install/update behavior is missing from Package Center lifecycle
