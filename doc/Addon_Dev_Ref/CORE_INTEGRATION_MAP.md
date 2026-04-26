# Core Integration Map

Status: `[ACTIVE]`

This is the contract between ordinary sandbox addons and the Web OS core.
Use it before editing core files or assuming an API exists.

## Registry And Launch

Installed package apps are discovered from:

```text
server/storage/inventory/apps/<app-id>/manifest.json
```

The desktop registry is loaded from `/api/system/apps`. The client registry
store caches that result after first load; reload the browser after direct
inventory edits, or trigger a forced registry refresh from trusted core UI.

Ordinary UI addons should use:

```json
{
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  }
}
```

`type: "service"` packages are valid lifecycle records but are skipped by the
desktop app list. `service`, `hybrid`, and managed process runtimes are not the
stable ordinary addon target.

Inventory packages may replace built-in `standard` addons with the same id.
They do not replace `system` apps.

## Sandbox Iframe Boundary

Sandbox HTML is served from:

```text
/api/sandbox/<app-id>/<entry>
```

The iframe is currently:

```html
<iframe sandbox="allow-scripts">
```

Implications:

- The child iframe has an opaque origin.
- Parent and child DOM access is blocked.
- Do not depend on cookies, `localStorage`, `sessionStorage`, forms, popups,
  downloads, top navigation, or direct parent DOM calls.
- Use `/api/sandbox/sdk.js` and `postMessage` through the SDK.
- Static package assets may be loaded by relative path from the entry page.
- `/api/sandbox/<app-id>/manifest.json` is intentionally not served as a
  static asset.
- Do not call arbitrary `/api/*` routes from addon code. Use SDK methods.

## Context Shape

Use:

```js
const context = await window.WebOS.ready();
const app = context?.app || {};
const launchData = app.launchData || {};
```

The current context shape is:

```js
{
  type: 'webos:context',
  app: {
    id,
    title,
    description,
    permissions,
    runtime,
    sdkUrl,
    launchData
  },
  capabilities,
  apiPolicy
}
```

Important: `launchData` lives at `context.app.launchData`, not
`context.launchData`.

## Relaunch And Singleton Data

If an existing singleton window receives new launch data, the parent frame
sends:

```js
{
  type: 'webos:launch-data',
  launchData
}
```

The SDK does not automatically rewrite your local variables. Addons that can
open different files in the same window should listen for this event:

```js
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const payload = event.data || {};
  if (payload.type === 'webos:launch-data') {
    loadFromLaunchData(payload.launchData || {});
  }
});
```

## File Station Handoff

Normal File Station open/edit launch data:

```js
{
  path: '/absolute/host/path/example.txt',
  fileContext: {
    source: 'file-station',
    file: {
      path: '/absolute/host/path/example.txt',
      name: 'example.txt',
      extension: 'txt',
      mode: 'read' // or 'readwrite'
    },
    permissionContext: {
      grantId: 'fg_...',
      scope: 'single-file',
      expiresOnWindowClose: true
    }
  }
}
```

Use it like this:

```js
const context = await window.WebOS.ready();
const launchData = context?.app?.launchData || {};
const file = launchData?.fileContext?.file || {};
const permission = launchData?.fileContext?.permissionContext || {};

if (!file.path || !permission.grantId) {
  throw new Error('Open this addon from File Station with a file grant.');
}
```

Preview provider launch data adds `previewContext`:

```js
{
  path: '/absolute/host/path/example.txt',
  previewContext: {
    source: 'file-station-preview',
    kind: 'preview',
    provider: {
      appId: 'my-addon',
      label: 'My Preview'
    }
  },
  fileContext: {
    source: 'file-station',
    file: {
      path: '/absolute/host/path/example.txt',
      name: 'example.txt',
      extension: 'txt',
      mode: 'read'
    },
    permissionContext: {
      grantId: 'fg_...',
      scope: 'single-file',
      expiresOnWindowClose: true
    }
  }
}
```

Cloud file handoff currently uses `source: "file-station-cloud"` and
`scope: "cloud-file"` with an empty `grantId`. The sandbox host file API cannot
read `cloud://` paths through `WebOS.files.*` yet. Show a clear unsupported or
missing-grant message instead of retrying.

## File Grant Rules

File grants are parent-issued, not addon-created.

- Scope is currently `single-file`.
- Default TTL is 1 hour.
- Grants are tied to path, app id, user, and mode.
- `readwrite` satisfies read and write; `read` does not satisfy write.
- `expiresOnWindowClose` is true in File Station handoffs.
- Missing, expired, app-mismatched, user-mismatched, mode-denied, or
  path-mismatched grants must be shown as user-visible errors.

Sandbox addons cannot create arbitrary new host files by path. Create new files
through File Station templates or another trusted core flow, then open the file
with a `readwrite` grant.

## Parent Approval Overlays

The parent frame may ask the user to allow sensitive SDK calls:

```text
window.open
app.data.write
host.file.read
host.file.write
system.info
```

`Always Allow` is in-memory for the current iframe/window permission. It is not
a persistent permission setting and does not replace backend approval for file
overwrite or package lifecycle operations.

Common parent/SDK errors:

| Code | Meaning |
| --- | --- |
| `APP_PERMISSION_DENIED` | Permission missing from manifest or denied before bridge call |
| `SANDBOX_APPROVAL_DENIED` | User denied parent permission approval |
| `SANDBOX_APPROVAL_BUSY` | Another parent approval is already open |
| `WEBOS_SDK_REQUEST_TIMEOUT` | Parent did not answer an SDK request in time |
| `SANDBOX_BRIDGE_READY_TIMEOUT` | Addon did not complete SDK ready handshake |

## Host Write Approval Flow

Addon code calls only:

```js
await window.WebOS.files.write({
  path: file.path,
  grantId: permission.grantId,
  content: nextContent,
  overwrite: true
});
```

If overwrite approval is required, the parent frame:

1. receives the backend preflight from the failed write,
2. opens the trusted Web OS approval UI outside the iframe,
3. collects user-entered typed confirmation,
4. calls the approve route,
5. retries the write with `{ operationId, nonce, targetHash }`.

Addon code must not call `approveWrite()`, `write/approve`, or send
`{ approved: true }`.

## When Core Work Is Required

Stop ordinary addon work and create a core task when you need:

- a new SDK method,
- a new manifest extension point,
- File Station to pass a new launch/grant shape,
- cloud-file grants for sandbox apps,
- persistent permission settings,
- background execution,
- package lifecycle behavior that is not already exposed through Package Center.
