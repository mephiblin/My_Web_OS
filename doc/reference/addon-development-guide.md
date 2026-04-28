# Addon Development Guide

Status: `[ACTIVE]`

This is the practical framework for building My Web OS addons.
For the expanded multi-file reference pack, see `doc/Addon_Dev_Ref/README.md`.
For broader package lifecycle policy, see `doc/reference/package-ecosystem-guide.md`.
For the core/app split, see `doc/reference/app-development-model.md`.
For the authoritative boundary between addons and core-owned features, see
`doc/reference/core-system-core-app-addon-boundaries.md`.

## 1. Default Addon Shape

New ordinary addons should be package apps, not core desktop code.

Use this structure:

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
  assets/
  vendor/
```

For built-in addon source that is still developed in the client tree, keep the
package runtime copy in sync:

```text
client/src/apps/addons/<addon>/
  components/
  services/
  package/
    manifest.json
    index.html

server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
```

Core files such as `client/src/core/Desktop.svelte`,
`client/src/core/Window.svelte`, and `client/src/core/Spotlight.svelte` should
only change when adding a generic platform capability.

## 2. Manifest Minimum

Every package addon needs `manifest.json`.

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
    "app.data.read",
    "app.data.write"
  ]
}
```

Permission rules:

- Declare the smallest permission set.
- Use `host.file.read` only when the addon needs host file reads through a
  File Station grant.
- Use `host.file.write` only when the addon writes host files through a grant.
- Host overwrite approval is parent-owned. Addons call
  `WebOS.files.write({ overwrite: true })`; they do not approve themselves.

## 3. Runtime Model

Sandbox addons are loaded inside a Web OS-owned iframe.

The platform owns:

- iframe creation and sandbox attributes
- SDK context handshake
- permission checks
- approval dialogs for risky host writes
- raw ticket issuance
- package lifecycle

The addon owns:

- HTML/CSS/JS UI
- app-specific state and behavior
- visible empty/error/loading states
- manifest metadata
- app-owned data files

Include the SDK in `index.html`:

```html
<script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
<script>
  async function main() {
    await window.WebOS.ready();
    const info = await window.WebOS.system.info();
    console.log(info);
  }
  main().catch((err) => {
    document.body.textContent = err.message || 'Addon failed to start';
  });
</script>
```

Do not assume the SDK context is ready before `WebOS.ready()` resolves.

## 4. UI Construction Standard

Addons should feel like focused tools, not landing pages.

Recommended layout:

```text
body
  header / toolbar
  optional controls row
  main work area
  status or error line
```

Baseline CSS:

```css
html,
body {
  margin: 0;
  height: 100%;
  color: #e5e7eb;
  background: #111827;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  border: 1px solid #374151;
  border-radius: 6px;
  background: #1f2937;
  color: #f9fafb;
  padding: 6px 10px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status {
  min-height: 20px;
  color: #93c5fd;
  overflow-wrap: anywhere;
}

.error {
  color: #fecaca;
}
```

UI rules:

- Show a visible loading state for async startup.
- Show missing launch context as a visible message, not a blank app.
- Keep controls compact and predictable.
- Use native controls for forms unless the addon has its own component system.
- Keep text inside buttons short.
- Avoid browser `confirm()` and `prompt()` for risky operations.
- Never hide host-risk decisions inside addon code.

## 5. SDK API

Current SDK entrypoint:

```js
await window.WebOS.ready();
```

Context and policy:

```js
const context = window.WebOS.getContext();
const policy = window.WebOS.getApiPolicy();
```

Notifications:

```js
await window.WebOS.ui.notification({
  title: 'My Addon',
  message: 'Done',
  type: 'success'
});
```

Open another app:

```js
await window.WebOS.window.open('package-center', { from: 'my-addon' });
```

System info:

```js
const overview = await window.WebOS.system.info();
```

App data:

```js
await window.WebOS.app.data.write({
  path: 'settings.json',
  content: JSON.stringify({ theme: 'dark' }, null, 2)
});

const saved = await window.WebOS.app.data.read({
  path: 'settings.json'
});
```

Host file read from File Station launch data:

```js
await window.WebOS.ready();
const context = window.WebOS.getContext();
const file = context?.launchData?.fileContext?.file;
const grant = context?.launchData?.fileContext?.permissionContext;

if (!file?.path || !grant?.grantId) {
  throw new Error('Open this addon from File Station to read a host file.');
}

const result = await window.WebOS.files.read({
  path: file.path,
  grantId: grant.grantId
});
```

Raw preview URL:

```js
const ticket = await window.WebOS.files.rawTicket({
  path: file.path,
  grantId: grant.grantId,
  profile: 'preview'
});

const url = window.WebOS.files.rawUrl(ticket);
```

Host file write:

```js
await window.WebOS.files.write({
  path: file.path,
  grantId: grant.grantId,
  content: nextText,
  overwrite: true
});
```

If overwrite approval is required, the Web OS parent frame opens the approval
dialog and retries the write with scoped approval evidence. Addon code should
not call approval endpoints directly.

Compatibility note:

```js
await window.WebOS.files.approveWrite();
```

This rejects with `WEBOS_APPROVAL_PARENT_ONLY` and must not be used in new
addons.

## 6. File Associations And Extension Points

Use `fileAssociations` to make an addon available from File Station.

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

Use `contributes` for native-feeling integration:

```json
{
  "contributes": {
    "fileContextMenu": [
      {
        "label": "Open in My Addon",
        "action": "open",
        "extensions": ["md", "txt"]
      }
    ],
    "fileCreateTemplates": [
      {
        "label": "Markdown File",
        "name": "Untitled.md",
        "extension": "md",
        "content": "# Untitled\n\n",
        "action": "edit",
        "openAfterCreate": true
      }
    ],
    "previewProviders": [
      { "label": "Markdown Preview", "extensions": ["md"] }
    ],
    "widgets": [
      {
        "id": "compact-status",
        "label": "Compact Status",
        "entry": "widget.html",
        "defaultSize": { "w": 320, "h": 220 },
        "minSize": { "w": 220, "h": 140 }
      }
    ]
  }
}
```

Current extension point status:

- `fileContextMenu`: active
- `fileCreateTemplates`: active
- `previewProviders`: active through explicit user handoff and temporary grants
- `thumbnailProviders`: active for provider discovery and explicit handoff
- `widgets`: active; Package Center validates entries and Widget Store surfaces installed package widgets
- `settingsPanels`: validated metadata, later Package Center launch step
- `backgroundServices`: validated metadata only; no auto execution yet

## 7. Installation Methods

### Direct Inventory Development

Use this for local development:

```text
server/storage/inventory/apps/<app-id>/manifest.json
server/storage/inventory/apps/<app-id>/index.html
```

Then restart or refresh the Web OS app registry view as needed.

Run:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
npm run verify:ui-smoke
```

### Package Center ZIP Import

Create a zip whose root contains:

```text
manifest.json
index.html
assets/
vendor/
```

Import it through Package Center. ZIP import should use the same lifecycle
policy as registry install: preflight, approval when needed, backup before
overwrite, and rollback evidence.

### Git Registry Install

Publish:

```text
webos-store.json
releases/<addon>.zip
```

The store entry points to a zip artifact. Package Center installs from the
registry source and records lifecycle metadata.

See `doc/reference/community-registry-and-presets.md`.

## 8. Starter Addon

Minimal `manifest.json`:

```json
{
  "id": "hello-addon",
  "title": "Hello Addon",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": ["ui.notification", "app.data.read", "app.data.write"]
}
```

Minimal `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hello Addon</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr auto;
        background: #111827;
        color: #e5e7eb;
        font-family: system-ui, sans-serif;
      }
      header,
      footer {
        padding: 10px;
        border-bottom: 1px solid #374151;
      }
      main {
        padding: 12px;
      }
      button {
        border: 1px solid #374151;
        border-radius: 6px;
        background: #1f2937;
        color: #f9fafb;
        padding: 6px 10px;
      }
      #status {
        color: #93c5fd;
      }
    </style>
  </head>
  <body>
    <header>Hello Addon</header>
    <main>
      <button id="save" type="button">Save State</button>
    </main>
    <footer id="status">Loading...</footer>

    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const status = document.getElementById('status');
      const save = document.getElementById('save');

      function setStatus(text) {
        status.textContent = text;
      }

      async function main() {
        await window.WebOS.ready();
        setStatus('Ready');

        save.addEventListener('click', async () => {
          await window.WebOS.app.data.write({
            path: 'state.json',
            content: JSON.stringify({ savedAt: new Date().toISOString() }, null, 2)
          });
          await window.WebOS.ui.notification({
            title: 'Hello Addon',
            message: 'State saved',
            type: 'success'
          });
          setStatus('Saved');
        });
      }

      main().catch((err) => {
        setStatus(err.message || 'Startup failed');
        status.className = 'error';
      });
    </script>
  </body>
</html>
```

## 9. Security Rules

Do:

- wait for `WebOS.ready()`
- declare minimal permissions
- handle missing file grants
- use `rawTicket()` then `rawUrl(ticket)` for previews
- let the parent frame own overwrite approval
- show explicit error states
- test install/update/remove/rollback for distributed addons

Do not:

- call backend approval routes directly from addon code
- call `approveWrite()`
- build raw URLs from `{ path, grantId }`
- send `{ approved: true }`
- store host secrets in app data
- assume host paths are available without a grant
- put app feature logic into core desktop/window files

## 10. Verification Checklist

Use narrow checks while developing:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
npm run verify:ui-smoke
npm --prefix client run build
```

Before publishing or sharing:

```bash
npm run verify
git diff --check
```

Manual smoke:

1. Open addon from launcher.
2. Open addon from File Station when file associations apply.
3. Check missing grant state.
4. Read a granted file.
5. Write a granted file if the addon declares `host.file.write`.
6. Try overwrite and confirm the parent-owned approval dialog appears.
7. Close/reopen the window.
8. Remove/reinstall or update through Package Center when distributed.

## 11. When Core Changes Are Allowed

Addon work should stay inside package files unless a generic platform gap exists.

Core changes are justified when adding:

- a new manifest extension point
- a new SDK API available to multiple addons
- a new package lifecycle operation
- a new File Station handoff contract
- a security or approval boundary fix

Core changes are not justified for:

- addon-specific toolbar behavior
- addon-specific parsing/rendering
- addon-specific settings UI
- addon-specific file format handling that can live in the addon
