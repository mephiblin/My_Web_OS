# App Development Model

This document defines how apps should be developed for My Web OS.
It is based on the principle that the Web OS core provides the operating surface, while apps provide focused user-facing workflows.

## Core Principle

Build tools as separate apps, then register and run them inside Web OS.
For the installed-app and local-file workflow direction, see
`doc/planning/app-install-file-workflow-direction.md`.

```text
Develop as an independent app.
Register it in Web OS.
Run it inside a Web OS window.
Use Web OS APIs for files, settings, notifications, permissions, and lifecycle.
```

This applies strongly to tools such as:

- Notepad
- Paint
- Calculator
- Markdown Preview
- JSON Formatter
- Bookmark Manager
- Todo
- Photo/Music/Video/Document Station
- App-specific dashboards and utilities

These apps should not put their feature logic into `Desktop.svelte`, `Window.svelte`, or other shell-level files.

## What The Web OS Core Owns

The Web OS core should provide platform capabilities:

- desktop orchestration
- window management
- taskbar/start menu/launcher
- app registry and launch flow
- common filesystem API
- common settings/state API
- notification system
- permission and approval model
- package/runtime lifecycle
- sandbox bridge / app SDK

The core should make apps possible. It should not contain the app's own editing, drawing, calculation, media-library, or domain workflow logic.

## Built-in Apps vs Package Apps

There are two valid app shapes in the current project.

### Built-in Svelte Apps

Current structure:

- UI lives under `client/src/apps/system/<app-name>/` or `client/src/apps/addons/<app-name>/`
- app is mapped from `client/src/core/Desktop.svelte`
- metadata is listed through the server app registry
- backend behavior is provided through shared routes/services

This is practical for core workstation apps and early-stage built-in tools.

Built-in registry contract (`server/storage/inventory/system/apps.json`):

- `id`: unique app id
- `title`: display title
- `appModel`: `system` or `standard`
- `runtime`: `builtin`
- `version`: semver-like string (required for `standard`)
- `entry`: module key/path-like identifier (required for `standard`)
- `permissions`: explicit capability list (empty array allowed)

### Sandbox / Package Apps

Current structure:

- app lives under `server/storage/inventory/apps/<app-id>/`
- `manifest.json` describes id, title, entry, permissions, runtime, type, and metadata
- static UI runs through `SandboxAppFrame.svelte`
- app-owned data lives under `server/storage/inventory/data/{appId}`
- lifecycle, health, logs, backup, rollback, and runtime state are managed by Package Center/runtime services

This is the long-term model for user-installable, externally developed, or isolated apps.

## Recommended Evolution

Use this progression for new app categories:

1. Built-in component app when the tool is small, trusted, and tightly integrated.
2. Manifest-backed registration when metadata, permissions, or launch behavior need to be explicit.
3. Sandbox iframe runtime when isolation, external installation, or app-owned data matters.
4. Package Center lifecycle when install/update/backup/rollback/health/logs are needed.
5. Web OS app SDK/bridge when sandbox apps need stable APIs such as file dialogs, notifications, window title, and app data.

The long-term target is:

```text
Web OS core + independent apps + manifest registration + permissioned app APIs
```

## System Apps: File Station, Terminal, Settings

File Station, Terminal, Settings, Control Panel, Package Center, Resource Monitor, Log Viewer, and Docker Manager are different from simple apps such as Notepad or Calculator.

They are user-facing apps, but they wrap Host or system-level capabilities. Treat them as **system apps**:

- They should still be modular apps under `client/src/apps/<app-name>/`.
- Their UI should not be embedded directly in `Desktop.svelte` or `Window.svelte`.
- Their backend capabilities should live in routes/services such as `server/routes/fs.js`, `server/services/terminal.js`, `server/routes/settings.js`, and related service modules.
- Their risky actions need explicit errors, approvals, audit/logging, and recoverable behavior.
- They should not be converted into untrusted sandbox apps unless a clear permission and approval model exists.

In short:

```text
File Station / Terminal / Settings are core system apps.
They should be modular, but they are not ordinary third-party apps.
```

## How Much Should System Apps Be Modularized?

Do modularize them internally.

Good structure:

```text
client/src/apps/system/file-explorer/
  FileExplorer.svelte
  api.js
  components/
  stores/

server/routes/fs.js
server/services/trashService.js
server/services/indexService.js
server/middleware/pathGuard.js
server/utils/pathPolicy.js
```

Avoid a single giant component or route file when the feature has independent concerns such as:

- path policy
- upload/transfer jobs
- trash/recovery
- preview/read/write
- share links
- command execution
- terminal sessions
- runtime settings
- audit logs

Do not modularize system apps into fully external packages too early.
Their backend authority touches the real machine, so their boundaries should be stronger than normal apps.

## App API Direction

The Q&A-style `window.WebOS.*` API is a good long-term direction, but the current project primarily uses REST helpers and sandbox routes.

Recommended future bridge shape:

```js
window.WebOS.fs.readFile(path)
window.WebOS.fs.writeFile(path, content)
window.WebOS.window.setTitle('Notepad')
window.WebOS.dialog.openFile()
window.WebOS.dialog.saveFile()
window.WebOS.notification.show('Saved')
window.WebOS.appData.read('notes.json')
window.WebOS.appData.write('notes.json', data)
```

This bridge should wrap existing backend APIs and enforce permissions.
It should not expose raw Host filesystem access to sandbox apps.

Current delivery status:

- Sandbox SDK script: `/api/sandbox/sdk.js`
- SDK context handshake: `webos:ready`, `webos:context`, `webos:response`
- API policy endpoint: `/api/system/app-api-policy`
- Runtime capability catalog: `/api/packages/runtime/capabilities`
- Sandbox capability map: `/api/sandbox/:appId/capabilities`

## Registry-Driven Launch Model

Desktop launch routing should follow app registry metadata instead of ad-hoc per-file branching.

Current launch metadata shape:

```json
{
  "launch": {
    "mode": "component | sandbox",
    "componentId": "files",
    "entryUrl": "/api/sandbox/<appId>/index.html"
  }
}
```

Built-in apps use `mode: component`, sandbox/package apps use `mode: sandbox`.
Desktop window rendering should resolve runtime from `launch` first, then fallback only for legacy compatibility.

## Decision Guide

Use a built-in system app when:

- the feature wraps Host capabilities
- the feature needs privileged backend routes
- the app is part of the Web OS operating surface
- failure/recovery/audit behavior matters

Use a built-in ordinary app when:

- the app is trusted
- fast iteration matters
- it uses common APIs but does not need isolation yet

Use a sandbox/package app when:

- the app should be installable/removable
- the app should have app-owned data
- permissions should be explicit in manifest
- isolation matters
- lifecycle operations are useful

## Rule Of Thumb

Keep the OS core small and authoritative.
Keep system apps modular and privileged.
Keep ordinary tools independent and package-friendly.

```text
Core = platform and boundaries
System apps = privileged modules around Host capabilities
Ordinary apps = independent tools
Package apps = manifest + permissions + lifecycle
```
