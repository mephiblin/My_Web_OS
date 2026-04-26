# SDK API Reference

Status: `[ACTIVE]`

This file documents the current sandbox SDK exposed at:

```text
/api/sandbox/sdk.js
```

The SDK is available as:

```js
window.WebOS
```

## Lifecycle

### `WebOS.ready(timeoutMs?)`

Waits for the parent frame to send sandbox context.

```js
const context = await window.WebOS.ready();
```

Default timeout is 7000 ms. Required before context-sensitive APIs.

Errors:

- `WEBOS_SDK_READY_TIMEOUT`

### `WebOS.getContext()`

Returns the current app context after `ready()`.

```js
const context = window.WebOS.getContext();
```

Useful fields:

```js
context.app.id;
context.app.title;
context.app.permissions;
context.app.runtime;
context.app.sdkUrl;
context.app.launchData;
context.capabilities;
context.apiPolicy;
```

Important: launch data is `context.app.launchData`, not
`context.launchData`.

### Relaunch Data

When a singleton window receives new launch data, the parent sends a message:

```js
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const payload = event.data || {};
  if (payload.type === 'webos:launch-data') {
    loadFromLaunchData(payload.launchData || {});
  }
});
```

See `CORE_INTEGRATION_MAP.md` for exact File Station launch shapes.

### `WebOS.getApiPolicy()`

Returns platform API policy information when available.

```js
const policy = window.WebOS.getApiPolicy();
```

### `WebOS.getCapabilities()`

Returns the current capability catalog copy.

```js
const capabilities = window.WebOS.getCapabilities();
```

## Generic Error Shape

SDK bridge errors are thrown as `Error` objects with a `code` field:

```js
try {
  await window.WebOS.system.info();
} catch (err) {
  console.error(err.code, err.message);
}
```

Parent responses use:

```js
{
  code: 'ERROR_CODE',
  message: 'Human readable message'
}
```

Backend route errors may also include `details`, but the current SDK bridge
only preserves `code` and `message` on the thrown error.

Common SDK/parent errors:

| Code | Meaning |
| --- | --- |
| `APP_PERMISSION_DENIED` | Manifest does not declare the required permission |
| `SANDBOX_APPROVAL_DENIED` | User denied parent approval |
| `SANDBOX_APPROVAL_BUSY` | Another parent approval is already pending |
| `WEBOS_SDK_REQUEST_TIMEOUT` | Parent did not answer within 12000 ms |
| `WEBOS_APPROVAL_PARENT_ONLY` | Addon called rejected self-approval API |

## Notifications

Permission:

```text
ui.notification
```

Request:

```js
await window.WebOS.ui.notification({
  title: 'Addon',
  message: 'Done',
  type: 'success'
});
```

Response:

```js
{ delivered: true }
```

`type` is usually one of:

```text
info | success | warning | error
```

## Window

Permission:

```text
window.open
```

Request:

```js
await window.WebOS.window.open('package-center', {
  source: 'my-addon'
});
```

Response:

```js
{ opened: true, appId: 'package-center' }
```

Opens another registered Web OS app. The parent approval overlay may appear.

## System

Permission:

```text
system.info
```

Request:

```js
const overview = await window.WebOS.system.info();
```

Response:

The response is the `/api/system/overview` payload. Treat it as read-only
system overview data. Do not use system APIs for host mutation from ordinary
addons.

## App Data

Permissions:

```text
app.data.list
app.data.read
app.data.write
```

List:

```js
const entries = await window.WebOS.app.data.list({ path: '' });
```

Response:

```js
[
  { name: 'settings.json', type: 'file' },
  { name: 'cache', type: 'directory' }
]
```

Read:

```js
const result = await window.WebOS.app.data.read({
  path: 'settings.json'
});
```

Response:

```js
{
  path: 'settings.json',
  content: '{"enabled":true}'
}
```

Write:

```js
const result = await window.WebOS.app.data.write({
  path: 'settings.json',
  content: JSON.stringify({ enabled: true }, null, 2)
});
```

Response:

```js
{ path: 'settings.json' }
```

Notes:

- App data is scoped to the addon.
- App data is not host filesystem access.
- Content is stored as UTF-8 text.
- Do not store host secrets unless a future explicit secret store exists.

Alias:

```js
window.WebOS.appData
```

## Host File Read

Permission:

```text
host.file.read
```

Request:

```js
const result = await window.WebOS.files.read({
  path: file.path,
  grantId: permission.grantId
});
```

Response:

```js
{
  path: '/absolute/host/path/file.txt',
  content: 'file text'
}
```

Requirements:

- File Station or another trusted Web OS surface must provide a grant.
- Grant must match path, user, app, and mode.
- Current read API returns UTF-8 text content.
- Missing grant must be shown as a user-visible addon error.

Common errors:

- `FS_FILE_GRANT_REQUIRED`
- `FS_FILE_GRANT_INVALID`
- `FS_FILE_GRANT_SCOPE_MISMATCH`
- `FS_FILE_GRANT_MODE_DENIED`
- `FS_FILE_GRANT_APP_MISMATCH`
- `FS_FILE_GRANT_USER_MISMATCH`
- `APP_PERMISSION_DENIED`

## Raw Tickets

Permission:

```text
host.file.read
```

Issue ticket:

```js
const ticket = await window.WebOS.files.rawTicket({
  path: file.path,
  grantId: permission.grantId,
  profile: 'preview'
});
```

Response:

```js
{
  url: '/api/fs/raw?ticket=wos_tkt_...',
  scope: 'fs.raw',
  profile: 'preview',
  path: '/absolute/host/path/file.png',
  appId: 'my-addon',
  expiresAt: '2026-04-26T00:00:00.000Z',
  ttlMs: 300000
}
```

Media profile responses also include:

```js
{
  idleTimeoutMs,
  absoluteExpiresAt,
  lastAccess,
  size,
  mtime
}
```

Build URL:

```js
const url = window.WebOS.files.rawUrl(ticket);
```

Profiles:

```text
preview
media
```

Rules:

- `preview` defaults to 5 minutes and is capped at 10 minutes.
- `media` is capped at 8 hours absolute and 45 minutes idle.
- Media tickets are invalidated if target file size or mtime changes.
- Use raw tickets for iframe/img/video/model preview URLs.
- Do not put `grantId` into a raw URL.
- Do not call `rawUrl({ path, grantId })`.

## Host File Write

Permission:

```text
host.file.write
```

Request:

```js
const result = await window.WebOS.files.write({
  path: file.path,
  grantId: permission.grantId,
  content: nextContent,
  overwrite: true
});
```

Response:

```js
{ path: '/absolute/host/path/file.txt' }
```

Rules:

- A valid `readwrite` grant is required.
- Sandbox addons cannot create arbitrary new host files by path.
- Existing file writes require `overwrite: true`.
- If overwrite approval is required, parent Web OS UI collects typed
  confirmation and retries with scoped approval evidence.
- Addon code must not mint approval nonces.
- Content is written as UTF-8 text.

Common errors:

- `SANDBOX_FILE_WRITE_APPROVAL_REQUIRED`
- `FS_WRITE_OVERWRITE_APPROVAL_REQUIRED`
- `FS_FILE_GRANT_REQUIRED`
- `FS_FILE_GRANT_MODE_DENIED`
- `OPERATION_APPROVAL_TARGET_CHANGED`
- `OPERATION_APPROVAL_EXPIRED`
- `SANDBOX_APPROVAL_DENIED`

## Write Preflight Compatibility

Request:

```js
await window.WebOS.files.writePreflight({
  path,
  grantId
});
```

This may be used only for display or compatibility. The parent strips
nonce-issuing approval details from this response. It must not be used to issue
approval from addon code.

## Deprecated / Rejected API

```js
await window.WebOS.files.approveWrite();
```

This rejects with:

```text
WEBOS_APPROVAL_PARENT_ONLY
```

New addons must not call it.

## Generic Request

The SDK has an internal request bridge. Prefer named APIs above instead of
using generic request calls directly. Generic requests are harder to review and
should not be used for new addon examples unless a platform API is missing.
