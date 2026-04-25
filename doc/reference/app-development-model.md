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
- launch target is resolved from registry metadata (`component` vs `sandbox`) through the desktop launch registry flow
- metadata is listed through the server app registry
- backend behavior is provided through shared routes/services

This is practical for core workstation apps and early-stage tools.
For ordinary addons, treat this as a development convenience rather than the final ownership model.
The runtime target is package lifecycle ownership once install/update/remove/backup behavior matters.

Built-in registry contract (`server/storage/inventory/system/apps.json`):

- `id`: unique app id
- `title`: display title
- `appModel`: ownership model (`system | standard | package`, where built-in entries are currently `system` or `standard`)
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

## Addon Packageization Direction

Current addon source locations such as `client/src/apps/addons/model-viewer`, `client/src/apps/addons/document-viewer`, and `client/src/apps/addons/code-editor` are valid places to develop and test features quickly.

They should not become the only distribution shape for user-installed addons.
Package Center should be able to install equivalent addon packages from:

- Git registry entries (`webos-store.json` + `zipUrl`)
- direct ZIP import

For packageized addons:

- manifest owns id/title/version/runtime/permissions/file associations
- Package Center owns install/update/remove/backup/rollback visibility
- app-owned data stays under inventory data boundaries
- host file access is mediated by File Station/file grants or explicit Web OS APIs
- core desktop files stay launcher/orchestration-only

Primary addon source layout status (2026-04-25):

- `client/src/apps/addons/code-editor/`
- `client/src/apps/addons/document-viewer/`
- `client/src/apps/addons/model-viewer/`

Each of these addon folders now uses a package-first source layout:

- root `*.svelte` file: compatibility wrapper for the current built-in component launcher
- `components/`: actual Svelte UI implementation
- `services/`: API/helper/runtime logic owned by the addon
- `package/manifest.json`: package contract for future ZIP/registry distribution
- `package/index.html`: placeholder package runtime entry while sandbox migration is pending

This is not yet a full runtime isolation claim.
The current launcher path remains `standard` + `component` for compatibility, while the folder/package contract is ready for addon-by-addon sandbox migration.

## Native File Opening Contract

Installable apps become visible to File Station through `fileAssociations`.
They can also add native-feeling file context menu entries through `contributes.fileContextMenu`.
The same `contributes` block is the extension surface for native-feeling creation,
preview, thumbnail, settings, and background-service declarations.

When a package manifest declares:

```json
{
  "id": "better-image-viewer",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": ["host.file.read"],
  "fileAssociations": [
    {
      "extensions": ["png", "jpg", "webp"],
      "actions": ["open", "preview"],
      "defaultAction": "open"
    }
  ],
  "contributes": {
    "fileContextMenu": [
      {
        "label": "Open in Better Image Viewer",
        "action": "open",
        "extensions": ["png", "jpg", "webp"]
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
      { "label": "Image Preview", "extensions": ["png", "jpg", "webp"] }
    ],
    "thumbnailProviders": [
      { "label": "Image Thumbnail", "extensions": ["png", "jpg", "webp"] }
    ],
    "settingsPanels": [
      { "label": "Image Viewer Settings", "entry": "settings.html" }
    ],
    "backgroundServices": [
      { "id": "image-indexer", "label": "Image Indexer", "entry": "service.js", "autoStart": false }
    ]
  }
}
```

File Station should treat that app as a valid opener for matching files.
The expected user-facing behavior is:

- double-click uses the user default app when configured
- otherwise it uses the best matching association
- right-click exposes `Open With`
- right-click exposes app-declared context menu entries without core hardcoding
- right-click in a folder can expose app-declared `New <template>` entries
- right-click can set `Always Open .<ext> With <app>`
- uninstalling a package removes stale user-default file association entries for that package

This is the Web OS equivalent of an installed desktop app registering file types with the OS.
Core owns the resolver and permission/grant bridge; each app owns only its manifest declaration and package entry implementation.

Extension point status:

- `fileContextMenu`: active in File Station right-click file menus
- `fileCreateTemplates`: active in File Station empty-space right-click menus
- `previewProviders`: active in File Station preview panel through sandbox preview handoff and file grants. File Station shows a provider prompt first; it creates a temporary read grant only after the user clicks the preview action, and revokes that grant when the preview is closed or replaced.
- `thumbnailProviders`: active as File Station provider discovery. Matching files show a provider badge and can hand off to the sandbox preview panel after the user clicks the action; no automatic host-file grant is issued during listing.
- `settingsPanels`: validated and visible as package metadata; Package Center settings launch is a later UI step
- `backgroundServices`: validated and visible as package metadata; `autoStart` is recorded only as a request and normalized to non-executing metadata until a lifecycle/approval policy exists

The rule remains: adding an app-specific feature should start in that app's package folder and manifest.
Core files should only be touched when adding a new generic extension point that all apps can use.

Permission rules:

- apps with `contributes.previewProviders[]` or `contributes.thumbnailProviders[]` must declare `host.file.read`
- apps that open created host files for editing should declare `host.file.read` and `host.file.write`
- `openAfterCreate` must be a boolean when provided

## Primary Addon Sandbox Runtime Status

As of 2026-04-25, these formerly standard built-in addons have package runtime entries:

- `doc-viewer`
- `model-viewer`
- `editor`

Runtime behavior:

- Runtime copies live under `server/storage/inventory/apps/<appId>/`.
- Source package templates live under `client/src/apps/addons/<addon>/package/`.
- The registry merge allows an inventory package to replace a `standard` built-in addon with the same id.
- Replacement does not apply to `system` apps.

Capabilities:

- `doc-viewer`:
  - opens PDF/image files by grant-bound raw URL
  - reads/searches text-like files by SDK file read
- `editor`:
  - reads text files by SDK file read
  - writes text files by SDK file write with explicit overwrite approval payload
- `model-viewer`:
  - launches as a sandbox package
  - receives file grant and raw URL
  - renders GLTF/GLB/FBX/OBJ through package-local Three.js vendor files
  - supports OrbitControls, wireframe, axes toggle, fit, screenshot, and basic inspection metrics

The current runtime split is therefore real for launch/ownership/lifecycle.
Feature parity is complete for document/text viewing, text editing basics, and core 3D model preview.

## System Apps: File Station, Terminal, Settings

File Station, Terminal, Settings, Control Panel, Package Center, Resource Monitor, Log Viewer, and Docker Manager are different from simple apps such as Notepad or Calculator.

They are user-facing apps, but they wrap Host or system-level capabilities. Treat them as **system apps**:

- They should still be modular apps under `client/src/apps/system/<app-name>/` (while ordinary built-in addons live under `client/src/apps/addons/<app-name>/`).
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
- SDK ready handshake is retry-tolerant; host frame timeout should report an explicit bridge error rather than silent infinite loading.
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

Launch/runtime interpretation:

- `launch.mode: component` -> trusted in-process component launch (current built-in `system` and `standard` baseline)
- `launch.mode: sandbox` -> isolated sandbox/package launch (`package` model, plus any migrated built-in addon)
- ownership contract remains `appModel: system | standard | package`; launch mode determines rendering path, appModel determines trust/lifecycle boundary expectations
- desktop rendering should resolve from registry `launch` metadata first, and keep legacy fallback only for compatibility during migration

## Standard Addon Hardening Transition (Phased)

Current reality: most built-in `standard` addons still launch as trusted components.

Transition plan:

1. Phase 1 (now): keep `standard` addons in `component` mode with explicit permissions, audit coverage, and clear host-API boundaries.
2. Phase 2 (targeted migration): move selected `standard` addons with higher isolation need to sandbox-backed packaging (`launch.mode: sandbox`, manifest-owned permissions/data).
3. Phase 3 (default direction): treat new non-core addons as sandbox/package-first unless a documented exception requires temporary component mode.

Guardrail: no silent privilege carryover during migration; every moved addon must declare manifest/runtime/permission boundaries before cutover.

## Station Classification Decision (2026-04-25)

Decision: Station apps (Photo/Music/Video/Document Station family) remain `system`-classified in current inventory for now.

Reason: they are currently operated as core workstation surface with tight host integration and shared operational expectations.

Future reclassification to addon/package should require all of the following:

- manifest-complete permission model with least-privilege boundaries
- sandbox/package runtime readiness (launch, health, logs, backup/rollback, data isolation)
- approval/audit/recovery parity with current system-level behavior
- no regression in core desktop UX and operator workflows after migration

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
