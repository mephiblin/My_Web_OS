# AGENTS.md

This is the repository-level operating guide for coding agents working on My Web OS.
It should be enough to start safely, choose the next useful task, and preserve the project direction without rereading every historical document.

## Operating Contract

Default behavior:

1. Classify the request into one or more layers: `Host`, `Web Desktop`, `App Install / File Workflow`, `Sandbox / Package`, `Agent / Automation`.
2. Inspect the relevant current code before inventing structure. Reuse existing routes, services, stores, components, API helpers, and inventory utilities.
3. Work in this order: `contract/API -> service/helper/store -> minimal UI -> verification -> docs update`.
4. Handle boundaries, explicit errors, approvals, backup/rollback, audit, and recoverability before UI polish.
5. Do not move feature logic into `Desktop.svelte` or `Window.svelte`.
6. Run the smallest useful verification for the touched area, or state clearly why it was not run.
7. Never revert unrelated dirty work.

Default development priority:

```text
registry/file-workflow reliability
-> File Station Open With and file grants
-> Package Center installed operations
-> local workstation core
-> app/package addon parity
-> UI customization
-> Agent/LLM approval workflows
-> media/home lab expansion
-> Docker portability
```

## Product Identity

My Web OS is not a kernel-level operating system replacement.
It is a personal Web OS layer around an existing local PC.

The product should feel like an installable app environment for local work:

- Users manage apps through Web OS.
- Apps open, preview, edit, import, and export real local files through File Station and Web OS APIs.
- File access is explicit, permissioned, recoverable, and visible.
- Package Center is a workshop and maintenance console, not only a store.
- System apps remain privileged; ordinary apps and package addons must not silently bypass Web OS boundaries.

The guiding model:

```text
File Station owns local file selection and path intent.
Apps own focused workflows.
Web OS owns permissions, approval, audit, lifecycle, and recovery.
Package Center owns install/update/remove/runtime health.
```

## Source Documents

Source of truth:

- `doc/planning/project-identity-boundaries.md`: identity, Host/Sandbox boundaries, operational reliability
- `doc/planning/feature-scope-priorities.md`: feature scope, priorities, Package Center, local workstation direction
- `doc/planning/ui-ux-customization-agent.md`: UI/UX, customization, Start Menu, Taskbar, Window, Agent/CLI direction
- `doc/planning/app-install-file-workflow-direction.md`: installable app model, File Station Open With, file grants, app file associations

Reference documents:

- `doc/reference/app-development-model.md`: system apps, trusted built-in addons, sandbox/package app model
- `doc/reference/core-addon-separation-remediation.md`: historical core/addon remediation plan; do not treat its completed state as architectural completion
- `doc/reference/app-ownership-matrix.md`: current system/standard/package ownership model
- `doc/reference/architecture-api-reference.md`: compact architecture/API map
- `doc/reference/package-ecosystem-guide.md`: package authoring and sandbox SDK guide
- `doc/operations/completed-backlog-log.md`: historical completed/worked backlog log
- `doc/operations/local-run-guide.md`: local run and process checks
- `doc/operations/package-troubleshooting.md`: package recovery and troubleshooting
- `doc/policies/file-station-places-policy.md`: File Station Places policy
- `doc/migrations/media-library-path-migration.md`: media/wallpaper migration reference
- `README.md`: user-facing overview and run guide
- `만들것들.md`: future package/widget/app ideas

Conflict resolution:

- Planning documents beat historical reference documents.
- Current code must be inspected before applying a document literally.
- If docs claim an item is complete but code does not satisfy the documented DoD, treat it as incomplete and correct the docs as part of the task.
- Update docs only when behavior, scope, priority, workflow, or operating guidance materially changes.

## Architecture Layers

### Host Layer

Touches the real local machine.

- File system: `server/routes/fs.js`, `client/src/apps/system/file-explorer/`
- Terminal: `server/services/terminal.js`, `client/src/apps/system/terminal/`
- System status: `server/routes/system.js`, `client/src/apps/system/resource-monitor/`
- Docker: `server/routes/docker.js`, `server/services/dockerService.js`, `client/src/apps/system/docker-manager/`
- Server settings: `server/config/*`, `server/routes/settings.js`, `client/src/apps/system/settings/`
- Logs/audit: `server/services/auditService.js`, `server/routes/logs.js`, `client/src/apps/system/log-viewer/`

Rules:

- Return explicit `code` and `message` for recoverable failures.
- Keep filesystem and path policy in backend guards/services.
- Risky Host actions need approval, audit, and recovery paths.
- Do not give sandbox/package addons broad Host file access by default.

### Web Desktop Layer

The user-facing operating surface.

- Entry/auth: `client/src/App.svelte`
- Desktop shell: `client/src/core/Desktop.svelte`
- Window shell: `client/src/core/Window.svelte`
- Launch registry: `client/src/core/appLaunchRegistry.js`
- Ownership/launch helpers: `client/src/core/appOwnershipContract.js`, `client/src/core/shortcutLaunch.js`
- Taskbar/overlays: `client/src/core/components/*`
- State stores: `client/src/core/stores/*`
- Shared API: `client/src/utils/api.js`
- WebOS bridge: `client/src/utils/webosBridge.js`

Rules:

- `Desktop.svelte` orchestrates layers and window hosting only.
- `Window.svelte` owns move, resize, focus, maximize, minimize, and snap behavior.
- App launch should be registry/contract driven.
- Feature logic belongs in app modules, stores, services, or API helpers.

### App Install / File Workflow Layer

Connects local files to apps without weakening Host boundaries.

- File Station UI/API: `client/src/apps/system/file-explorer/`, `server/routes/fs.js`
- Addon apps: `client/src/apps/addons/*`
- Built-in app registry: `server/storage/inventory/system/apps.json`
- Package manifests: `server/storage/inventory/apps/<appId>/manifest.json`
- App registry service: `server/services/packageRegistryService.js`
- Package Center installed app UI: `client/src/apps/system/package-center/PackageCenter.svelte`

Rules:

- File Station creates file intent; apps receive narrow launch context.
- Apps should declare file associations.
- Apps should receive file context/grants, not broad Host authority.
- Read access and write access are separate.
- Overwrite, delete, batch writes, protected paths, and command execution need approval/audit/recovery.
- Trusted built-in addons may open local files, but should move toward Web OS APIs instead of ad hoc Host access.

### Sandbox / Package Layer

Owns installed package assets, app-owned data, runtime state, and lifecycle operations.

- Inventory root: `server/storage/inventory/`
- Package APIs: `server/routes/packages.js`
- Runtime APIs: `server/routes/runtime.js`
- Sandbox APIs: `server/routes/sandbox.js`
- Package services: `server/services/packageRegistryService.js`, `server/services/packageLifecycleService.js`, `server/services/channelUpdatePolicyService.js`
- Runtime services: `server/services/runtimeManager.js`, `server/services/runtimeProfiles.js`, `server/services/processSupervisor.js`, `server/services/runtimeStateStore.js`
- Quality gate: `server/services/templateQualityGate.js`
- Sandbox frame: `client/src/core/components/SandboxAppFrame.svelte`
- SDK: `server/static/webos-sandbox-sdk.js`

Rules:

- Serve package assets only through sandbox routes.
- Keep app-owned data scoped to `server/storage/inventory/data/{appId}`.
- Manifest permissions and runtime profiles must be validated on the backend.
- Package work must consider permissions, dependencies, compatibility, quality gate, channel policy, backup, rollback, health, logs, and events.

### Agent / Automation Layer

Agent features explain, summarize, request approval, execute, and report results.

- Agent UI: `client/src/core/components/Agent.svelte`, `client/src/core/components/AgentChatPanel.svelte`
- Agent store: `client/src/core/stores/agentStore.js`
- Terminal: `client/src/apps/system/terminal/Terminal.svelte`, `server/services/terminal.js`
- Action sources: `server/routes/logs.js`, `server/routes/docker.js`, `server/routes/packages.js`, `server/routes/runtime.js`

Rules:

- Risky actions must produce approval cards before execution.
- Preserve raw terminal output separately from summaries.
- Agent logic belongs in stores/services/routes, not `Desktop.svelte`.

## App Classes

### System Apps

System apps wrap Host or operating capabilities.

Examples: File Station, Terminal, Settings, Control Panel, Package Center, Resource Monitor, Log Viewer, Docker Manager, Transfer Manager.

Rules:

- Live under `client/src/apps/system/*`.
- May call privileged backend routes.
- Must surface explicit errors, approvals, audit, and recovery where needed.
- Should not be converted into untrusted sandbox apps until a stronger permission model exists.

### Trusted Built-in Addons

Bundled apps that provide user workflows but are not core Host operators.

Examples: Model Viewer, Document Viewer/Editor, Media Player, Code Editor, Widget Store.

Rules:

- Live under `client/src/apps/addons/*`.
- Register as `appModel: "standard"`.
- May open local files when File Station, Spotlight, or explicit open-file flows provide context.
- Should use Web OS file APIs where practical.
- Save/overwrite flows should move toward approval, audit, and recoverability.
- Should be designed so they can later become package addons.

### Package Addons

Installed apps discovered from package manifests.

Rules:

- Live under `server/storage/inventory/apps/<appId>/`.
- Register as `appModel: "package"`.
- Declare permissions, runtime, entry, type, metadata, and eventually file associations.
- Use sandbox/package APIs for app-owned data and local file operations.
- Surface lifecycle, health, logs, backup, rollback, and runtime state in Package Center.

## Work Area Map

Read the relevant files before editing.

### Registry, App Model, Launch

Use for app lists, app model metadata, ownership, launch mode, built-in registry, and package discovery.

Read first:

- `server/services/packageRegistryService.js`
- `server/utils/inventoryPaths.js`
- `server/utils/appPaths.js`
- `server/storage/inventory/system/apps.json`
- `client/src/core/appLaunchRegistry.js`
- `client/src/core/appOwnershipContract.js`
- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
- `doc/reference/app-ownership-matrix.md`
- `doc/reference/core-addon-separation-remediation.md`

Keep launch contract explicit: `component` for built-in apps, `sandbox` for package apps.

### File Station And Open With

Use for local file browsing, allowed roots, file associations, app opening, file grants, trash, upload/download, share links, and cloud boundaries.

Read first:

- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `client/src/apps/system/file-explorer/api.js`
- `client/src/apps/system/transfer/TransferUI.svelte`
- `server/routes/fs.js`
- `server/routes/share.js`
- `server/routes/cloud.js`
- `server/services/trashService.js`
- `server/services/shareService.js`
- `server/services/cloudService.js`
- `server/services/indexService.js`
- `server/middleware/pathGuard.js`
- `server/utils/pathPolicy.js`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/policies/file-station-places-policy.md`

File Station should resolve file type, available apps, requested mode, and user intent. It should not accumulate model-viewer/editor/media-player feature logic.

### Addon Apps: Media, Document, Model, Code

Use for trusted built-in addons and their local file workflows.

Read first:

- `client/src/apps/addons/media-player/MediaPlayer.svelte`
- `client/src/apps/addons/media-player/api.js`
- `server/routes/media.js`
- `server/services/mediaService.js`
- `client/src/apps/addons/document-viewer/DocumentViewer.svelte`
- `client/src/apps/addons/model-viewer/ModelViewer.svelte`
- `client/src/apps/addons/code-editor/CodeEditor.svelte`
- `client/src/apps/addons/code-editor/api.js`
- `server/routes/fs.js`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/reference/app-development-model.md`

These apps may work with local files, but file context should come from File Station, Spotlight, shortcuts, or an explicit open-file flow.

### Package Center Operations

Use for registry, install/update, installed package console, lifecycle, runtime, health, logs, events, backup, rollback, manifest editing, template scaffold, dependency, channel policy, file associations, permissions, and app data visibility.

Read first:

- `client/src/apps/system/package-center/PackageCenter.svelte`
- `client/src/apps/system/package-center/api.js`
- `server/routes/packages.js`
- `server/services/packageRegistryService.js`
- `server/services/packageLifecycleService.js`
- `server/services/channelUpdatePolicyService.js`
- `server/services/templateQualityGate.js`
- `server/services/runtimeProfiles.js`
- `server/utils/appPaths.js`
- `server/utils/inventoryPaths.js`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/reference/package-ecosystem-guide.md`

Keep registry, installed operations, runtime controls, template/scaffold, permissions, and file association concerns visually separated.

### Sandbox Apps And App Data

Read first:

- `server/routes/sandbox.js`
- `server/services/packageRegistryService.js`
- `server/services/appApiPolicy.js`
- `server/services/capabilityCatalog.js`
- `server/utils/appPaths.js`
- `server/utils/inventoryPaths.js`
- `client/src/core/components/SandboxAppFrame.svelte`
- `server/static/webos-sandbox-sdk.js`
- `server/storage/inventory/apps/`
- `server/storage/inventory/data/`

Package addons should use manifest permissions and WebOS APIs. Do not broaden Host access without explicit permission design.

### Runtime And Process Management

Read first:

- `server/routes/runtime.js`
- `server/services/runtimeManager.js`
- `server/services/processSupervisor.js`
- `server/services/runtimeStateStore.js`
- `server/services/runtimeProfiles.js`
- `server/storage/inventory/system/runtime-instances.json`
- `client/src/apps/system/package-center/PackageCenter.svelte`

Route handlers should call `runtimeManager`. Process execution belongs in `processSupervisor`. Persisted runtime state belongs in `runtimeStateStore`.

### Desktop Shell, Windows, Taskbar, Spotlight

Read first:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
- `client/src/core/Spotlight.svelte`
- `client/src/core/components/Taskbar.svelte`
- `client/src/core/components/StartMenu.svelte`
- `client/src/core/components/ContextMenu.svelte`
- `client/src/core/components/NotificationCenter.svelte`
- `client/src/core/stores/windowStore.js`
- `client/src/core/stores/desktopStore.js`
- `client/src/core/stores/contextMenuStore.js`
- `client/src/core/stores/spotlightStore.js`
- `client/src/core/stores/notificationStore.js`

Taskbar, Start Menu, Spotlight, and context menu logic should live in their own components/stores/helpers.

### UI Customization And Control Panel

Read first:

- `client/src/apps/system/control-panel/ControlPanel.svelte`
- `client/src/core/stores/systemStore.js`
- `client/src/core/stores/desktopStore.js`
- `client/src/core/stores/windowStore.js`
- `client/src/core/stores/widgetStore.js`
- `client/src/core/stores/shortcutStore.js`
- `server/routes/system.js`
- `server/services/stateStore.js`
- `doc/planning/ui-ux-customization-agent.md`

Control Panel is for user-facing customization. Settings is for server/runtime configuration.

### Agent, LLM, Wrapped CLI

Read first:

- `client/src/core/components/Agent.svelte`
- `client/src/core/components/AgentChatPanel.svelte`
- `client/src/core/stores/agentStore.js`
- `client/src/apps/system/terminal/Terminal.svelte`
- `server/services/terminal.js`
- `server/routes/logs.js`
- `server/routes/docker.js`
- `server/routes/packages.js`
- `server/routes/runtime.js`

Likely future files:

- `server/routes/ai.js`
- `server/services/aiActionService.js`
- `client/src/core/stores/agentActionStore.js`

### System, Services, Logs, Resource Monitor

Read first:

- `client/src/apps/system/resource-monitor/ResourceMonitor.svelte`
- `client/src/apps/system/resource-monitor/api.js`
- `client/src/apps/system/log-viewer/LogViewer.svelte`
- `client/src/apps/system/log-viewer/api.js`
- `server/routes/system.js`
- `server/routes/services.js`
- `server/routes/logs.js`
- `server/services/serviceManager.js`
- `server/services/auditService.js`
- `server/services/storageService.js`

Operational dashboards should compose existing APIs rather than duplicating service logic.

### Docker Manager

Read first:

- `client/src/apps/system/docker-manager/DockerManager.svelte`
- `client/src/apps/system/docker-manager/api.js`
- `server/routes/docker.js`
- `server/services/dockerService.js`

Use explicit errors for Docker not installed, daemon unavailable, and permission denied.

### Settings, Config, Storage, Inventory

Read first:

- `client/src/apps/system/settings/Settings.svelte`
- `client/src/apps/system/settings/api.js`
- `server/routes/settings.js`
- `server/config/serverConfig.js`
- `server/config/defaults.json`
- `server/services/stateStore.js`
- `server/utils/inventoryPaths.js`
- `server/utils/appPaths.js`
- `server/storage/inventory/system/`

Inventory paths should go through utility helpers. Sensitive values must be masked or skipped.

### Tests And Documentation

Read first:

- `server/tests/`
- `package.json`
- `client/package.json`
- `README.md`
- `doc/README.md`
- `doc/planning/project-identity-boundaries.md`
- `doc/planning/feature-scope-priorities.md`
- `doc/planning/ui-ux-customization-agent.md`
- `doc/planning/app-install-file-workflow-direction.md`

Add focused tests near changed behavior. If adding server tests, wire or update the official test command.

## Current Autonomous Backlog

When the user asks to proceed from `AGENTS.md` without naming a specific task, select the first unfinished item from this backlog. Work on one bounded item only.

### P0: Registry And File Workflow Reliability

- `P0-1` Built-in registry durability: make `server/storage/inventory/system/apps.json` available in fresh checkouts or generated by a reliable bootstrap path; fix ignore/seed behavior and verify `/api/system/apps`.
- `P0-2` P5 status correction: update `AGENTS.md`, `doc/operations/completed-backlog-log.md`, and `doc/reference/core-addon-separation-remediation.md` so folder split, registry cleanup, and true architectural completion are not conflated.
- `P0-3` File association contract: add built-in addon metadata for Model Viewer, Document Viewer, Media Player, Code Editor, and Widget Store.
- `P0-4` File Station Open With foundation: resolve file associations and launch apps with normalized file context.
- `P0-5` File grant model: introduce read/readwrite single-file grant shape for trusted built-in addons, then prepare package addon extension.
- `P0-6` Save/overwrite policy: route addon file writes through backend policy, approval, audit, and recoverable behavior.

### P1: Package Center App Operations

- `P1-1` Installed app visibility: show app model, runtime, owner tier, file associations, permissions, app data boundary, health, logs, lifecycle, backup, and rollback status.
- `P1-2` Package manifest file associations: allow package manifests to declare file associations and validate them in preflight/package doctor.
- `P1-3` Package addon file API parity: allow package addons to request permitted file operations through WebOS APIs and File Station grants.
- `P1-4` Widget Store alignment: align Widget Store with package/widget type, app-owned data, and Package Center lifecycle expectations.

### P2: Local Workstation Core

- `P2-1` File Station reliability: allowed roots, trash, share links, upload/download transfer state, cloud boundaries, large-operation status.
- `P2-2` Terminal reliability: session stability and risky-command approval model.
- `P2-3` Resource Monitor / Log Viewer operations: service-runtime-package status integration.
- `P2-4` Docker Manager operations: logs, ports, volumes, health, then Compose.

### P3: UI Customization And Desktop Workflow

- `P3-1` Start Menu and Taskbar refinement.
- `P3-2` Desktop layout persistence and edit mode.
- `P3-3` Window defaults and app-specific style model.
- `P3-4` Control Panel customization sections.
- `P3-5` Theme preset save/load.
- `P3-6` Context menu customization connected to Open With/file actions.

### P4: Agent And Approval Workflows

- `P4-1` Agent states and result cards.
- `P4-2` Approval cards for file overwrite/delete, rollback, package install overwrite, and terminal command execution.
- `P4-3` Small OS actions: open app, open file path, run package health check, inspect Docker status, summarize recent error logs.
- `P4-4` LLM proxy API and raw terminal output preservation.
- `P4-5` Wrapped Assistant Mode hardening.

### P5: Expansion And Portability

- `P5-1` Media playlist/repeat/shuffle/background audio.
- `P5-2` Document Viewer PDF controls/search/metadata.
- `P5-3` Model Viewer wireframe/axes/material info/screenshot.
- `P5-4` WebDAV/cloud write/upload/mount status.
- `P5-5` Backup job manager and richer transfer manager.
- `P5-6` Docker packaging/portability: storage volume strategy, Host path binding, Dockerfile/Compose, container logs.

## Autonomous Roadmap Loop

At the start of an autonomous backlog task:

- State the selected backlog item.
- State the relevant layer(s).
- State the files you will inspect first.
- If the user explicitly requested sub-agents, split only non-overlapping work.

During implementation:

- Keep the change bounded to the selected item.
- Follow `contract/API -> service/helper/store -> minimal UI -> verification -> docs`.
- Do not start the next backlog item unless the user explicitly asked to continue through multiple items.

At the end:

- Summarize what changed.
- Summarize verification or why it was skipped.
- State the next recommended backlog item.
- Ask whether to continue, choose another item, commit, or stop.

## Implementation Rules

- Stabilize backend contracts before frontend UI.
- For persistent UI state, design store state and backend `system/state` schema before adding controls.
- Split responsibilities: route for HTTP contract, service for state/business logic, utility for reusable path/policy helpers, store for frontend state, component for UI.
- Add new abstractions only for real boundaries or repeated call sites.
- Keep Package Center registry, installed operations, lifecycle, runtime, template/scaffold, permission, and file association concerns separated.
- Never make command execution, deletion, rollback, overwrite install, or Host file overwrite silent.
- Avoid committing autogenerated churn. `server/storage/index.json` is usually autogenerated and should usually stay out of commits.

## Frontend Rules

- Preserve dark glassmorphism, translucent surfaces, soft borders, compact density, and blue accent.
- Use `lucide-svelte` icons where possible.
- Keep operational tools dense and readable.
- Do not turn operational tools into landing pages.
- Preserve keyboard/focus visibility and usable hit areas.
- Do not put app-specific logic in `Desktop.svelte` or `Window.svelte`.
- File Station and Package Center should be operational, scannable tools, not marketing surfaces.

## Backend Rules

- `server/index.js`: composition root, route wiring, service bootstrap, shutdown
- `server/routes/*.js`: HTTP contract, auth guard, validation, response mapping
- `server/services/*.js`: business logic and state transitions
- `server/config/*.js`: defaults, env, public settings
- `server/utils/*.js`: path, inventory, policy helpers

Route handlers should stay thin. Validate app id, paths, runtime profile, manifest, package file operations, file association input, and file grant scope on the backend.

## Package And Runtime Conventions

Runtime types:

- `builtin`: trusted built-in component app
- `sandbox-html`: iframe/static UI package
- `process-node`: managed Node.js process
- `process-python`: managed Python process
- `binary`: allowlisted local binary process

App models:

- `system`: privileged system app
- `standard`: trusted built-in addon
- `package`: installed package addon

Package types:

- `app`: windowed UI package
- `widget`: desktop widget package
- `service`: background package
- `hybrid`: UI plus background service
- `developer`: tools for package creation/testing

File association actions:

- `preview`: read-only quick inspection
- `open`: read-only full app view
- `edit`: read/write workflow
- `import`: copy into app-owned data
- `export`: write a new file chosen by user

## Verification

Use the smallest checks that cover the change.

Backend syntax checks:

```bash
node --check server/routes/packages.js
node --check server/routes/runtime.js
node --check server/routes/fs.js
node --check server/services/packageRegistryService.js
node --check server/services/runtimeManager.js
node --check server/services/packageLifecycleService.js
node --check server/services/templateQualityGate.js
node --check tools/package-doctor.js
node --check tools/migrate-apps-registry.js
```

Registry/package checks:

```bash
npm run apps:registry:migrate
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

Frontend build:

```bash
cd client
npm run build
```

Server tests:

```bash
npm test
```

Run locally:

```bash
node server/index.js
```

```bash
cd client
npm run dev
```

## Multi-Agent Orchestration

Use sub-agents only when the user explicitly asks for parallel agents, delegation, orchestration, or multi-agent collaboration.

Rules:

- The main agent owns the plan, critical path, final integration, and final answer.
- Delegate only bounded side tasks that can run in parallel without blocking the next local step.
- Use explorer agents for read-only codebase questions.
- Use worker agents for implementation tasks with explicit file/module ownership.
- Never assign overlapping write areas to multiple workers.
- Tell workers they are not alone in the codebase and must not revert unrelated changes.
- Review returned changes before integrating or reporting completion.

## Git And Workspace Rules

- The worktree may already contain user changes.
- Never revert unrelated changes.
- Do not use destructive git commands unless explicitly requested.
- Do not commit autogenerated index churn unless explicitly requested.
- `server/storage/index.json` is frequently autogenerated and should usually stay out of commits.
- Inventory files are often ignored; if a registry or seed file must be portable, explicitly fix ignore/seed behavior instead of assuming local files will be committed.

## Good Change Definition

A good change:

- moves the project closer to the planning documents
- keeps Host, Desktop, App Install/File Workflow, and Sandbox/Package boundaries clear
- lets useful apps work with local files through explicit Web OS contracts
- improves failure visibility or recoverability
- preserves the current glass desktop language
- avoids unrelated broad refactors
- uses existing stores, services, helpers, and route patterns
- includes validation appropriate to the risk
- updates docs when scope or behavior materially changes

## Canonical Guide

This repository uses `AGENTS.md` as the canonical agent guide.
If another tool needs `CLAUDE.md` or `.github/copilot-instructions.md`, mirror this file rather than maintaining conflicting instructions.
