# AGENTS.md

Operational guide for coding agents working on My Web OS.

This guide is rebuilt from `doc/operations/home-server-readiness-review-2026-04-26.md`
and is intended for active development. The current priority is not new core
feature expansion. The priority is closing the home-server readiness gates that
block a credible addon-only/core-freeze phase.

Execution shape:

```text
scope -> MVP -> analysis -> document re-reference -> contract/API
-> service/helper/store -> minimal UI -> verification -> docs/reporting
```

## 1) Product Scope

My Web OS is a browser-based operations layer for a personally owned PC, home
server, or homelab.

It is not:

- a kernel OS replacement
- a virtual machine platform
- an enterprise multi-tenant SaaS
- a public internet service by default

Core model:

```text
Home Server = files, media, backup, services, Docker, logs
Remote Computer = terminal, app launch, file editing, system state
Web OS = permissions, approval, audit, lifecycle, recovery
Package Center = install/create/run/update/backup/rollback
```

Current development decision:

- VPN/internal owner-only beta use is acceptable with explicit known risks.
- Addon development may continue, but it must not bypass Host/file/package
  contracts.
- Addon-only/core-freeze is conditionally ready now that the HSR gates in
  section 8 are done.
- Direct public internet exposure is not recommended until hardened deployment
  and frontend real-use smoke coverage are verified.

## 2) Operating Decisions From The Readiness Review

Use these as constraints when selecting and implementing work.

1. Host operations are real operations.
   - Files, Terminal, Docker, services, cloud transfer, and backup affect the
     actual machine.
   - Do not treat these as mock UI flows.

2. Approval is a backend contract, not a browser confirm.
   - Risky operations require backend preflight, target evidence/hash, scoped
     nonce, TTL, consume-once semantics, execution revalidation, and audit.
   - UI modals explain intent; the backend enforces safety.

3. Hide complexity, not risk.
   - Users should not need to understand tickets, leases, Range, retry, quota,
     partial files, or rclone flags.
   - Quota pause, overwrite conflict, permission failure, unrecoverable state,
     and backend restart interruption must be explicit.

4. Terminal stays privileged, but not silent.
   - Interactive Terminal is a raw admin shell after backend session approval.
   - Agent, quick action, saved command, package script, and other Web OS
     command injection paths require per-command approval.

5. Trash-first delete still changes Host state.
   - File delete, recursive delete, multi-select delete, permanent delete, and
     empty trash require approval levels appropriate to impact.

6. Package install/update/rollback are high-impact lifecycle actions.
   - They can change executable code, manifest permissions, runtime behavior,
     file associations, and data boundaries.
   - They need the same approval family as package delete.

7. Share state is runtime state.
   - `server/storage/shares.json` contains live share tokens/policy/counts.
   - It should not be treated as a committed fixture unless explicitly converted
     to a redacted fixture/schema.

## 3) Canonical Sources And Precedence

Use this order when docs and code conflict:

1. Code-verified behavior for the current implementation.
2. `AGENTS.md`.
3. Active readiness review:
   - `doc/operations/home-server-readiness-review-2026-04-26.md`
4. Product and roadmap:
   - `doc/planning/product-brief-home-server-remote-computer.md`
   - `doc/planning/project-identity-boundaries.md`
   - `doc/planning/roadmap-home-server-remote-computer.md`
   - `doc/planning/implementation-priority-plan.md`
5. Active remediation and workflow plans:
   - `doc/planning/real-use-remediation-plan.md`
   - `doc/planning/app-install-file-workflow-direction.md`
   - `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`
   - `doc/planning/feature-scope-priorities.md`
   - `doc/planning/feature-inventory-home-server-remote-computer.md`
6. Package/reference contracts:
   - `doc/reference/architecture-api-reference.md`
   - `doc/reference/app-development-model.md`
   - `doc/reference/app-ownership-matrix.md`
   - `doc/reference/package-ecosystem-guide.md`
   - `doc/reference/community-registry-and-presets.md`
7. Presets and code-backed fixtures:
   - `doc/presets/`
   - `server/presets/`
   - `server/storage/inventory/system/apps.json`
   - `server/storage/inventory/apps/`
8. Operations evidence:
   - `README.md`
   - `USER_README.md`
   - `doc/README.md`
   - `doc/operations/local-run-guide.md`
   - `doc/operations/remote-access-hardening-guide.md`
   - `doc/operations/runtime-stability-notes-2026-04-26.md`
   - `doc/operations/completed-backlog-log.md`
   - `doc/operations/verification-gate-guide.md`

If docs and code conflict, implement to code-verified behavior first, then sync
the relevant docs in the same work packet when practical.

## 4) Technology Stack And Sources

The source of truth for versions is local project metadata, not memory.

Backend/runtime:

- Node.js runtime target is Docker-backed Node 20.
  - Source: `docker/Dockerfile.backend`
  - Source: `docker/Dockerfile.frontend`
- Express, Socket.io, JWT, bcrypt, security middleware, upload/archive, host
  operations, and media dependencies are sourced from `package.json`.
- Host/system operations are implemented under `server/routes/`,
  `server/services/`, `server/middleware/`, and `server/utils/`.

Frontend:

- Svelte 5 and Vite 8 are sourced from `client/package.json`.
- Frontend API boundary:
  - `client/src/utils/api.js`
  - `client/src/utils/constants.js`
- Core desktop orchestration:
  - `client/src/core/`

Package/runtime model:

- Package Center UI: `client/src/apps/system/package-center/`
- Package routes/services:
  - `server/routes/packages.js`
  - `server/routes/runtime.js`
  - `server/routes/sandbox.js`
  - `server/services/packageRegistryService.js`
  - `server/services/packageLifecycleService.js`
  - `server/services/runtimeManager.js`
  - `server/services/templateCatalogService.js`
- Package inventory and presets:
  - `server/storage/inventory/`
  - `server/presets/`
  - `doc/presets/`
- Package tooling:
  - `tools/package-doctor.js`
  - `tools/migrate-apps-registry.js`

Verification/tooling:

- Server tests: `npm test` or `npm run test:server`
- Syntax verification: `npm run verify:syntax`
- Full local verification: `npm run verify`
- Docker config verification: `npm run verify:docker-config`
- Frontend build: `npm --prefix client run build`
- CI workflow: `.github/workflows/verify.yml`

## 5) Layer Map

Classify every task into one or more layers before implementation.

Host:

- Routes:
  - `server/routes/fs.js`
  - `server/routes/system.js`
  - `server/routes/settings.js`
  - `server/routes/docker.js`
  - `server/routes/logs.js`
  - `server/routes/cloud.js`
  - `server/routes/transfer.js`
  - `server/routes/media.js`
  - `server/routes/share.js`
  - `server/routes/auth.js`
- Services:
  - `server/services/terminal.js`
  - `server/services/dockerService.js`
  - `server/services/cloudService.js`
  - `server/services/cloudTransferJobService.js`
  - `server/services/transferJobService.js`
  - `server/services/fileTicketService.js`
  - `server/services/fileGrantService.js`
  - `server/services/shareService.js`
  - `server/services/operationApprovalService.js`
  - `server/services/auditService.js`
  - `server/services/trashService.js`
  - `server/services/storageService.js`
  - `server/services/mediaService.js`
- Boundary utilities:
  - `server/middleware/auth.js`
  - `server/middleware/pathGuard.js`
  - `server/utils/pathPolicy.js`
  - `server/utils/urlRedaction.js`
  - `server/utils/appPaths.js`
  - `server/utils/inventoryPaths.js`

Web Desktop:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
- `client/src/core/Spotlight.svelte`
- `client/src/core/Login.svelte`
- `client/src/core/appLaunchRegistry.js`
- `client/src/core/appOwnershipContract.js`
- `client/src/core/components/`
- `client/src/core/stores/`

System Apps:

- File Station: `client/src/apps/system/file-explorer/`
- Package Center: `client/src/apps/system/package-center/`
- Transfer UI: `client/src/apps/system/transfer/`
- Download Station: `client/src/apps/system/download-station/`
- Docker Manager: `client/src/apps/system/docker-manager/`
- Terminal: `client/src/apps/system/terminal/`
- Settings/Cloud/Backup: `client/src/apps/system/settings/`
- Station apps: `client/src/apps/system/*-station/`
- Resource/Log/Control: `client/src/apps/system/resource-monitor/`,
  `client/src/apps/system/log-viewer/`, `client/src/apps/system/control-panel/`

Addon Runtime/UI:

- Code Editor: `client/src/apps/addons/code-editor/`
- Document Viewer: `client/src/apps/addons/document-viewer/`
- Media Player: `client/src/apps/addons/media-player/`
- Model Viewer: `client/src/apps/addons/model-viewer/`
- Widget Store: `client/src/apps/addons/widget-store/`

Sandbox / Package:

- Routes:
  - `server/routes/packages.js`
  - `server/routes/runtime.js`
  - `server/routes/sandbox.js`
- Services:
  - `server/services/runtimeManager.js`
  - `server/services/runtimeProfiles.js`
  - `server/services/processSupervisor.js`
  - `server/services/packageLifecycleService.js`
  - `server/services/packageRegistryService.js`
  - `server/services/templateCatalogService.js`
  - `server/services/templateQualityGate.js`
  - `server/services/capabilityCatalog.js`
  - `server/services/appApiPolicy.js`
- Runtime/static:
  - `server/static/webos-sandbox-sdk.js`
  - `server/storage/inventory/`

Docs / Verification:

- Active review: `doc/operations/home-server-readiness-review-2026-04-26.md`
- Planning docs: `doc/planning/`
- Reference docs: `doc/reference/`
- Operations docs: `doc/operations/`
- Tests: `server/tests/`
- Tools: `tools/`
- Package metadata: `package.json`, `client/package.json`
- Deployment: `docker-compose.yml`, `docker-compose.hardened.yml`,
  `docker-compose.hardened-acme.yml`, `docker/`

## 6) Operating Contract

1. Run `git status --short` first and identify unrelated dirty/untracked files.
   Do not revert them.
2. Classify the task by layer.
3. Select the smallest useful MVP slice.
4. Inspect existing route/service/store/UI/test files before editing.
5. Re-open the relevant docs from sections 3 and 7.3.
6. Implement in this order:
   - contract/API
   - service/helper/store
   - backend validation and structured errors
   - audit/approval/recovery evidence
   - minimal UI
   - focused tests
   - verification
   - docs/reporting
7. Keep `client/src/core/Desktop.svelte` and `client/src/core/Window.svelte`
   orchestration-only.
8. Treat Package Center as an operations/workshop surface, not just a storefront.
9. Never silently execute risky actions:
   - file delete, recursive delete, permanent delete, empty trash
   - overwrite or restore
   - rollback
   - package install/update/remove
   - command execution or terminal session start
   - Docker stop/restart/remove
   - cloud/backup overwrite
10. Use structured server errors with `code`, `message`, and useful `details`.
11. Redact `token`, `grantId`, `ticket`, `code`, `secret`, `password`, and
    `authorization` in logs, job summaries, and UI messages.
12. Use realpath/lstat-aware path policy for Host file work.
13. Run the smallest useful verification set and report skipped checks.
14. Sync docs when code-verified behavior changes.

## 7) MVP -> Analysis -> Document Re-Reference -> Development Pipeline

Use this pipeline for every non-trivial change.

### 7.1 MVP

Print or keep this block before coding:

```text
Selected item:
Layer(s):
MVP behavior:
User-visible outcome:
Risk level:
In scope:
Out of scope:
DoD:
Verification commands:
Rollback/safety notes:
```

Rules:

- MVP must include at least one verification path.
- MVP must preserve existing code-verified behavior unless the task explicitly
  changes it.
- MVP must not hide incomplete risky behavior behind UI polish.

### 7.2 Analysis

Inspect before editing:

- current route/API contract
- current service/helper/store ownership
- current UI caller
- current tests covering behavior
- generated/runtime files that must not be committed
- security boundary and approval/audit implications

Analysis checklist:

- Does this touch Host files, Docker, terminal, package lifecycle, rollback, or
  destructive operations?
- Does it need backend preflight/approval/consume-once evidence?
- Does it need structured `code/message/details` errors?
- Does it affect sandbox grants, raw URLs, file tickets, media leases, or shares?
- Does it belong in a shared helper/store instead of Desktop/Window?
- Can existing tests be extended instead of adding a broad new harness?

### 7.3 Document Re-Reference

Before editing code, re-open the relevant docs:

Security/real-use:

- `doc/operations/home-server-readiness-review-2026-04-26.md`
- `doc/planning/real-use-remediation-plan.md`
- `doc/planning/project-identity-boundaries.md`
- `doc/operations/remote-access-hardening-guide.md`

Package/install:

- `doc/planning/app-install-file-workflow-direction.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/reference/app-development-model.md`
- `doc/reference/architecture-api-reference.md`

Desktop/launcher:

- `doc/planning/project-identity-boundaries.md`
- `doc/reference/app-ownership-matrix.md`

Large-file/media/share/cloud/backup:

- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/planning/real-use-remediation-plan.md`

Verification/tooling:

- `doc/operations/verification-gate-guide.md`
- `doc/operations/runtime-stability-notes-2026-04-26.md`
- `doc/operations/local-run-guide.md`

If docs are stale, implement to code-verified behavior first, then update the
relevant doc in the same work packet when practical.

### 7.4 Development

Implementation sequence:

1. Define or adjust API/contract shape.
2. Implement service/helper/store logic.
3. Add backend validation and structured errors.
4. Add approval/audit/recoverability where risk is high.
5. Add minimal UI only after backend boundary behavior is explicit.
6. Add or update focused tests.
7. Run targeted verification.
8. Run broader verification if blast radius is high.
9. Update docs and report.

Do not:

- add broad abstractions before the MVP proves repeated need
- put feature business logic in Desktop/Window
- add UI-only confirmation for backend-risky operations
- conflate preview ticket, media lease, share download, and durable jobs
- treat a build pass as UX verification when behavior changed

## 8) Active Backlog

Active queue source:

- `doc/operations/home-server-readiness-review-2026-04-26.md`

Current completion posture:

- The HSR execution queue from the 2026-04-26 readiness review is closed for
  the current codebase.
- `HSR-C1` package lifecycle approval, `HSR-C2` terminal session approval,
  `HSR-C3` native prompt cleanup, `HSR-C4` dependency-free UI smoke gate, and
  `HSR-C5` final verification/docs sync are complete unless focused tests
  regress.
- `npm run verify:ui-smoke` is the current release smoke gate. It verifies
  deterministic workflow source contracts, backend health, and frontend shell
  boot. Full Playwright-style click-through automation is a future hardening
  enhancement, not an active HSR blocker.

Completion rule:

- Do not reopen completed HSR slices unless verification fails or code review
  finds a concrete regression.
- New core work should be limited to bugfix, security, reliability,
  performance, verification, or platform contract maintenance.
- New user-facing expansion should normally land in packages/addons.

Closed completion item order:

1. `HSR-C1` Package Lifecycle Approval Completion
2. `HSR-C2` Terminal Approval Completion
3. `HSR-C3` Native Prompt Cleanup And Approval UI Completion
4. `HSR-C4` Dependency-free UI Smoke Gate
5. `HSR-C5` Final Addon-only Gate Verification And Docs Sync

Completion status:

| Gate | Status | Next action |
| --- | --- | --- |
| File delete / empty trash / overwrite approval | Done | Keep tests green. |
| Docker backend approval and UI | Done | Keep tests/build green. |
| Sandbox raw URL cleanup | Done | Keep SDK and ticket tests green. |
| File Station and addon overwrite trust cleanup | Done | Keep backend approval callers green. |
| Transfer/runtime state cleanup | Done | Keep cloud/transfer/share tests green. |
| Package install/update/rollback approval | Done | Keep lifecycle approval tests green. |
| Terminal session approval | Done | Keep terminal approval tests green. |
| Frontend UI smoke | Done | Run `npm run verify:ui-smoke` with local servers before release. |

Historical source item order:

1. `HSR-1` Risky Operation Approval Unification
2. `HSR-2` Sandbox Raw URL Cleanup
3. `HSR-3` File Station Trust Cleanup
4. `HSR-4` Transfer And Backup Durability Close-out
5. `HSR-5` Runtime State Policy Cleanup
6. `HSR-6` Frontend Real-use Smoke Gate

The historical HSR sections below preserve source context. For execution, use
`HSR-C1` through `HSR-C5` unless the user explicitly asks to reopen a completed
source item.

### HSR-C1 Package Lifecycle Approval Completion

Layer(s):

- Host
- Sandbox / Package
- Remote Computer UX
- Docs / Verification

Problem:

- Package delete already uses `operationApprovalService`.
- Registry install, ZIP import/update, rollback, and manifest/runtime scope
  changes can still execute without the same consume-once backend approval
  nonce family.
- Package lifecycle actions can change executable code, permissions, runtime
  behavior, file associations, backups, and rollback targets.

Files to inspect first:

- Backend:
  - `server/services/operationApprovalService.js`
  - `server/services/auditService.js`
  - `server/routes/packages.js`
  - `server/services/packageLifecycleService.js`
- Frontend:
  - `client/src/apps/system/package-center/PackageCenter.svelte`
  - `client/src/apps/system/package-center/api.js`
- Tests:
  - `server/tests/package-delete-approval-contract.test.js`
  - add `server/tests/package-lifecycle-approval-contract.test.js`

Contract/API target:

- Preserve existing package preflight routes and add missing approval fields to
  their responses instead of inventing a separate lifecycle model.
- Registry install and update:
  - preflight action: `package.install` or `package.update`
  - execute endpoint: `POST /api/packages/registry/install`
  - target evidence: source id, package id, package URL or registry metadata,
    incoming manifest hash, existing app id, version, requested overwrite, and
    lifecycle safeguard blockers
- ZIP import and update:
  - preflight action: `package.import` or `package.update`
  - execute endpoint: `POST /api/packages/import`
  - target evidence: uploaded archive hash, manifest id, manifest hash,
    existing app id, requested overwrite, local workspace bridge, and lifecycle
    safeguard blockers
- Rollback:
  - preflight action: `package.rollback`
  - execute endpoint: `POST /api/packages/:id/rollback`
  - target evidence: app id, selected backup id, backup manifest hash or backup
    metadata hash, runtime status, and rollback safeguard blockers
- Manifest/runtime scope changes:
  - action names must be explicit, for example `package.manifest.update`
  - approval target must include changed permission, runtime, and file
    association evidence
- Execute endpoints must reject legacy `approval.approved === true` and any
  approval object without `operationId`, `nonce`, and current `targetHash`.

Implementation order:

1. Build shared package lifecycle target evidence helpers in
   `server/routes/packages.js` or a small package-local helper.
2. Add approval creation to install/import/rollback preflight responses.
3. Add approve endpoints when a route does not already have one, using the same
   `operationApprovalService.approveOperation()` contract as package delete.
4. In execute routes, recompute target evidence, compare target hash, consume
   approval once, then run the lifecycle action.
5. Add audit records for preflight, approval, rejection, execution success, and
   execution failure.
6. Update Package Center API helpers and UI to pass approval evidence through
   install/import/rollback actions.
7. Add focused lifecycle approval tests before running full verification.

Minimum DoD:

- Registry install/update, ZIP import/update, rollback, and manifest/runtime
  scope changes reject execution without valid backend approval evidence.
- Preflight responses include action, target, impact, recoverability,
  lifecycle safeguards, typed confirmation when needed, `operationId`,
  `targetHash`, and `expiresAt`.
- Execute routes re-read the current package/runtime state, recompute
  `targetHash`, and reject stale approval with a structured error and fresh
  preflight evidence where practical.
- Approval nonce is consumed once and cannot be replayed.
- Package Center no longer depends on native browser confirmation for package
  install/update/rollback/delete approval.

Focused verification:

```bash
node --check server/services/operationApprovalService.js
node --check server/services/auditService.js
node --check server/routes/packages.js
node --test --test-concurrency=1 server/tests/package-delete-approval-contract.test.js
node --test --test-concurrency=1 server/tests/package-lifecycle-approval-contract.test.js
npm --prefix client run build
```

### HSR-C2 Terminal Approval Completion

Layer(s):

- Host
- Remote Computer UX
- Docs / Verification

Problem:

- `server/services/terminal.js` currently starts a PTY session after normal
  socket auth only.
- `terminal:input` writes directly to the PTY once the session exists.
- `terminal:approval` records frontend risky-command decisions in audit, but the
  backend does not enforce an approval nonce before session start or Web OS
  command injection.

Files to inspect first:

- Backend:
  - `server/services/terminal.js`
  - `server/services/operationApprovalService.js`
  - `server/services/auditService.js`
- Frontend:
  - `client/src/apps/system/terminal/Terminal.svelte`
  - `client/src/core/components/Agent.svelte`
- Tests:
  - add `server/tests/terminal-approval-contract.test.js` if the service can be
    tested without a live PTY

Contract/API target:

- Interactive Terminal is an approved raw admin shell.
- Backend must require a `terminal.session` approval before spawning a PTY.
- Prefer a socket-native contract because Terminal is socket-owned:
  - `terminal:session-preflight` creates operation `terminal.session`
  - `terminal:session-approve` approves the operation and returns a nonce
  - `terminal:init` requires `{ approval: { operationId, nonce, targetHash } }`
    and consumes it before `pty.spawn()`
  - `terminal:input` must reject input unless the socket has a consumed approved
    session context
- HTTP wrappers are allowed only if they reduce test complexity; they must still
  use `operationApprovalService`.
- Do not rely on parsing arbitrary shell lines as a hard safety boundary.
- Web OS-owned command injection paths, including Agent quick actions, saved
  commands, package scripts, and any future non-interactive terminal execution,
  require per-command approval with action `terminal.command`.
- Remove or downgrade the current frontend `terminal:approval` risky-command
  audit flow because it is not an enforcement contract.

Minimum DoD:

- PTY session start is blocked without a valid backend approval nonce.
- Session approval is scoped to user, socket/session target, working directory,
  shell, client evidence, and a target hash.
- Approval is consumed once before PTY spawn.
- `terminal:input` cannot write before approved session initialization.
- Audit records session preflight, approval, start, input rejection, end, and
  disconnect kill.
- Web OS command injection paths do not run shell commands without
  `terminal.command` approval.

Focused verification:

```bash
node --check server/services/terminal.js
node --check server/services/operationApprovalService.js
node --test --test-concurrency=1 server/tests/terminal-approval-contract.test.js
npm --prefix client run build
```

### HSR-C3 Native Prompt Cleanup And Approval UI Completion

Layer(s):

- Remote Computer UX
- Home Server Operations
- Sandbox / Package
- Docs / Verification

Problem:

- Native `confirm()` / `prompt()` remains in system workflows after the first
  HSR pass.
- Browser-native prompts are not enough for risky operations and are awkward for
  repeated operational use.

Known remaining callers from the latest scan:

- `client/src/apps/system/docker-manager/DockerManager.svelte`
- `client/src/apps/system/package-center/PackageCenter.svelte`
- `client/src/apps/system/terminal/Terminal.svelte`
- `client/src/apps/system/settings/BackupJobManager.svelte`

Implementation order:

1. Use or extract a small in-app approval dialog pattern from File Station for
   operation summaries, typed confirmation, and submit/cancel state.
2. Wire Docker Manager remove/stop/restart UI to existing Docker backend
   preflight/approve/execute approval routes.
3. Wire Package Center install/update/import/rollback/delete UI to `HSR-C1`
   lifecycle approval helpers.
4. Replace package clone `prompt()` calls with an in-app form dialog. This is
   not necessarily a backend approval action, but it must not use native prompt.
5. Replace Terminal risky-command `confirm()` with the `HSR-C2` session approval
   UI and remove audit-only approval messaging.
6. Replace backup job delete `confirm()` with an in-app dialog; add backend
   approval only if the delete endpoint removes host data or backup evidence.
7. Run a final native prompt scan and document intentional exceptions, if any.

Minimum DoD:

- Targeted system apps have no user-facing native `confirm()` / `prompt()`.
- Risky operations use backend preflight/approve/execute and consume-once
  approval evidence.
- Non-risky text input flows use in-app forms.
- Dialogs show impact, target, recoverability, typed confirmation when required,
  and structured server errors.
- File Station's completed in-app dialog and Secure Folder disabled behavior
  remain intact.

Focused verification:

```bash
rg -n "globalThis\\.(confirm|prompt)|\\bconfirm\\(|\\bprompt\\(" client/src/apps/system
node --test --test-concurrency=1 server/tests/docker-service.test.js
node --test --test-concurrency=1 server/tests/package-delete-approval-contract.test.js
npm --prefix client run build
```

### HSR-C4 Dependency-free UI Smoke Gate

Layer(s):

- Web Desktop
- Remote Computer UX
- Docs / Verification

Problem:

- `npm run verify`, focused server tests, and frontend build are necessary but
  not enough for DSM-like readiness.
- `npm run verify:ui-smoke` must prove more than reachability without adding a
  browser-runner dependency.
- Readiness requires deterministic coverage for the frontend contracts most
  likely to regress: native prompt cleanup, approval state markers, recoverable
  login errors, transfer durable state, and sandbox timeout/ticket state.

Files to inspect first:

- `package.json`
- `client/package.json`
- `tools/ui-smoke-gate.js`
- `doc/operations/verification-gate-guide.md`
- `doc/operations/local-run-guide.md`
- `.github/workflows/verify.yml`
- Frontend workflows:
  - `client/src/core/Login.svelte`
  - `client/src/apps/system/file-explorer/FileExplorer.svelte`
  - `client/src/apps/system/package-center/PackageCenter.svelte`
  - `client/src/apps/system/transfer/TransferUI.svelte`
  - `client/src/core/components/SandboxAppFrame.svelte`

Implementation result:

- `tools/ui-smoke-gate.js` is dependency-free.
- It checks targeted native prompt cleanup, workflow source-contract markers,
  backend health, and frontend shell boot.
- Browser click-through automation remains a future hardening enhancement.
- Do not execute destructive actions against real user files during smoke. Use
  temporary allowed-root fixtures or assert preflight/approval blocking without
  execution.

Required smoke scenarios:

- Login succeeds and expired/invalid session shows a recoverable auth state.
- File Station opens and destructive file action reaches backend preflight
  without native prompt.
- Package Center opens and package lifecycle action reaches approval state
  without native prompt.
- Transfer UI shows durable cloud/local job state and an overwrite-required
  approval state without depending on tab lifetime.
- Sandbox app frame timeout/error state is visible and does not leak raw grant
  query URLs.

Minimum DoD:

- `npm run verify:ui-smoke` passes with local backend/frontend dev servers.
- `npm run verify` remains the deterministic code/build/test gate, and
  `verify:ui-smoke` is documented as a separate release smoke command because
  it requires running servers.
- CI/local docs explain prerequisites, ports, credentials, skipped checks, and
  cleanup.
- No smoke artifacts are written by the current dependency-free gate.

Focused verification:

```bash
npm run verify:ui-smoke
npm run verify
npm run verify:docker-config
```

### HSR-C5 Final Addon-only Gate Verification And Docs Sync

Layer(s):

- Docs / Verification
- Agent / Automation

Problem:

- After `HSR-C1` through `HSR-C4`, the repo needs one final integration pass
  before declaring addon-only/core-freeze readiness.
- Dirty runtime state and stale operations docs can make the completion claim
  unreliable.

Files to inspect first:

- `AGENTS.md`
- `doc/operations/home-server-readiness-review-2026-04-26.md`
- `doc/operations/runtime-stability-notes-2026-04-26.md`
- `doc/operations/verification-gate-guide.md`
- `doc/operations/local-run-guide.md`
- `README.md`
- `USER_README.md`
- `.gitignore`

Implementation order:

1. Run `git status --short` and classify dirty files as code, docs, tests,
   runtime state, or unrelated user changes.
2. Run the full verification set.
3. Scan for remaining native prompts and legacy approval shortcuts.
4. Confirm runtime/local files are ignored or intentionally tracked fixtures.
5. Update operations docs with code-verified behavior and remaining known
   risks, if any.
6. Update this `AGENTS.md` queue so completed items move out of active
   execution.
7. Report whether addon-only/core-freeze can be declared.

Minimum DoD:

- Full verification passes.
- Approval, sandbox, package lifecycle, terminal, transfer, share, and UI smoke
  tests pass.
- `rg` finds no active legacy approval shortcuts or native prompt blockers in
  targeted production paths.
- Operations docs match code-verified behavior.
- Remaining risks are either disabled states, documented owner-only beta limits,
  or new active backlog items.

Focused verification:

```bash
git status --short
rg -n "approval\\.approved|globalThis\\.(confirm|prompt)|\\bconfirm\\(|\\bprompt\\(|terminal:approval" server client/src
npm run verify
npm run verify:docker-config
npm run verify:ui-smoke
git diff --check
```

### Historical HSR Source Details

The sections below are not the active execution queue. They preserve the
original readiness-review scope for context only. Current status and execution
order are defined by `HSR-C1` through `HSR-C5` above.

### HSR-1 Risky Operation Approval Unification

Layer(s):

- Host
- Home Server Operations
- App Install / File Workflow
- Sandbox / Package
- Remote Computer UX

Problem:

- Some destructive/high-impact operations still run with normal auth only or
  frontend-only confirmation.
- Package delete and cloud overwrite are good examples, but file delete, empty
  trash, Docker actions, package install/update/rollback, and terminal actions
  need the same backend approval family.

Scope:

- Backend:
  - `server/services/operationApprovalService.js`
  - `server/services/auditService.js`
  - `server/routes/fs.js`
  - `server/services/trashService.js`
  - `server/routes/docker.js`
  - `server/services/dockerService.js`
  - `server/routes/packages.js`
  - `server/services/packageLifecycleService.js`
  - `server/services/terminal.js`
- Frontend:
  - `client/src/apps/system/file-explorer/FileExplorer.svelte`
  - `client/src/apps/system/file-explorer/api.js`
  - `client/src/apps/system/docker-manager/DockerManager.svelte`
  - `client/src/apps/system/docker-manager/api.js`
  - `client/src/apps/system/package-center/PackageCenter.svelte`
  - `client/src/apps/system/package-center/api.js`
  - `client/src/apps/system/terminal/Terminal.svelte`
  - `client/src/core/components/Agent.svelte`
- Tests:
  - `server/tests/package-delete-approval-contract.test.js`
  - `server/tests/docker-service.test.js`
  - add focused fs/package/terminal approval tests as needed

Recommended sub-slice order:

1. `HSR-1a` File delete, empty trash, and overwrite approval.
2. `HSR-1b` Docker stop/restart/remove approval.
3. `HSR-1c` Package install/update/rollback approval.
4. `HSR-1d` Terminal session approval and per-command approval for Web OS
   command injection paths.

Minimum DoD:

- Destructive/high-impact execute endpoints reject missing or invalid approval
  nonce.
- Preflight response includes target, impact, recoverability,
  typedConfirmation when needed, expiresAt, and operationId.
- Execute revalidates target hash/state and consumes approval once.
- Audit records preflight, approval, rejection, execution success, and execution
  failure.
- UI no longer relies on native `confirm()` / `prompt()` for these actions.

Focused verification:

```bash
node --check server/services/operationApprovalService.js
node --check server/services/auditService.js
node --check server/routes/fs.js
node --check server/routes/docker.js
node --check server/routes/packages.js
node --check server/services/terminal.js
node --test --test-concurrency=1 server/tests/package-delete-approval-contract.test.js
node --test --test-concurrency=1 server/tests/docker-service.test.js
npm --prefix client run build
```

### HSR-2 Sandbox Raw URL Cleanup

Layer(s):

- Host
- Sandbox / Package
- App Install / File Workflow

Problem:

- Sandbox raw file URLs include `grantId` query strings.
- Request logging redacts known keys, but copied URLs can act like scoped bearer
  links during grant lifetime.

Scope:

- Backend:
  - `server/routes/sandbox.js`
  - `server/static/webos-sandbox-sdk.js`
  - `server/services/fileGrantService.js`
  - `server/services/fileTicketService.js`
  - `server/utils/urlRedaction.js`
- Frontend/callers:
  - `client/src/core/components/SandboxAppFrame.svelte`
  - sandbox package callers under `server/storage/inventory/apps/`
  - addon file API callers if they use sandbox raw grants
- Tests:
  - `server/tests/file-grant-revoke.test.js`
  - `server/tests/sandbox-sdk-contract.test.js`
  - `server/tests/ticket-url-contract.test.js`

Minimum DoD:

- Raw file access no longer depends on long-lived `grantId` query URLs.
- If a URL is unavoidable, it is a short-lived authenticated raw ticket with
  purpose/scope binding.
- Grant scope and app ownership checks remain enforced.
- Sensitive URL material is redacted in request logs, job summaries, and UI
  errors.

Focused verification:

```bash
node --check server/routes/sandbox.js
node --check server/static/webos-sandbox-sdk.js
node --check server/services/fileGrantService.js
node --check server/services/fileTicketService.js
node --test --test-concurrency=1 server/tests/file-grant-revoke.test.js
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
node --test --test-concurrency=1 server/tests/ticket-url-contract.test.js
```

### HSR-3 File Station Trust Cleanup

Layer(s):

- App Install / File Workflow
- Remote Computer UX
- Addon Runtime/UI

Problem:

- File Station still has high-impact flows that rely on native browser prompts
  or mock security behavior.
- Addon save/overwrite paths must move toward backend approval, audit, and
  recoverability.

Scope:

- File Station:
  - `client/src/apps/system/file-explorer/FileExplorer.svelte`
  - `client/src/apps/system/file-explorer/api.js`
  - `client/src/apps/system/file-explorer/services/fileAssociations.js`
- Addon file callers:
  - `client/src/apps/addons/code-editor/services/fileApi.js`
  - `client/src/apps/addons/document-viewer/services/documentApi.js`
  - `client/src/apps/addons/media-player/api.js`
  - `client/src/apps/addons/model-viewer/services/modelFile.js`
- Backend:
  - `server/routes/fs.js`
  - `server/services/trashService.js`
  - `server/utils/pathPolicy.js`
- Tests:
  - `server/tests/security-boundary-contract.test.js`
  - add focused fs approval/overwrite tests as needed

Minimum DoD:

- High-impact File Station flows use application UI plus backend preflight and
  approval evidence.
- Mock Secure Folder password behavior is removed or clearly disabled as not
  implemented.
- Delete, overwrite, extract overwrite, and restore show impact and recovery
  evidence before execution.

Focused verification:

```bash
node --check server/routes/fs.js
node --check server/services/trashService.js
node --check server/utils/pathPolicy.js
node --test --test-concurrency=1 server/tests/security-boundary-contract.test.js
npm --prefix client run build
```

### HSR-4 Transfer And Backup Durability Close-out

Layer(s):

- Host
- Home Server Operations
- Remote Computer UX
- Docs / Verification

Problem:

- A-owned cloud transfer is strong, but Transfer UI overwrite approval and local
  transfer/backup hardening still need closure.
- Local transfer persistence should use atomic tmp-then-rename writes.
- Backup source/destination path validation must match current realpath-aware
  file and transfer policy.

Scope:

- Backend:
  - `server/services/cloudTransferJobService.js`
  - `server/services/cloudService.js`
  - `server/services/transferJobService.js`
  - `server/routes/cloud.js`
  - `server/routes/transfer.js`
  - `server/routes/system.js`
  - `server/utils/pathPolicy.js`
- Frontend:
  - `client/src/apps/system/transfer/TransferUI.svelte`
  - `client/src/apps/system/transfer/api.js`
  - `client/src/apps/system/transfer/normalization.js`
  - `client/src/apps/system/settings/BackupJobManager.svelte`
  - `client/src/apps/system/settings/CloudManager.svelte`
  - `client/src/apps/system/file-explorer/FileExplorer.svelte`
- Tests:
  - `server/tests/transfer-jobs.integration.test.js`
  - `server/tests/cloud-upload-validation.test.js`
  - `server/tests/client-transfer-sandbox-normalization.test.js`

Minimum DoD:

- Transfer UI can complete cloud overwrite-required flow through backend
  approval.
- Local transfer job store writes atomically through a sibling temp file and
  rename.
- Backup job source/destination path uses realpath/lstat-aware policy.
- Retry/cancel/prune remain explicit API operations.
- Browser tab close, route change, socket disconnect, or polling stop does not
  cancel server-owned jobs.

Focused verification:

```bash
node --check server/services/cloudTransferJobService.js
node --check server/services/cloudService.js
node --check server/services/transferJobService.js
node --check server/routes/cloud.js
node --check server/routes/transfer.js
node --check server/routes/system.js
node --test --test-concurrency=1 server/tests/cloud-upload-validation.test.js
node --test --test-concurrency=1 server/tests/transfer-jobs.integration.test.js
node --test --test-concurrency=1 server/tests/client-transfer-sandbox-normalization.test.js
npm --prefix client run build
```

### HSR-5 Runtime State Policy Cleanup

Layer(s):

- Docs / Verification
- Home Server Operations

Problem:

- `server/storage/shares.json` is runtime state but may still be trackable.
- Runtime/local state policy must be consistent across `.gitignore`, docs, and
  completion reports.

Scope:

- `.gitignore`
- `server/storage/shares.json`
- `server/services/shareService.js`
- `server/routes/share.js`
- `doc/operations/runtime-stability-notes-2026-04-26.md`
- `doc/operations/home-server-readiness-review-2026-04-26.md`
- `doc/README.md`

Minimum DoD:

- Concrete share runtime state is not committed.
- `server/storage/shares.json` is ignored or replaced with an explicit redacted
  fixture/schema/test fixture.
- Runtime/local file lists in AGENTS and operations docs match.

Runtime/local state caution:

- `server/storage/index.json`
- `server/storage/media-library/`
- `server/storage/cloud-transfer-jobs.json`
- `server/storage/transfer-jobs.json`
- `server/storage/shares.json`
- `server/storage/audit.log`
- `server/storage/.trash_info.json`
- `server/storage/inventory/system/*.corrupt-*.json`
- `storage/rehearsal-backups/`
- `storage/cloud_mock/`
- `config/rclone.conf`

Focused verification:

```bash
git status --short
node --check server/services/shareService.js
node --check server/routes/share.js
node --test --test-concurrency=1 server/tests/share-download-policy.test.js
```

### HSR-6 Frontend Real-use Smoke Gate

Layer(s):

- Web Desktop
- Remote Computer UX
- Docs / Verification

Problem:

- Server tests and frontend build are good, but DSM-like readiness needs
  frontend real-use smoke coverage for core workflows.
- Playwright is recommended in planning, but it is not a current dependency
  unless added intentionally.

Scope:

- `package.json`
- `client/package.json`
- `tools/`
- `.github/workflows/verify.yml`
- `doc/operations/verification-gate-guide.md`
- `doc/operations/local-run-guide.md`
- Frontend workflows:
  - `client/src/core/Login.svelte`
  - `client/src/apps/system/file-explorer/FileExplorer.svelte`
  - `client/src/apps/system/package-center/PackageCenter.svelte`
  - `client/src/apps/system/transfer/TransferUI.svelte`
  - `client/src/core/components/SandboxAppFrame.svelte`

Minimum DoD:

- Smoke coverage verifies source-contract markers for login recoverability, File
  Station destructive preflight, Package Center approval, Transfer durable job
  state, and sandbox app timeout/ticket state.
- Smoke gate is reproducible through `npm run verify` or a documented
  `npm run verify:ui-smoke`.
- CI/local docs explain prerequisites and skipped-check rules.

Focused verification:

```bash
npm run verify
npm run verify:docker-config
```

## 9) Ready-State Criteria Before Addon-only/Core-freeze

Addon-only/core-freeze is allowed when all checks are true:

- [x] `npm run verify` passes.
- [x] `npm run verify:docker-config` passes.
- [x] `npm run verify:ui-smoke` passes as the current dependency-free release
      smoke gate.
- [x] package doctor reports `fails=0`, `warns=0`, unless an exception is
      explicitly documented.
- [x] Frontend build passes.
- [x] Approval-focused server tests pass.
- [x] File delete, empty trash, overwrite, package install/update/rollback,
      Docker stop/restart/remove, terminal session/command injection all use
      backend approval contracts.
- [x] Sandbox raw file URLs no longer depend on long-lived `grantId` query
      strings.
- [x] File Station, Docker Manager, Package Center, Terminal, and backup job
      high-impact flows no longer rely on native browser prompts.
- [x] Transfer/backup durability hardening is complete.
- [x] Runtime state policy is reflected in git ignore rules and operations docs.
- [x] Operations docs match code-verified behavior.

Current operating mode:

- VPN/internal owner-only beta.
- No direct public internet exposure.
- Admin performs Docker/Terminal/File delete/Package lifecycle operations
  intentionally.
- Durable A-owned cloud/backup job paths are trusted over browser-lifecycle
  upload paths for long-running work.
- Runtime state files are local operations state and should not be committed.

## 10) Verification Commands

Fast orientation:

```bash
git status --short
```

Backend syntax examples:

```bash
node --check server/routes/fs.js
node --check server/routes/docker.js
node --check server/routes/packages.js
node --check server/routes/sandbox.js
node --check server/routes/cloud.js
node --check server/routes/transfer.js
node --check server/routes/share.js
node --check server/services/operationApprovalService.js
node --check server/services/cloudTransferJobService.js
node --check server/services/transferJobService.js
```

Server tests:

```bash
npm test
node --test --test-concurrency=1 server/tests/package-delete-approval-contract.test.js
node --test --test-concurrency=1 server/tests/ticket-url-contract.test.js
node --test --test-concurrency=1 server/tests/transfer-jobs.integration.test.js
node --test --test-concurrency=1 server/tests/cloud-upload-validation.test.js
node --test --test-concurrency=1 server/tests/share-download-policy.test.js
```

Frontend build:

```bash
npm --prefix client run build
```

Package checks:

```bash
npm run apps:registry:migrate -- --dry-run --fail-on-removal
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

Full verification:

```bash
npm run verify
npm run verify:docker-config
npm run verify:ui-smoke
```

Docker/hardened validation:

```bash
docker compose config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml config
```

HTTP smoke when local servers are running:

```bash
node -e "fetch('http://127.0.0.1:3000/health').then(r=>{console.log('backend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
node -e "fetch('http://127.0.0.1:5173').then(r=>{console.log('frontend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Verification choice:

- Run focused syntax/tests for narrow route/service/UI changes.
- Run `npm run verify` for shared contracts, package lifecycle, sandbox, file
  grants, transfer/cloud, approval, or release-gate changes.
- Run Docker config checks when deployment, env, compose, hardening, or proxy
  files change.
- Report skipped checks with a reason.

## 11) Worker Split Guidance

Use workers only when the user explicitly asks for parallel agents or
delegation.

If workers are used, split by disjoint ownership:

- Worker 1: server route/service/backend contract only.
- Worker 2: client UI/store/API helper only.
- Worker 3: tests/tools/CI/migration scripts only.
- Worker 4: docs/ops evidence only.
- Main agent: item selection, MVP, analysis, integration, conflict review,
  verification, final reporting.

Workers must not edit the same files in parallel. Workers must not revert
unrelated dirty changes.

## 12) Git Rules

- Worktree can be dirty; never revert unrelated changes.
- No destructive git operations unless explicitly requested.
- Do not rely on untracked runtime files for completion claims.
- Before commit/push, check:
  - `git status --short`
  - runtime files are not accidentally included
  - generated storage churn is intentional
- `AGENTS.md` is the canonical agent guide for this repository.

## 13) Reporting Contract

Completion report must include:

- selected item
- changed files
- behavior change
- security/UX contract change
- verification evidence
- skipped verification with reason
- remaining gaps/risks
- next recommended item

For code review requests:

- Findings come first.
- Include file/line references.
- Summaries are secondary.

## 14) Invocation Profile

Use this profile when the user invokes `AGENTS.md` for autonomous readiness
work.

Trigger phrases:

- "AGENTS.md 기준으로 실행"
- "현재 백로그 첫 항목부터 진행"
- "home-server readiness 진행"
- "HSR 진행"
- "addon-only gate 닫기"
- "worker 병렬 사용"

Command object:

```yaml
command_profile:
  id: autonomous_home_server_readiness_completion_loop_v2
  backlog_selection:
    default_start_priority:
      - HSR-C1-package-lifecycle-approval-completion
      - HSR-C2-terminal-approval-completion
      - HSR-C3-native-prompt-cleanup-and-approval-ui-completion
      - HSR-C4-browser-workflow-smoke-gate
      - HSR-C5-final-addon-only-gate-verification-and-docs-sync
    strategy: first_unfinished_in_order
    if_backlog_empty: ask_user_for_reassignment
  execution_scope:
    mode: one_item_at_a_time
    auto_start_next_item: false
  worker_policy:
    use_workers_only_if_user_requested: true
    default_parallel_workers: 2
    optional_parallel_workers: 4
    file_ownership_overlap_allowed: false
  main_codex_responsibility:
    - select_item
    - define_mvp
    - run_analysis
    - re_reference_docs
    - split_file_ownership_if_workers_requested
    - integrate_changes
    - review_conflicts
    - run_verification
    - summarize_result
  completion_gate:
    required_user_choice_after_each_item:
      - continue_recommended_next
      - choose_different_item
      - commit_changes
      - stop
```

Default execution:

- Start from `HSR-C1` unless the user names another item.
- Complete one item or one clearly bounded sub-slice, then report.
- Do not auto-chain without explicit user direction.
