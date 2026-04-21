# AGENTS.md

This file is the repository-level operating guide for coding agents.
It must be enough to start work without rereading every planning document, while still pointing to the right source when the task is ambiguous.

## Immediate Work Protocol

An agent should be able to read only this file and start safely.

1. Classify the request into one or more layers: Host Layer, Web Desktop Layer, Sandbox / Package Layer.
2. Inspect the relevant existing files before inventing new structure. Look for current routes, services, stores, components, and API helpers first.
3. If product direction is unclear, read only the relevant source document:
   - Identity, boundaries, operational reliability: `기획서.md`
   - Feature scope, priorities, Package Center, local workstation features: `기획서2.md`
   - UI/UX, customization, Start Menu, Taskbar, Window, Agent/CLI: `기획서3.md`
4. Implement in this order: `API/service contract -> store/helper -> minimal UI -> verification -> docs update`.
5. Before coding UI polish, handle Host/Sandbox boundaries, backup/rollback behavior, explicit error codes, and user approval flows.
6. For Package Center work, prioritize the Installed operations console over Store browsing: lifecycle, runtime, health, logs, events, backup, rollback.
7. For UI work, preserve the current dark glassmorphism desktop language and do not push feature logic into `Desktop.svelte` or `Window.svelte`.
8. After changes, run the smallest useful verification for the touched area, or state clearly why it was not run.

Default development priority:

`reliability/boundary -> Package Center operations -> local workstation core -> UI customization -> Agent/LLM -> media/home lab -> Docker portability`

## Codex Multi-Agent Orchestration

Codex may use sub-agents only when the user explicitly asks for parallel agents, delegation, orchestration, or multi-agent collaboration.
Do not spawn sub-agents just because a task is large or requires investigation.

Use this pattern when multi-agent work is requested:

1. The main agent owns the plan, critical path, final integration, and final answer.
2. Delegate only bounded side tasks that can run in parallel without blocking the main agent's immediate next step.
3. Use explorer agents for read-only codebase questions with specific outputs.
4. Use worker agents for implementation tasks with explicit file/module ownership.
5. Never assign overlapping write areas to multiple workers.
6. Tell workers they are not alone in the codebase and must not revert unrelated changes.
7. Review returned changes before integrating or reporting completion.
8. Close or ignore sub-agents once their result is no longer needed.

Good delegation examples:

- Explorer A checks Package Center UI flow while the main agent inspects backend package routes.
- Explorer B checks runtime manager state transitions while the main agent edits Package Center UI.
- Worker A owns `server/routes/packages.js` and package services while Worker B owns `client/src/apps/package-center/` UI.
- Worker A owns Agent store/backend action mapping while Worker B owns Agent chat panel UI.

Avoid delegation when:

- The next step depends immediately on the delegated answer.
- The task is a small single-file edit.
- The work requires one tightly coupled design decision.
- Multiple agents would touch the same file or same fragile state model.

Suggested orchestration prompt shape:

```text
Use two sub-agents in parallel.
Explorer 1: inspect <area> and report exact files, risks, and recommended changes. Do not edit files.
Worker 1: implement <bounded change> in <explicit files/modules>. Do not touch other areas or revert unrelated changes.
Main agent: keep the critical path locally, review both results, integrate, verify, and summarize.
```

## Project Identity

My Web OS is not a kernel-level replacement for Windows, macOS, or Linux.
It is a personal Web OS layer that wraps an existing local PC with a browser-based work environment for files, terminal access, system status, Docker, packages, runtimes, backup/recovery, and customization.

Core principles:

- Expose local PC capabilities through clear UI/API boundaries instead of hiding them.
- The web desktop is not decoration; it must reduce real local workflow friction.
- Package Center is a workshop and maintenance console, not only an app store.
- Failures, logs, health, backup, rollback, and recovery options must be visible to the user.
- Customization means storing and reshaping workflows, not only changing colors.
- Agent/LLM features should start with explanation, summary, approval, and result reporting before autonomous execution.

## Source Of Truth

The source of truth for product direction is the three planning documents below.

1. `기획서.md`: project identity, Host/Sandbox philosophy, operational reliability rules
2. `기획서2.md`: feature definitions, Package Center direction, local workstation direction, feature priorities
3. `기획서3.md`: UI/UX, customization, Start Menu, Taskbar, Window, Agent/CLI direction

`AGENTS.md` translates those planning documents into execution order and working rules.

## Reference Documents

The documents below are references, not source of truth. Read them only when needed.

- `README.md`: current implemented features, execution guide, user-facing overview
- `next.md`: historical/runtime-layer implementation context for package lifecycle, recovery, rollback, and runtime details
- `doc/계획표8.md`: older roadmap context for the Host/Sandbox dual-layer architecture

Conflict resolution:

- Product direction follows `기획서.md`.
- Feature priority follows the P0/P1/P2/P3 sections in `기획서2.md`.
- UI/customization/Agent direction follows `기획서3.md`.
- If current code conflicts with the planning documents, inspect the code and move it gradually toward the planning direction.
- If `README.md`, `next.md`, or `doc/계획표8.md` conflict with the three planning documents, prefer the planning documents and update references only when needed.

## Architecture Boundaries

The system has three layers. Do not blur these boundaries casually.

### Host Layer

This layer touches the real local machine.

- File system: `server/routes/fs.js`, `client/src/apps/file-explorer/`
- Terminal: `server/services/terminal.js`, `client/src/apps/terminal/`
- System status: `server/routes/system.js`, `client/src/apps/resource-monitor/`
- Docker: `server/routes/docker.js`, `client/src/apps/docker-manager/`
- Server settings: `server/config/*`, `server/routes/settings.js`, `client/src/apps/settings/`
- Logs/audit: `server/services/auditService.js`, `server/routes/logs.js`, `client/src/apps/log-viewer/`

Host features are powerful. Prefer explicit error codes, user-facing explanations, approval flows, and recoverable behavior.

### Web Desktop Layer

This is the user-facing operating surface.

- Entry/auth: `client/src/App.svelte`
- Desktop shell: `client/src/core/Desktop.svelte`
- Window shell: `client/src/core/Window.svelte`
- Taskbar/overlays: `client/src/core/components/*`
- State stores: `client/src/core/stores/*`
- Shared API: `client/src/utils/api.js`

`Desktop.svelte` should orchestrate the desktop, not contain heavy feature logic. Put feature logic in app modules, stores, services, or API helpers.

### Sandbox / Package Layer

This layer owns installed apps, package assets, app-owned data, runtime state, and lifecycle operations.

- Inventory root: `server/storage/inventory/`
- Package APIs: `server/routes/packages.js`
- Runtime APIs: `server/routes/runtime.js`
- Sandbox APIs: `server/routes/sandbox.js`
- Package lifecycle: `server/services/packageLifecycleService.js`
- Runtime manager: `server/services/runtimeManager.js`
- Runtime profile: `server/services/runtimeProfiles.js`
- Template quality gate: `server/services/templateQualityGate.js`
- Package Center UI: `client/src/apps/package-center/PackageCenter.svelte`
- Sandbox frame: `client/src/core/components/SandboxAppFrame.svelte`

Sandbox apps must be handled through app-owned data roots and manifest permissions. Do not broaden Host file access without an explicit approval design.

## Work Area Reference Map

Use this map before editing. Each task should start by reading the files listed for its area, then follow the existing module boundaries.

### Package Center Operations

Use for registry, install/update, installed package console, lifecycle, health, backup, rollback, manifest editing, template scaffold, dependency, and channel policy work.

Read first:

- `client/src/apps/package-center/PackageCenter.svelte`
- `server/routes/packages.js`
- `server/services/packageRegistryService.js`
- `server/services/packageLifecycleService.js`
- `server/services/channelUpdatePolicyService.js`
- `server/services/templateQualityGate.js`
- `server/services/runtimeProfiles.js`
- `server/utils/appPaths.js`
- `server/utils/inventoryPaths.js`
- `server/storage/inventory/`

Keep modular:

- Put HTTP contract and response shape in `server/routes/packages.js`.
- Put package state transitions in lifecycle/channel/template services.
- Keep installed operations, registry, runtime controls, and template/scaffold UI visually separated inside Package Center.
- Add a per-app API helper under `client/src/apps/package-center/` if Package Center logic grows further.

### Runtime And Process Management

Use for `process-node`, `process-python`, `binary`, start/stop/restart, logs, events, health, recovery, autostart, restart policy, and runtime validation.

Read first:

- `server/routes/runtime.js`
- `server/services/runtimeManager.js`
- `server/services/processSupervisor.js`
- `server/services/runtimeStateStore.js`
- `server/services/runtimeProfiles.js`
- `server/config/defaults.json`
- `server/storage/inventory/system/runtime-instances.json`
- `server/storage/inventory/system/runtime-logs/`
- `client/src/apps/package-center/PackageCenter.svelte`

Keep modular:

- Route handlers should call `runtimeManager`, not spawn processes directly.
- Process execution belongs in `processSupervisor`.
- Persisted runtime state belongs in `runtimeStateStore`.
- UI should call runtime APIs through Package Center or a dedicated runtime API helper, not directly from unrelated components.

### Sandbox Apps And App Data

Use for sandbox iframe rendering, manifest loading, package-owned data APIs, app permissions, and sandbox static asset serving.

Read first:

- `server/routes/sandbox.js`
- `server/services/packageRegistryService.js`
- `server/utils/appPaths.js`
- `server/utils/inventoryPaths.js`
- `client/src/core/components/SandboxAppFrame.svelte`
- `client/src/core/Desktop.svelte`
- `server/storage/inventory/apps/`
- `server/storage/inventory/data/`

Keep modular:

- Serve app assets only through sandbox routes.
- Keep app-owned data scoped to `inventory/data/{appId}`.
- Do not add Host filesystem access to sandbox APIs without explicit permission review and user approval UI.

### Desktop Shell, Windows, Taskbar, Spotlight

Use for desktop icons, window host, taskbar, start trigger, desktop switching, notifications, context menu, and global search.

Read first:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
- `client/src/core/Spotlight.svelte`
- `client/src/core/components/Taskbar.svelte`
- `client/src/core/components/ContextMenu.svelte`
- `client/src/core/components/NotificationCenter.svelte`
- `client/src/core/stores/windowStore.js`
- `client/src/core/stores/desktopStore.js`
- `client/src/core/stores/contextMenuStore.js`
- `client/src/core/stores/spotlightStore.js`
- `client/src/core/stores/notificationStore.js`

Keep modular:

- `Desktop.svelte` orchestrates layers and window hosting only.
- `Window.svelte` owns move/resize/focus/maximize/minimize/snap behavior.
- Taskbar and Start Menu logic should live in Taskbar-related components/stores, not in app modules.
- Spotlight should call app/file/package search helpers instead of embedding feature-specific logic.

### UI Customization And Control Panel

Use for wallpaper, theme presets, blur/transparency/accent, desktop layouts, taskbar settings, window defaults, accessibility, and Control Panel sections.

Read first:

- `client/src/apps/control-panel/ControlPanel.svelte`
- `client/src/core/stores/systemStore.js`
- `client/src/core/stores/desktopStore.js`
- `client/src/core/stores/windowStore.js`
- `client/src/core/stores/widgetStore.js`
- `client/src/core/stores/shortcutStore.js`
- `server/routes/system.js`
- `server/services/stateStore.js`
- `server/config/defaults.json`
- `server/storage/inventory/system/`

Keep modular:

- Add persistent settings as store state plus backend `system/state` persistence.
- Keep UI customization in Control Panel, not Settings.
- Add new customization models before adding visual controls.
- Prefer separate small components for large Control Panel sections.

### Agent, LLM, And Wrapped CLI

Use for Agent avatar, chat panel, message history, approval cards, OS action mapping, LLM proxy, terminal summaries, and Wrapped Assistant Mode.

Read first:

- `client/src/core/components/Agent.svelte`
- `client/src/core/stores/agentStore.js`
- `client/src/apps/terminal/Terminal.svelte`
- `server/services/terminal.js`
- `server/routes/logs.js`
- `server/routes/docker.js`
- `server/routes/packages.js`
- `server/routes/runtime.js`

Likely new files:

- `server/routes/ai.js`
- `server/services/aiActionService.js`
- `client/src/core/components/AgentChatPanel.svelte`
- `client/src/core/stores/agentActionStore.js`

Keep modular:

- Agent UI state belongs in stores, not in `Desktop.svelte`.
- LLM proxy and OS action mapping belong in backend routes/services.
- Risky actions must produce approval cards before execution.
- Preserve raw terminal output separately from Agent summaries.

### File Station, Cloud, Share, Transfer

Use for local file browsing, allowed roots, trash, upload/download, ZIP extraction, preview, desktop shortcuts, share links, WebDAV/rclone, and transfer status.

Read first:

- `client/src/apps/file-explorer/FileExplorer.svelte`
- `client/src/apps/file-explorer/api.js`
- `client/src/apps/transfer/TransferUI.svelte`
- `client/src/core/stores/shortcutStore.js`
- `server/routes/fs.js`
- `server/routes/share.js`
- `server/routes/cloud.js`
- `server/services/trashService.js`
- `server/services/shareService.js`
- `server/services/cloudService.js`
- `server/services/indexService.js`
- `server/middleware/pathGuard.js`
- `server/utils/pathPolicy.js`

Keep modular:

- Filesystem policy belongs in backend guards/services.
- UI should not duplicate path-safety checks as its only protection.
- Transfer state should be its own UI/store when upload/download flows grow.
- Cloud paths must remain explicit virtual paths such as `cloud://...`.

### System, Services, Logs, Resource Monitor

Use for service status, service restart, resource monitor, audit logs, system overview, processes, network state, and dashboard-like operational views.

Read first:

- `client/src/apps/resource-monitor/ResourceMonitor.svelte`
- `client/src/apps/resource-monitor/api.js`
- `client/src/apps/log-viewer/LogViewer.svelte`
- `client/src/apps/log-viewer/api.js`
- `client/src/apps/control-panel/ControlPanel.svelte`
- `server/routes/system.js`
- `server/routes/services.js`
- `server/routes/logs.js`
- `server/services/serviceManager.js`
- `server/services/auditService.js`
- `server/services/storageService.js`

Keep modular:

- Service lifecycle belongs in `serviceManager`.
- Audit/log filtering belongs in log service/routes, not UI-only filtering.
- Operational dashboards should compose existing APIs rather than duplicating service logic.

### Docker Manager

Use for Docker container list, start/stop/restart/remove, logs, ports, images, volumes, health, and Compose.

Read first:

- `client/src/apps/docker-manager/DockerManager.svelte`
- `client/src/apps/docker-manager/api.js`
- `server/routes/docker.js`

Likely new files:

- `server/services/dockerService.js`
- `client/src/apps/docker-manager/components/`

Keep modular:

- Move command execution and parsing out of `server/routes/docker.js` if Docker scope grows.
- Use explicit errors for Docker not installed, daemon unavailable, and permission denied.
- Do not connect Docker packages to Package Center without a manifest/runtime policy.

### Media, Document, Model, Code Editor

Use for image/video/audio playback, subtitles, metadata, neighboring media navigation, PDF/document viewing, 3D model inspection, and local code editing.

Read first:

- `client/src/apps/media-player/MediaPlayer.svelte`
- `server/routes/media.js`
- `server/services/mediaService.js`
- `client/src/apps/document-viewer/DocumentViewer.svelte`
- `client/src/apps/model-viewer/ModelViewer.svelte`
- `client/src/apps/code-editor/CodeEditor.svelte`
- `client/src/apps/code-editor/api.js`
- `server/routes/fs.js`

Keep modular:

- Media metadata belongs in `mediaService`.
- File read/write stays behind filesystem APIs.
- Package file editing should connect Code Editor to Package Center context rather than bypassing package APIs.
- 3D viewer controls should remain inside Model Viewer or its subcomponents.

### Settings, Config, Storage, Inventory

Use for server settings, env/defaults, allowed roots, JWT/admin settings, storage roots, inventory paths, and state persistence.

Read first:

- `client/src/apps/settings/Settings.svelte`
- `client/src/apps/settings/api.js`
- `server/routes/settings.js`
- `server/config/serverConfig.js`
- `server/config/defaults.json`
- `server/services/stateStore.js`
- `server/utils/inventoryPaths.js`
- `server/utils/appPaths.js`
- `server/storage/inventory/system/`

Keep modular:

- Settings is for server/runtime configuration.
- Control Panel is for user-facing desktop customization.
- Sensitive values must be masked or skipped when appropriate.
- Inventory paths should go through utility helpers.

### Tests And Documentation

Use when adding behavior, changing lifecycle/runtime/package policy, or modifying source-of-truth expectations.

Read first:

- `server/tests/`
- `package.json`
- `client/package.json`
- `README.md`
- `기획서.md`
- `기획서2.md`
- `기획서3.md`

Keep modular:

- Add focused tests near the behavior being changed.
- If adding server tests, wire an official test command instead of leaving orphaned test files.
- Update planning/docs only when behavior, scope, or priority materially changes.

## Development Order

Follow this order. If the user requests a narrower feature, still handle the minimum required prerequisite for that feature.

### 0. Inspect First

- Read the relevant planning section and current code paths.
- Separate what already exists from what is missing.
- Reuse existing stores, routes, services, helpers, and component patterns.
- Never revert unrelated dirty work.

### 1. Reliability And Boundaries

Handle failure behavior and boundaries first.

- explicit error codes
- recoverable flows
- Host/Sandbox boundaries
- state schema/defaults
- backup/rollback availability
- tests or syntax checks

Do not build only UI when the underlying boundary or recovery model is unclear.

### 2. Package Center Operations

The highest-priority product axis is making Package Center an operations console.

Priority order:

1. Improve Installed-tab runtime/lifecycle/health/log/event visibility.
2. Add install/update preflight review: permissions, quality gate, dependency, compatibility, backup.
3. Explain impact for backup/rollback/recover actions.
4. Connect manifest/file editing with Code Editor.
5. Align Widget Store with the Package Center package-type model.

Installed operations density comes before Store browsing polish.

### 3. Local Workstation Core

Stabilize local PC wrapping features.

Priority order:

1. File Station: allowed roots, trash, share links, uploads, cloud boundaries, large-operation state
2. Terminal: session stability, risky-command approval model, Agent summary readiness
3. Resource Monitor / Log Viewer: connect service, runtime, and package status
4. Docker Manager: logs, ports, volumes, health, then Compose

### 4. UI Customization Foundation

Implement `기획서3.md` customization in this order.

1. Basic Start Menu
2. Persist `desktopStore.js` state through backend system state
3. Taskbar settings model
4. Window defaults/app-specific style model
5. Control Panel UI customization sections
6. Theme preset save/load
7. Desktop layout edit mode
8. Context Menu customization

Do not add visual options without the underlying Start Menu, Taskbar, Window, and Desktop Layout models.

### 5. Agent, LLM, CLI Integration

Agent is an OS work assistant, not a decorative avatar. Do not start with risky automation.

Implementation order:

1. Expand Agent states: `idle`, `listening`, `thinking`, `executing`, `success`, `warning`, `error`, `terminal`
2. Agent chat panel
3. Message persistence model
4. Result cards and approval cards
5. Small OS action mappings: open app, open file path, run package health check, inspect Docker status, summarize recent error logs
6. LLM proxy API
7. Preserve raw Terminal output
8. Wrapped Assistant Mode

Deletion, overwrite install, rollback, and terminal command execution must always go through user approval UI.

### 6. Media, Home Lab, Docker

Expand these only after P0/P1 foundations are stable.

- Media Player: playlist, repeat/shuffle, background audio
- Document Viewer: PDF controls, search, metadata
- Model Viewer: wireframe, axes, material info, screenshot
- Docker Manager: logs, port/image/volume, Compose
- WebDAV/cloud: write/upload, mount status, connection test
- Backup job manager and download/transfer manager

### 7. Docker Portability

Treat Docker portability as a late-stage packaging concern.

- `storage/` volume persistence strategy
- Host path binding strategy
- Dockerfile/docker-compose
- container logs
- script runner isolation upgrade

Do not weaken Host/Sandbox boundaries for the sake of Docker packaging.

## Implementation Rules

- Classify the layer before adding a feature: Host, Desktop, or Sandbox/Package.
- Use the Work Area Reference Map before editing. If the requested area is not listed, find the closest existing route/service/store/component pattern first.
- Stabilize backend contracts before connecting frontend UI.
- For persistent UI state, design the store and persistence schema before adding controls.
- Split new work by responsibility: route for HTTP contract, service for business/state transitions, utility for reusable path/policy helpers, store for frontend state, component for UI.
- For larger features, proceed as: API -> store/helper -> minimal UI -> verification -> docs.
- Prefer adding a small module over expanding a large file when the new logic has its own lifecycle, persistence, policy, or repeated UI.
- Do not create abstractions before there are at least two real call sites or a clear boundary such as runtime, lifecycle, inventory, Agent action, or desktop settings.
- Preserve the existing desktop glassmorphism UX.
- Do not put app-specific logic into `Desktop.svelte` or `Window.svelte`.
- Keep window movement, resizing, focus, minimize/maximize, and snap behavior in `Window.svelte` and window stores.
- In Package Center, keep registry, installed operations, lifecycle, runtime, and template/scaffold concerns separated.
- Never make command execution, file deletion, rollback, or overwrite install silent.
- Avoid committing autogenerated churn. `server/storage/index.json` is usually autogenerated and should usually stay out of commits.

## Frontend Structure Rules

Follow the current structure.

- `client/src/core/Desktop.svelte`: desktop orchestration only
- `client/src/core/Window.svelte`: window behavior
- `client/src/core/components/Taskbar.svelte`: taskbar display and start/menu trigger
- `client/src/core/components/Agent.svelte`: avatar, bubble, chat panel shell
- `client/src/core/stores/*`: persistent UI and runtime state
- `client/src/apps/<app-name>/`: feature UI
- `client/src/apps/<app-name>/api.js`: per-app API wrapper when useful
- `client/src/utils/api.js`: auth-aware shared fetch

UI rules:

- Maintain dark glassmorphism, translucent surfaces, soft borders, compact density, and blue accent.
- Use `lucide-svelte` icons where possible.
- Keep app interiors readable; glass effects must not harm text contrast.
- Prefer dense operational panels for Package Center, Logs, Docker, and Resource Monitor.
- Do not turn operational tools into landing pages.
- Avoid broad redesign unless explicitly requested.
- Preserve keyboard/focus visibility and usable hit areas.

## Backend Structure Rules

Follow the current structure.

- `server/index.js`: composition root, route wiring, service bootstrap, shutdown
- `server/routes/*.js`: HTTP contract, auth guard, validation, response mapping
- `server/services/*.js`: business logic and state transitions
- `server/config/*.js`: defaults, env, public settings
- `server/utils/*.js`: path, inventory, policy helpers
- `server/storage/inventory/system/`: persistent system/package/runtime state
- `server/storage/inventory/apps/`: installed package assets
- `server/storage/inventory/data/`: app-owned data

Backend rules:

- Keep route handlers thin.
- Put lifecycle, runtime, package, quality gate, and channel policy logic in services.
- Return explicit `code` and `message` for recoverable failures.
- Validate app id, paths, runtime profile, manifest, and package file operations.
- Use inventory path helpers instead of hand-building package paths.
- Do not expose inventory internals through File Station unless explicitly designed and guarded.

## Package And Runtime Conventions

Supported runtime types:

- `sandbox-html`: iframe/static UI package
- `process-node`: managed Node.js process
- `process-python`: managed Python process
- `binary`: allowlisted local binary process

Package types:

- `app`: windowed UI package
- `widget`: desktop widget package
- `service`: background package
- `hybrid`: UI plus background service
- `developer`: tools for package creation/testing

Package work must consider:

- permissions review
- manifest validation
- runtime profile validation
- dependency and SemVer compatibility
- channel update policy
- template quality gate
- lifecycle history
- backup before overwrite/update
- rollback path
- health report
- logs and events

## Current Priority Backlog

Follow this order unless the user gives a narrower task.

### Autonomous Roadmap Loop

When the user asks to proceed from `AGENTS.md` without naming a specific task, select the first unfinished item from P0, then P1, then P2, then P3.
Work on one bounded backlog item at a time.

At the start of the task:

- State the selected backlog item.
- State the relevant files from the Work Area Reference Map.
- If multi-agent work was explicitly requested, split the task by non-overlapping file ownership.

At the end of the task:

- Summarize what changed.
- Summarize what verification was run or why it was skipped.
- State the next recommended backlog item.
- Ask the user whether to continue with that next item, choose a different item, commit, or stop.

Do not automatically start the next backlog item after finishing the current one unless the user already gave explicit permission to continue through multiple items.

### P0

- Package Center Installed-tab runtime/lifecycle console polish
- Install/update preflight review: permissions, quality gate, dependency, compatibility, backup
- Settings and Control Panel role separation
- File Station boundary and error UX
- official test command for `server/tests/*`
- Start Menu base
- Taskbar settings model
- Window defaults model
- Agent chat panel base

### P1

- Package creation wizard
- manifest editor UI
- Code Editor and Package Center file editing integration
- Theme presets
- desktop layout persistence and edit mode
- Agent status expansion and approval cards
- Wrapped Assistant Mode UI skeleton

### P2

- Context menu customization
- app-specific window backgrounds
- Docker logs/ports/volumes/Compose
- Media playlist/background audio
- Document Viewer controls/search
- Model Viewer advanced inspection

### P3

- WebDAV/cloud write and mount status
- backup job manager
- service/runtime/package dashboard
- download/transfer manager
- Docker packaging and portability

## Verification

Use the smallest checks that cover the change.

Backend syntax checks:

```bash
node --check server/routes/packages.js
node --check server/routes/runtime.js
node --check server/services/runtimeManager.js
node --check server/services/packageLifecycleService.js
node --check server/services/templateQualityGate.js
```

Frontend build:

```bash
cd client
npm run build
```

Run locally:

```bash
node server/index.js
```

```bash
cd client
npm run dev
```

When adding or changing server tests, also add or update the official test command instead of leaving tests orphaned.

## Definition Of A Good Change

A good change:

- moves the project closer to the three planning documents
- keeps Host, Desktop, and Sandbox/Package boundaries clear
- improves failure visibility or recoverability
- preserves the current glass desktop language
- avoids unrelated broad refactors
- uses existing stores, services, helpers, and route patterns
- includes validation appropriate to the risk
- updates planning/docs when scope or behavior changes materially

## Git And Workspace Rules

- The worktree may already contain user changes.
- Never revert unrelated changes.
- Do not use destructive git commands unless explicitly requested.
- Do not commit autogenerated index churn unless explicitly requested.
- `server/storage/index.json` is frequently autogenerated and should usually stay out of commits.

## Notes For Other Agents

This repository uses `AGENTS.md` as the canonical agent guide.
If another tool needs `CLAUDE.md` or `.github/copilot-instructions.md`, mirror this file rather than maintaining conflicting instructions.
