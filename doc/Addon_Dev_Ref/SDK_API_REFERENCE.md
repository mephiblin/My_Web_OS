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

### `WebOS.ready()`

Waits for the parent frame to send sandbox context.

```js
await window.WebOS.ready();
```

Required in every addon before using context-sensitive APIs.

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
context.launchData;
```

### `WebOS.getApiPolicy()`

Returns platform API policy information when available.

```js
const policy = window.WebOS.getApiPolicy();
```

## Notifications

Permission:

```text
ui.notification
```

API:

```js
await window.WebOS.ui.notification({
  title: 'Addon',
  message: 'Done',
  type: 'success'
});
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

API:

```js
await window.WebOS.window.open('package-center', {
  source: 'my-addon'
});
```

Opens another registered Web OS app.

## System

Permission:

```text
system.info
```

API:

```js
const overview = await window.WebOS.system.info();
```

Use this for read-only system overview. Do not use system APIs for host
mutation from ordinary addons.

## App Data

Permissions:

```text
app.data.read
app.data.write
```

Read:

```js
const result = await window.WebOS.app.data.read({
  path: 'settings.json'
});
```

Write:

```js
await window.WebOS.app.data.write({
  path: 'settings.json',
  content: JSON.stringify({ enabled: true }, null, 2)
});
```

Notes:

- App data is scoped to the addon.
- App data is not host filesystem access.
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

API:

```js
const result = await window.WebOS.files.read({
  path: file.path,
  grantId: grant.grantId
});
```

Requirements:

- File Station or another trusted Web OS surface must provide a grant.
- Grant must match path, user, app, and mode.
- Missing grant must be shown as a user-visible addon error.

Common errors:

- `FS_FILE_GRANT_REQUIRED`
- `FS_FILE_GRANT_INVALID`
- `FS_FILE_GRANT_SCOPE_MISMATCH`
- `FS_FILE_GRANT_MODE_DENIED`
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
  grantId: grant.grantId,
  profile: 'preview'
});
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

- Use raw tickets for iframe/img/video/model preview URLs.
- Do not put `grantId` into a raw URL.
- Do not call `rawUrl({ path, grantId })`.

## Host File Write

Permission:

```text
host.file.write
```

API:

```js
await window.WebOS.files.write({
  path: file.path,
  grantId: grant.grantId,
  content: nextContent,
  overwrite: true
});
```

Rules:

- New file writes require a valid write grant.
- Existing file writes require `overwrite: true`.
- If overwrite approval is required, parent Web OS UI collects typed
  confirmation and retries with scoped approval evidence.
- Addon code must not mint approval nonces.

Common errors:

- `SANDBOX_FILE_WRITE_APPROVAL_REQUIRED`
- `FS_WRITE_OVERWRITE_APPROVAL_REQUIRED`
- `FS_FILE_GRANT_MODE_DENIED`
- `OPERATION_APPROVAL_TARGET_CHANGED`
- `OPERATION_APPROVAL_EXPIRED`

## Write Preflight Compatibility

API:

```js
await window.WebOS.files.writePreflight({
  path,
  grantId
});
```

This may be used only for display or compatibility. It must not be used to
issue approval from addon code.

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

