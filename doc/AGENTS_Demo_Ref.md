# AGENTS.md

This is the repository-level preset for coding agents working on My Web OS.
It should be enough to begin work safely without rereading every document, while still pointing to the right source when product direction is unclear.

## Operating Mode

Default behavior:

1. Classify the request into one or more layers: `Host`, `Web Desktop`, `Sandbox / Package`.
2. Inspect existing code before inventing structure. Reuse current routes, services, stores, components, and API helpers.
3. Work in this order: `API/service contract -> store/helper -> minimal UI -> verification -> docs update`.
4. Handle boundaries, explicit errors, approvals, backup/rollback, and recovery before UI polish.
5. Run the smallest useful verification for the touched area, or state why it was skipped.
6. Never revert unrelated dirty work.

Default development priority:

`reliability/boundary -> Package Center operations -> local workstation core -> UI customization -> Agent/LLM -> media/home lab -> Docker portability`

## Project Identity

My Web OS is not a kernel-level OS replacement.
It is a personal Web OS layer around an existing local PC, exposed through a browser-based desktop for files, terminal access, system status, Docker, packages, runtimes, backup/recovery, and customization.

Core principles:

- Local PC capabilities must be exposed through clear UI/API boundaries.
- The web desktop should reduce real workflow friction, not only look like a desktop.
- Package Center is a workshop and maintenance console, not only an app store.
- Failures, logs, health, backup, rollback, and recovery options should be visible.
- Customization means storing and reshaping workflows, not only colors.
- Agent/LLM features start with explanation, summary, approval, and result reporting before autonomous execution.

## Source Documents

Source of truth:

- `doc/planning/project-identity-boundaries.md`: identity, Host/Sandbox boundaries, operational reliability
- `doc/planning/feature-scope-priorities.md`: feature scope, priorities, Package Center, local workstation direction
- `doc/planning/ui-ux-customization-agent.md`: UI/UX, customization, Start Menu, Taskbar, Window, Agent/CLI direction

Reference documents:

- `README.md`: user-facing overview, current features, run guide
- `doc/README.md`: documentation index
- `doc/reference/architecture-api-reference.md`: compact architecture and API map
- `doc/operations/completed-backlog-log.md`: completed/worked backlog migration log
- `doc/operations/local-run-guide.md`: local run and process checks
- `doc/policies/file-station-places-policy.md`: File Station Places policy
- `doc/migrations/media-library-path-migration.md`: legacy wallpaper/media path migration
- `만들것들.md`: future package/widget/app ideas

Conflict resolution:

- Product direction follows the three `doc/planning/*` documents.
- If docs conflict with current code, inspect the code and move gradually toward the planning direction.
- Update docs only when behavior, scope, priority, or operating guidance materially changes.

## Architecture Layers

### Host Layer

Touches the real local machine.

- File system: `server/routes/fs.js`, `client/src/apps/file-explorer/`
- Terminal: `server/services/terminal.js`, `client/src/apps/terminal/`
- System status: `server/routes/system.js`, `client/src/apps/resource-monitor/`
- Docker: `server/routes/docker.js`, `client/src/apps/docker-manager/`
- Server settings: `server/config/*`, `server/routes/settings.js`, `client/src/apps/settings/`
- Logs/audit: `server/services/auditService.js`, `server/routes/logs.js`, `client/src/apps/log-viewer/`

Rules:

- Return explicit `code` and `message` for recoverable failures.
- Use user-facing explanations and approval flows for risky actions.
- Keep filesystem policy in backend guards/services, not UI-only checks.

### Web Desktop Layer

The user-facing operating surface.

- Entry/auth: `client/src/App.svelte`
- Desktop shell: `client/src/core/Desktop.svelte`
- Window shell: `client/src/core/Window.svelte`
- Taskbar/overlays: `client/src/core/components/*`
- State stores: `client/src/core/stores/*`
- Shared API: `client/src/utils/api.js`

Rules:

- `Desktop.svelte` orchestrates layers and window hosting only.
- `Window.svelte` owns move, resize, focus, maximize, minimize, and snap behavior.
- Feature logic belongs in app modules, stores, services, or API helpers.

### Sandbox / Package Layer

Owns installed apps, package assets, app-owned data, runtime state, and lifecycle operations.

- Inventory root: `server/storage/inventory/`
- Package APIs: `server/routes/packages.js`
- Runtime APIs: `server/routes/runtime.js`
- Sandbox APIs: `server/routes/sandbox.js`
- Package services: `server/services/packageRegistryService.js`, `server/services/packageLifecycleService.js`
- Runtime services: `server/services/runtimeManager.js`, `server/services/runtimeProfiles.js`
- Quality gate: `server/services/templateQualityGate.js`
- Package Center UI: `client/src/apps/package-center/PackageCenter.svelte`
- Sandbox frame: `client/src/core/components/SandboxAppFrame.svelte`

Rules:

- Serve app assets only through sandbox routes.
- Keep app-owned data scoped to `server/storage/inventory/data/{appId}`.
- Do not broaden Host file access without explicit approval design.
- Package work must consider permissions, manifest validation, runtime profile validation, dependencies, SemVer compatibility, channel policy, quality gate, backup, rollback, health, logs, and events.

## Work Area Map

Read the relevant files before editing.

### Package Center Operations

Use for registry, install/update, installed package console, lifecycle, health, backup, rollback, manifest editing, template scaffold, dependency, and channel policy.

Read first:

- `client/src/apps/package-center/PackageCenter.svelte`
- `client/src/apps/package-center/api.js`
- `server/routes/packages.js`
- `server/services/packageRegistryService.js`
- `server/services/packageLifecycleService.js`
- `server/services/channelUpdatePolicyService.js`
- `server/services/templateQualityGate.js`
- `server/services/runtimeProfiles.js`
- `server/utils/appPaths.js`
- `server/utils/inventoryPaths.js`

Keep registry, installed operations, runtime controls, and template/scaffold UI visually separated inside Package Center.

### Runtime And Process Management

Use for `process-node`, `process-python`, `binary`, start/stop/restart, logs, events, health, recovery, autostart, restart policy, and runtime validation.

Read first:

- `server/routes/runtime.js`
- `server/services/runtimeManager.js`
- `server/services/processSupervisor.js`
- `server/services/runtimeStateStore.js`
- `server/services/runtimeProfiles.js`
- `server/storage/inventory/system/runtime-instances.json`
- `client/src/apps/package-center/PackageCenter.svelte`

Route handlers should call `runtimeManager`; process execution belongs in `processSupervisor`; persisted runtime state belongs in `runtimeStateStore`.

### Sandbox Apps And App Data

Read first:

- `server/routes/sandbox.js`
- `server/services/packageRegistryService.js`
- `server/utils/appPaths.js`
- `server/utils/inventoryPaths.js`
- `client/src/core/components/SandboxAppFrame.svelte`
- `server/storage/inventory/apps/`
- `server/storage/inventory/data/`

Keep manifest permissions and app-owned data boundaries intact.

### Desktop Shell, Windows, Taskbar, Spotlight

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

Taskbar, Start Menu, and Spotlight logic should live in their own components/stores/helpers, not in app modules.

### UI Customization And Control Panel

Read first:

- `client/src/apps/control-panel/ControlPanel.svelte`
- `client/src/core/stores/systemStore.js`
- `client/src/core/stores/desktopStore.js`
- `client/src/core/stores/windowStore.js`
- `client/src/core/stores/widgetStore.js`
- `client/src/core/stores/shortcutStore.js`
- `server/routes/system.js`
- `server/services/stateStore.js`

Control Panel is for user-facing customization. Settings is for server/runtime configuration.

### Agent, LLM, And Wrapped CLI

Read first:

- `client/src/core/components/Agent.svelte`
- `client/src/core/components/AgentChatPanel.svelte`
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
- `client/src/core/stores/agentActionStore.js`

Risky actions must produce approval cards before execution. Preserve raw terminal output separately from Agent summaries.

### File Station, Cloud, Share, Transfer

Read first:

- `client/src/apps/file-explorer/FileExplorer.svelte`
- `client/src/apps/file-explorer/api.js`
- `client/src/apps/transfer/TransferUI.svelte`
- `server/routes/fs.js`
- `server/routes/share.js`
- `server/routes/cloud.js`
- `server/services/trashService.js`
- `server/services/shareService.js`
- `server/services/cloudService.js`
- `server/services/indexService.js`
- `server/middleware/pathGuard.js`
- `server/utils/pathPolicy.js`
- `doc/policies/file-station-places-policy.md`

Cloud paths must remain explicit virtual paths such as `cloud://...`.

### System, Services, Logs, Resource Monitor

Read first:

- `client/src/apps/resource-monitor/ResourceMonitor.svelte`
- `client/src/apps/resource-monitor/api.js`
- `client/src/apps/log-viewer/LogViewer.svelte`
- `client/src/apps/log-viewer/api.js`
- `server/routes/system.js`
- `server/routes/services.js`
- `server/routes/logs.js`
- `server/services/serviceManager.js`
- `server/services/auditService.js`
- `server/services/storageService.js`

Operational dashboards should compose existing APIs rather than duplicating service logic.

### Docker Manager

Read first:

- `client/src/apps/docker-manager/DockerManager.svelte`
- `client/src/apps/docker-manager/api.js`
- `server/routes/docker.js`

If Docker scope grows, move command execution/parsing out of `server/routes/docker.js` into a service. Use explicit errors for Docker not installed, daemon unavailable, and permission denied.

### Media, Document, Model, Code Editor

Read first:

- `client/src/apps/media-player/MediaPlayer.svelte`
- `server/routes/media.js`
- `server/services/mediaService.js`
- `client/src/apps/document-viewer/DocumentViewer.svelte`
- `client/src/apps/model-viewer/ModelViewer.svelte`
- `client/src/apps/code-editor/CodeEditor.svelte`
- `client/src/apps/code-editor/api.js`
- `server/routes/fs.js`
- `doc/migrations/media-library-path-migration.md`

Media metadata belongs in `mediaService`; file read/write stays behind filesystem or package APIs.

### Settings, Config, Storage, Inventory

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

Sensitive values must be masked or skipped as appropriate. Inventory paths should go through utility helpers.

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

Add focused tests near changed behavior. If adding server tests, wire or update the official test command.

## Development Order

### 0. Inspect First

- Read relevant current code and only the needed planning/reference document.
- Separate what exists from what is missing.
- Reuse existing helpers and patterns.

### 1. Reliability And Boundaries

Prioritize:

- explicit error codes
- recoverable flows
- Host/Sandbox boundaries
- state schema/defaults
- backup/rollback availability
- tests or syntax checks

### 2. Package Center Operations

Priority:

1. Installed-tab runtime/lifecycle/health/log/event visibility
2. install/update preflight review
3. backup/rollback/recover impact explanation
4. manifest/file editing with Code Editor
5. Widget Store alignment with package-type model

### 3. Local Workstation Core

Priority:

1. File Station boundaries, trash, share, upload, cloud, large-operation state
2. Terminal session stability and risky-command approval model
3. Resource Monitor / Log Viewer service-runtime-package status
4. Docker logs, ports, volumes, health, then Compose

### 4. UI Customization Foundation

Priority:

1. Start Menu base
2. Desktop state persistence
3. Taskbar settings model
4. Window defaults/app-specific style model
5. Control Panel customization sections
6. Theme preset save/load
7. Desktop layout edit mode
8. Context Menu customization

### 5. Agent, LLM, CLI Integration

Priority:

1. Agent states: `idle`, `listening`, `thinking`, `executing`, `success`, `warning`, `error`, `terminal`
2. Agent chat panel
3. Message persistence model
4. Result cards and approval cards
5. Small OS actions: open app, open file path, package health check, Docker status, recent error log summary
6. LLM proxy API
7. Raw Terminal output preservation
8. Wrapped Assistant Mode

### 6. Media, Home Lab, Docker

Expand after P0/P1 foundations are stable:

- Media playlist/repeat/shuffle/background audio
- Document Viewer PDF controls/search/metadata
- Model Viewer wireframe/axes/material info/screenshot
- Docker Compose and richer container operations
- WebDAV/cloud write/upload/mount status
- Backup job manager and transfer manager

### 7. Docker Portability

Treat as late-stage packaging:

- `storage/` volume persistence
- Host path binding strategy
- Dockerfile/docker-compose
- container logs
- script runner isolation upgrade

Do not weaken Host/Sandbox boundaries for Docker portability.

## Implementation Rules

- Stabilize backend contracts before frontend UI.
- For persistent UI state, design store state and backend `system/state` schema before adding controls.
- Split responsibilities: route for HTTP contract, service for state/business logic, utility for reusable path/policy helpers, store for frontend state, component for UI.
- Add new abstractions only for real boundaries or repeated call sites.
- Keep Package Center registry, installed operations, lifecycle, runtime, template/scaffold concerns separated.
- Never make command execution, deletion, rollback, or overwrite install silent.
- Avoid committing autogenerated churn. `server/storage/index.json` is usually autogenerated and should usually stay out of commits.

## Frontend Rules

- Preserve dark glassmorphism, translucent surfaces, soft borders, compact density, and blue accent.
- Use `lucide-svelte` icons where possible.
- Keep operational tools dense and readable.
- Do not turn operational tools into landing pages.
- Preserve keyboard/focus visibility and usable hit areas.
- Do not put app-specific logic in `Desktop.svelte` or `Window.svelte`.

## Backend Rules

- `server/index.js`: composition root, route wiring, service bootstrap, shutdown
- `server/routes/*.js`: HTTP contract, auth guard, validation, response mapping
- `server/services/*.js`: business logic and state transitions
- `server/config/*.js`: defaults, env, public settings
- `server/utils/*.js`: path, inventory, policy helpers

Route handlers should stay thin. Validate app id, paths, runtime profile, manifest, and package file operations on the backend.

## Package And Runtime Conventions

Runtime types:

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

## Autonomous Roadmap Loop

When the user asks to proceed from `AGENTS.md` without naming a specific task:

1. Check `doc/operations/completed-backlog-log.md`.
2. Select one bounded unfinished item following the default development priority.
3. State the selected item and relevant files.
4. Implement one bounded change.
5. Verify the touched area.
6. Summarize changes, verification, and the next recommended item.
7. Do not start the next backlog item unless the user explicitly asks to continue.

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

Prompt shape:

```text
Use two sub-agents in parallel.
Explorer 1: inspect <area> and report exact files, risks, and recommended changes. Do not edit files.
Worker 1: implement <bounded change> in <explicit files/modules>. Do not touch other areas or revert unrelated changes.
Main agent: keep the critical path locally, review both results, integrate, verify, and summarize.
```

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

## Git And Workspace Rules

- The worktree may already contain user changes.
- Never revert unrelated changes.
- Do not use destructive git commands unless explicitly requested.
- Do not commit autogenerated index churn unless explicitly requested.
- `server/storage/index.json` is frequently autogenerated and should usually stay out of commits.

## Good Change Definition

A good change:

- moves the project closer to the planning documents
- keeps Host, Desktop, and Sandbox/Package boundaries clear
- improves failure visibility or recoverability
- preserves the current glass desktop language
- avoids unrelated broad refactors
- uses existing stores, services, helpers, and route patterns
- includes validation appropriate to the risk
- updates docs when scope or behavior materially changes

## Canonical Guide

This repository uses `AGENTS.md` as the canonical agent guide.
If another tool needs `CLAUDE.md` or `.github/copilot-instructions.md`, mirror this file rather than maintaining conflicting instructions.
