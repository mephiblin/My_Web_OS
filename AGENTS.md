# AGENTS.md

Operational guide for coding agents working on My Web OS.

This file is the canonical execution contract for agents. It is rebuilt from the
active planning/reference/operations documents and should stay short enough to
guide daily work. Completed backlog narratives belong in
`doc/operations/completed-backlog-log.md`, not here.

Execution shape:

```text
scope -> MVP -> analysis -> document re-reference -> contract/API
-> service/helper/store -> minimal UI -> verification -> docs/reporting
```

## 1) Product Scope

My Web OS is a browser-based operations layer for a personally owned
PC/home server/homelab.

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

Current product direction:

- finish real-use hardening before new core feature expansion
- keep core desktop orchestration minimal and non-hardcoded
- make Package Center an operations/workshop surface, not only a storefront
- keep Git registry and ZIP import as first-class package onboarding paths
- prefer package/sandbox ownership for ordinary addons when install/update/remove
  behavior matters
- make long-running file, media, share, and backup workflows feel transparent to
  users while Web OS owns continuity, recovery, approval, audit, and failure state

## 2) Required Document Citations

Agents must use these operating quotes as constraints when selecting or
implementing work.

From `doc/planning/product-brief-home-server-remote-computer.md`:

> My Web OS는 개인이 소유한 PC, 홈서버, 홈랩 장비를 브라우저에서 원격으로 운영하기 위한 개인 단위 Home Server & Remote Computer 플랫폼이다.

> 파일 시스템, 터미널, Docker, 서비스 제어는 실제 장비에 영향을 준다.

Implication:

- Host operations are not mock UI work. Treat them as real operations on the
  user's machine.

From `doc/planning/project-identity-boundaries.md`:

> `Desktop.svelte`는 오케스트레이션만, 앱 로직은 앱/스토어/서비스로 분리

Implication:

- Do not put feature business logic into `client/src/core/Desktop.svelte` or
  `client/src/core/Window.svelte`.

From `doc/planning/app-install-file-workflow-direction.md`:

> File Station owns local file selection and path intent.
> Apps own focused workflows.
> Web OS owns permissions, approval, audit, lifecycle, and recovery.
> Package Center owns install/update/remove/runtime health.

> Risky writes, overwrite, delete, rollback, and command execution require approval.

Implication:

- File/app/package flows must preserve ownership boundaries.
- Risky actions require explicit approval/audit/recoverability.

From `doc/reference/package-ecosystem-guide.md`:

> Both paths should converge on the same package lifecycle model: manifest validation, install/update audit, backup before overwrite, rollback evidence, and Package Center visibility.

Implication:

- Registry install and ZIP import must not drift in lifecycle policy.

From `doc/planning/real-use-remediation-plan.md`:

> 외부 노출 또는 실제 홈서버 운영 전에는 아래 5개 축을 먼저 닫아야 한다.

The five axes are:

1. security boundary stabilization
2. risky operation approval contract
3. API error and UI state standardization
4. Spotlight launcher contract unification
5. verification gate and frontend regression coverage

From `doc/planning/implementation-priority-plan.md`:

> 코어(Web OS 시스템)는 `bugfix/security/perf`만 허용하는 feature-freeze 상태로 관리한다.

Implication:

- New user value should normally land in packages/addons.
- Core work should be remediation, security, reliability, performance, or
  platform contract work.

From `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`:

> This is the "transparent wings" standard: continuity should feel natural to the user, but the system must still keep security, audit, approval, and recovery visible where they matter.

> Do not make cloud/backup depend on a browser tab, media lease, or file ticket.

Implication:

- Users should not need to understand tickets, leases, Range, retries, rclone,
  quota, partial files, or backend restarts.
- Agents must keep preview ticket, media lease, share download, and durable
  cloud/backup job models separate.
- Automatic recovery should stay quiet when it succeeds, but quota pauses,
  risky writes, permission failures, and unrecoverable states must be explicit.

## 3) Canonical Sources And Precedence

Use this order when docs and code conflict:

1. Code-verified behavior for the currently running implementation.
2. `AGENTS.md`.
3. Product and roadmap:
   - `doc/planning/product-brief-home-server-remote-computer.md`
   - `doc/planning/project-identity-boundaries.md`
   - `doc/planning/roadmap-home-server-remote-computer.md`
   - `doc/planning/implementation-priority-plan.md`
4. Active remediation and workflow plans:
   - `doc/planning/real-use-remediation-plan.md`
   - `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`
   - `doc/planning/app-install-file-workflow-direction.md`
   - `doc/planning/feature-scope-priorities.md`
   - `doc/planning/feature-inventory-home-server-remote-computer.md`
5. Package/reference contracts:
   - `doc/reference/app-development-model.md`
   - `doc/reference/app-ownership-matrix.md`
   - `doc/reference/package-ecosystem-guide.md`
   - `doc/reference/community-registry-and-presets.md`
   - `doc/reference/architecture-api-reference.md`
6. Presets and code-backed package fixtures:
   - `doc/presets/webos-store.preset.json`
   - `doc/presets/package-manifest.preset.json`
   - `doc/presets/ecosystem-template-catalog.preset.json`
   - `server/presets/ecosystem-template-catalog.json`
   - `server/storage/inventory/system/apps.json`
7. Operations evidence:
   - `README.md`
   - `USER_README.md`
   - `doc/README.md`
   - `doc/operations/local-run-guide.md`
   - `doc/operations/remote-access-hardening-guide.md`
   - `doc/operations/runtime-stability-notes-2026-04-26.md`
   - `doc/operations/completed-backlog-log.md`

If docs and code conflict, implement to code-verified behavior first, then align
the relevant doc in the same work packet when practical.

## 4) Technology Stack And Sources

The source of truth for versions is local project metadata, not memory.

Backend/runtime:

- Node.js 20 on Debian bookworm slim.
  - Source: `docker/Dockerfile.backend`
  - Source: `docker/Dockerfile.frontend`
- Express `^5.2.1`.
  - Source: `package.json`
- Socket.io `^4.8.3`.
  - Source: `package.json`
- JWT authentication with `jsonwebtoken ^9.0.3`, password hashing with
  `bcryptjs ^3.0.3`.
  - Source: `package.json`
- Security/config middleware: `helmet ^8.1.0`, `cors ^2.8.6`,
  `express-rate-limit ^8.3.2`, `dotenv ^17.4.2`.
  - Source: `package.json`
- File/upload/archive services: `fs-extra ^11.3.4`, `multer ^2.1.1`,
  `adm-zip ^0.5.17`, `chokidar ^5.0.0`.
  - Source: `package.json`
- Host/system operations: `systeminformation ^5.31.5`,
  `node-pty ^1.1.0`, `fluent-ffmpeg ^2.1.3`.
  - Source: `package.json`
- Service composition and health checks through Docker Compose.
  - Source: `docker-compose.yml`
  - Source: `docker-compose.hardened.yml`
  - Source: `docker-compose.hardened-acme.yml`

Frontend:

- Svelte `^5.55.1` with `@sveltejs/vite-plugin-svelte ^7.0.0`.
  - Source: `client/package.json`
- Vite `^8.0.4`.
  - Source: `client/package.json`
  - Source: `client/vite.config.js`
- UI and visualization: `lucide-svelte ^1.0.1`, `chart.js ^4.5.1`,
  `svelte-chartjs ^4.0.1`, `canvas-confetti ^1.9.4`.
  - Source: `client/package.json`
- Editor/viewer/runtime libraries: `monaco-editor ^0.55.1`,
  `three ^0.184.0`, `xterm ^5.3.0`, `xterm-addon-fit ^0.8.0`.
  - Source: `client/package.json`
- Client API boundary:
  - `client/src/utils/api.js`
  - `client/src/utils/constants.js`

Package/runtime model:

- Package Center UI:
  - `client/src/apps/system/package-center/`
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

- Server tests use Node's built-in test runner with serial execution.
  - Source: `package.json` script `test:server`
- Frontend build uses Vite.
  - Source: `client/package.json` script `build`
- Package validation uses `package:doctor`.
  - Source: `package.json`
  - Source: `tools/package-doctor.js`
- Backup/restore and station rehearsal tools:
  - `tools/rehearse-storage-backup-restore.sh`
  - `tools/station-real-use-snapshot.js`
- Future UI smoke benchmark:
  - `doc/planning/real-use-remediation-plan.md`
  - Playwright is a recommended benchmark there, but is not a current dependency
    until added to `client/package.json` or the root package.

External benchmark sources are listed in
`doc/planning/real-use-remediation-plan.md` and
`doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`.
They include OWASP, RFC 9457, Express, Node.js fs docs, VS Code UX guidance,
GitHub Actions, Playwright, Testing Library, Synology File Station, CasaOS,
rclone, Google Drive, and MDN Range requests.

## 5) Layer Map

Classify every task into one or more layers before implementation:

- `Host`
- `Web Desktop`
- `Addon Runtime/UI`
- `App Install / File Workflow`
- `Sandbox / Package`
- `Home Server Operations`
- `Remote Computer UX`
- `Agent / Automation`
- `Docs / Verification`

Host:

- `server/routes/fs.js`
- `server/routes/system.js`
- `server/routes/settings.js`
- `server/routes/docker.js`
- `server/routes/logs.js`
- `server/routes/cloud.js`
- `server/routes/transfer.js`
- `server/routes/media.js`
- `server/services/*`
- `server/middleware/*`
- `server/utils/*`

Web Desktop:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
- `client/src/core/Spotlight.svelte`
- `client/src/core/appLaunchRegistry.js`
- `client/src/core/appOwnershipContract.js`
- `client/src/core/components/*`
- `client/src/core/stores/*`

Addon Runtime/UI:

- `client/src/apps/addons/code-editor/*`
- `client/src/apps/addons/document-viewer/*`
- `client/src/apps/addons/media-player/*`
- `client/src/apps/addons/model-viewer/*`
- `client/src/apps/addons/widget-store/*`

App Install / File Workflow:

- `client/src/apps/system/file-explorer/*`
- `client/src/apps/system/station/*`
- `client/src/apps/system/transfer/*`
- `server/services/fileGrantService.js`
- `server/services/fileTicketService.js`
- `server/services/cloudService.js`

Sandbox / Package:

- `client/src/apps/system/package-center/*`
- `server/routes/packages.js`
- `server/routes/runtime.js`
- `server/routes/sandbox.js`
- `server/services/packageRegistryService.js`
- `server/services/packageLifecycleService.js`
- `server/services/runtimeManager.js`
- `server/services/templateCatalogService.js`
- `server/storage/inventory/`
- `server/presets/`
- `tools/package-doctor.js`
- `tools/migrate-apps-registry.js`

Docs / Verification:

- `AGENTS.md`
- `README.md`
- `USER_README.md`
- `doc/**`
- `tools/**`
- `package.json`
- `client/package.json`
- `.github/workflows/**` when introduced

## 6) Operating Contract

1. Classify the task by layer.
2. Select the smallest useful MVP slice.
3. Inspect existing routes/services/stores/components/helpers before adding new files.
4. Re-read the relevant canonical docs immediately before implementation.
5. Implement in this order:
   - contract/API
   - service/helper/store
   - minimal UI
   - verification
   - docs/reporting
6. Boundary-first policy:
   - explicit error response with `code` and `message`
   - backend validation for path/appId/manifest/runtime/grant scope
   - approval/audit/recoverability for risky operations
   - log redaction for secrets/tokens/grants
   - realpath/lstat-aware path policy where host files are involved
7. Keep `Desktop.svelte` and `Window.svelte` orchestration-only.
8. Treat Package Center as operations/workshop.
9. Never silently execute risky actions:
   - delete
   - overwrite
   - rollback
   - install/update/remove
   - command execution
   - Docker restart/stop/remove
   - empty trash
10. Run the smallest useful verification set and report what was skipped.
11. Never revert unrelated dirty changes.
12. Continue through integration, verification, and documentation when feasible.
13. Stop early only for explicit user pause/stop, unsafe ambiguity, blocked
    external dependency, or required human testing.

## 7) MVP -> Analysis -> Doc Re-Reference -> Development Pipeline

Use this pipeline for every non-trivial change.

### 7.1 MVP

Goal:

- Define the smallest end-to-end slice that proves the contract.

Required output before coding:

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
- MVP must not hide incomplete risky behavior behind UI polish.
- MVP must preserve existing code-verified behavior unless the task explicitly
  changes it.

### 7.2 Analysis

Inspect before editing:

- current route/API contract
- current service/helper/store ownership
- current UI caller
- tests covering the behavior
- generated/runtime files that must not be committed
- security boundary and approval/audit implications

Analysis checklist:

- Does the change touch Host files, Docker, terminal, package install/update,
  rollback, or destructive operations?
- Does the change need structured `code/message/details` errors?
- Does it affect sandbox grants or file associations?
- Does it belong in a shared helper/store instead of Desktop/Window?
- Can existing tests be extended instead of adding a broad new harness?

### 7.3 Document Re-Reference

Before editing code, re-open the relevant docs:

- security/real-use work:
  - `doc/planning/real-use-remediation-plan.md`
  - `doc/planning/project-identity-boundaries.md`
  - `doc/operations/remote-access-hardening-guide.md`
- package/install work:
  - `doc/planning/app-install-file-workflow-direction.md`
  - `doc/reference/package-ecosystem-guide.md`
  - `doc/reference/app-development-model.md`
- desktop/launcher work:
  - `doc/planning/project-identity-boundaries.md`
  - `doc/planning/real-use-remediation-plan.md`
  - `doc/reference/app-ownership-matrix.md`
- verification/tooling work:
  - `doc/planning/real-use-remediation-plan.md`
  - `doc/operations/runtime-stability-notes-2026-04-26.md`
  - `doc/operations/local-run-guide.md`
- large-file/media/share/cloud continuity work:
  - `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`
  - `doc/planning/app-install-file-workflow-direction.md`
  - `doc/planning/real-use-remediation-plan.md`

If docs are stale:

- implement to code-verified behavior first
- update the relevant doc in the same work packet when practical
- report any skipped doc sync explicitly

### 7.4 Development

Implementation sequence:

1. Define or adjust API/contract shape.
2. Implement service/helper/store logic.
3. Add or update backend validation and structured errors.
4. Add minimal UI only after boundary behavior is explicit.
5. Add or update focused tests.
6. Run targeted verification.
7. Run broader verification if blast radius is high.
8. Update docs and report.

Do not:

- add broad abstractions before the MVP proves the repeated need
- add route-level hardcoding for package/addon-specific behavior
- add UI-only confirmation for operations that require server-side approval
- treat a build pass as UX verification when the change affects user workflows

### 7.5 LFC Execution Playbook

Use this playbook for `LFC-*` work. It is intentionally detailed so an agent can
start from `AGENTS.md` alone, then re-open cited source files before editing.

#### LFC source pack

Re-open these files before selecting or implementing an `LFC-*` item:

- `AGENTS.md`
- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`
- `doc/planning/product-brief-home-server-remote-computer.md`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/planning/real-use-remediation-plan.md`
- `doc/planning/implementation-priority-plan.md`
- `doc/reference/architecture-api-reference.md`
- `doc/operations/runtime-stability-notes-2026-04-26.md`

Non-negotiable LFC constraints:

- `preview ticket`, `media lease`, `share download`, and `durable cloud/backup
  job` are separate models.
- Do not stretch preview tickets into streaming or backup continuity.
- Do not make cloud/backup depend on browser tabs, media leases, or file
  tickets.
- Normal auth is `Authorization: Bearer <token>`, not query JWT.
- Browser file URLs may use only opaque, scoped, purpose-bound ticket/lease
  tokens.
- Redact `token`, `grantId`, `ticket`, `code`, `secret`, `password`, and
  `authorization` in logs.
- Verify Range behavior with `206 Partial Content` and `Content-Range`.
- Risky overwrite/delete/rollback/command/install/update/remove still requires
  approval, audit, and recoverability.

#### LFC project structure map

Ticket/lease backend:

- `server/services/fileTicketService.js`
- `server/routes/fs.js`
- `server/routes/media.js`
- `server/tests/ticket-url-contract.test.js`

Media/document recovery frontend:

- `client/src/utils/api.js`
- `client/src/apps/addons/media-player/MediaPlayer.svelte`
- `client/src/apps/addons/media-player/api.js`
- `client/src/apps/addons/document-viewer/components/DocumentViewerApp.svelte`
- `client/src/apps/addons/document-viewer/services/documentApi.js`
- `client/src/core/components/FilePicker.svelte`

Share download:

- `server/routes/share.js`
- `server/services/shareService.js`
- `server/services/auditService.js`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`

Transfer jobs:

- `server/routes/transfer.js`
- `server/services/transferJobService.js`
- `server/tests/transfer-jobs.integration.test.js`
- `client/src/apps/system/transfer/api.js`
- `client/src/apps/system/transfer/normalization.js`
- `client/src/apps/system/transfer/TransferUI.svelte`
- `client/src/apps/system/download-station/DownloadStation.svelte`

Cloud/rclone:

- `server/routes/cloud.js`
- `server/services/cloudService.js`
- `server/tests/cloud-upload-validation.test.js`
- `client/src/apps/system/settings/CloudManager.svelte`
- `client/src/apps/system/settings/api.js`
- `client/src/apps/system/transfer/TransferUI.svelte`

#### LFC execution flow

```text
git status
-> choose first unfinished LFC item
-> declare layers
-> fill MVP template
-> read LFC source pack
-> inspect Files to inspect first
-> map current API/service/UI/test behavior
-> define contract/API
-> implement service/helper/store
-> add route validation, structured errors, audit/redaction
-> implement minimal UI only after backend contract is explicit
-> extend focused tests before broad harnesses
-> run LFC-focused verification
-> run broader verification if blast radius is high
-> sync docs when code-verified behavior changes
-> completion report
```

Detailed execution rules:

1. Run `git status --short` and identify unrelated dirty/untracked files. Do
   not revert them.
2. Select the first unfinished item from `LFC-1` to `LFC-5` unless the user
   assigns a different item.
3. Print the MVP block from section `7.1` before coding.
4. Inspect the item's source files before editing. Prefer `rg`, `sed`, and
   focused reads over broad file dumps.
5. Re-open the LFC source pack. Do not rely on memory for TTL, state, or
   deferred-decision values.
6. Define API/contract shape first:
   - request fields
   - response fields
   - structured `code/message/details`
   - status transitions
   - audit evidence
   - retry/recovery behavior
7. Implement server-side boundary behavior before client polish.
8. Add or extend tests close to the touched contract.
9. Only then add frontend helper/UI recovery.
10. Keep automatic recovery quiet when it succeeds.
11. Show explicit UI state when user/operator action is required:
    - risky write/overwrite/delete/rollback
    - quota/backoff pause
    - missing rclone/provider setup
    - permission or authentication failure
    - unrecoverable file mutation
    - destination conflict
12. Run focused verification first.
13. Run `npm test`, `cd client && npm run build`, package doctor, or Docker
    validation when the blast radius reaches shared contracts, frontend
    workflows, packages, or deployment.
14. If docs and code diverge, update docs in the same work packet when
    practical.
15. Report changed files, behavior, security/UX contract, verification, skipped
    checks, remaining gaps/risks, and next recommended `LFC-*` item.

#### LFC implementation defaults

- Preview ticket:
  - `profile=preview`
  - TTL 5 minutes default, 10 minutes max
  - memory-only
  - reacquirable
- Media lease:
  - `profile=media`
  - idle timeout 45 minutes
  - absolute max TTL 8 hours
  - memory-only in first implementation
  - `createdAt`, `lastAccess`, `absoluteExpiresAt`, `size`, `mtime`
  - `size + mtime` target mutation check
  - frontend reacquire after expiry/restart
- Share download:
  - never reuse media lease
  - expiry checked at request start
  - already-started response may finish in first implementation
  - new request after expiry is rejected
  - directory share rejected until deliberate archive policy exists
- Durable job:
  - persistent JSON job store first
  - sqlite may replace JSON later
  - `running -> interrupted` after backend restart unless explicitly reconciled
    with a live child process
  - cancel terminates child process/process group
  - finished jobs require intentional prune policy
- rclone/provider policy:
  - Google Drive `403/429/quota` maps to `backoff` or `paused_by_quota`
  - WebDAV timeout/rate-like errors map to retryable/backoff where practical
  - job record keeps provider, configured flags, exit code, stderr summary, and
    next retry time where available

#### Deferred LFC decisions

Do not block `LFC-1` or `LFC-2` on these:

- 24-hour trusted LAN media lease.
- Persistent media leases across backend restart.
- inode/hash mutation check beyond `size + mtime`.
- Full public-share password/count/rate UI policy.
- Backend proxy versus local-only semantics for `rclone serve webdav`.
- Unified database for package backup, cloud backup, and transfer jobs.
- sqlite replacing JSON for durable job storage.
- Full rclone VFS cache lifecycle for mount-like workflows.

#### LFC runtime/generated file caution

Do not rely on generated runtime files for completion claims. Treat these as
runtime/local unless explicitly promoted:

- `server/storage/index.json`
- `server/storage/media-library/`
- `server/storage/shares.json`
- `server/storage/audit.log`
- `server/storage/.trash_info.json`
- `server/storage/inventory/system/*.corrupt-*.json`
- `storage/rehearsal-backups/`
- `storage/cloud_mock/`
- `config/rclone.conf`

If an `LFC-*` durable job store creates new runtime files, document the path and
decide whether it is runtime state or a trackable fixture before reporting
completion.

## 8) Active Backlog

Status:

- Completed backlog details belong in `doc/operations/completed-backlog-log.md`.
- The active work queue is now the large-file continuity and cloud transfer
  plan from `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`.
- Product target: transparent wings. Users should open, stream, share, and back
  up files naturally while Web OS handles leases, retries, resume, checkpoints,
  quota/backoff, approval, audit, and recovery.

Active remediation item order:

- `LFC-1` Raw Ticket And Media Lease Contract
- `LFC-2` Frontend Media Lease Recovery
- `LFC-3` Share Download Policy
- `LFC-4` Durable Transfer Job Store
- `LFC-5` rclone Provider Policy

### LFC-1 Raw Ticket And Media Lease Contract

Source:

- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`

Layer(s):

- `Host`
- `Remote Computer UX`
- `App Install / File Workflow`

Problem:

- short preview tickets are being asked to cover large/long media behavior
- media playback and large document/object viewing need Range-compatible lease
  continuity without turning raw file URLs into broad user sessions
- backend restart and lease expiry must recover transparently where possible

Files to inspect first:

- `server/services/fileTicketService.js`
- `server/routes/fs.js`
- `server/tests/ticket-url-contract.test.js`
- `client/src/apps/addons/media-player/MediaPlayer.svelte`
- `client/src/apps/addons/document-viewer/components/DocumentViewerApp.svelte`

Minimum DoD:

- `profile=preview|media` or equivalent purpose exists
- preview ticket keeps 5 minute default / 10 minute max short TTL semantics
- media lease supports idle 45 minutes and absolute 8 hours by default
- media lease stores `createdAt`, `lastAccess`, `absoluteExpiresAt`, `size`,
  and `mtime`
- successful Range/full request updates `lastAccess`
- changed `size + mtime` invalidates the lease with a clear structured error
- tests cover Range, expiry, idle timeout, target mutation, scope mismatch, and
  log redaction

Implementation sequence:

1. Inspect current `/api/fs/raw-ticket` and `/api/fs/raw?ticket=...` behavior.
2. Extend `fileTicketService` from short-ticket-only records to purpose-aware
   records while keeping preview defaults unchanged.
3. Add media lease fields and validation:
   - `profile`
   - `createdAt`
   - `lastAccess`
   - `absoluteExpiresAt`
   - `size`
   - `mtime`
4. Make raw file redemption update `lastAccess` for media leases only.
5. Keep preview tickets short and memory-only.
6. Add structured media lease errors before frontend work:
   - `FS_MEDIA_LEASE_INVALID`
   - `FS_MEDIA_LEASE_EXPIRED`
   - `FS_MEDIA_LEASE_IDLE_TIMEOUT`
   - `FS_MEDIA_LEASE_TARGET_CHANGED`
7. Extend `ticket-url-contract` tests for Range, expiry, idle timeout, target
   mutation, scope/app mismatch, and redaction.

Focused verification:

```bash
node --check server/services/fileTicketService.js
node --check server/routes/fs.js
npm test -- server/tests/ticket-url-contract.test.js
```

### LFC-2 Frontend Media Lease Recovery

Source:

- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`

Layer(s):

- `Web Desktop`
- `Addon Runtime/UI`
- `Remote Computer UX`

Problem:

- users should not see or manage lease expiry, backend restart, or raw media URL
  refresh
- automatic recovery should be quiet when it succeeds and explicit only when
  action is required

Files to inspect first:

- `client/src/utils/api.js`
- `client/src/apps/addons/media-player/MediaPlayer.svelte`
- `client/src/apps/addons/document-viewer/components/DocumentViewerApp.svelte`
- `client/src/core/components/FilePicker.svelte`
- `server/routes/fs.js`

Minimum DoD:

- media element error can request a fresh lease
- video/audio restores `currentTime` when possible
- PDF/image preview retries once with a fresh lease
- expired lease is distinguishable from path-not-found and target-changed
- UI stays quiet on successful automatic recovery
- unrecoverable states show structured, user-actionable errors

Implementation sequence:

1. Inspect current `fetchRawFileTicketUrl` and media/document open flows.
2. Add a helper path for requesting media leases without breaking preview ticket
   callers.
3. In Media Player, reacquire once on media element error caused by expired or
   restarted lease.
4. Preserve and restore `currentTime` for video/audio when possible.
5. Add one quiet retry for image/PDF/object preview where browser events allow
   it.
6. Do not show a toast or error when automatic recovery succeeds.
7. Show explicit UI only for target-changed, path-not-found, permission, or
   unrecoverable recovery failure.

Focused verification:

```bash
cd client
npm run build
```

### LFC-3 Share Download Policy

Source:

- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`

Layer(s):

- `Home Server Operations`
- `Remote Computer UX`
- `Docs / Verification`

Problem:

- public/guest share download must support large-file resume without reusing
  media leases or broad Host authority
- share expiry, audit, path revalidation, directory behavior, and optional
  password/count/rate policy must be explicit

Files to inspect first:

- `server/routes/fs.js`
- `server/routes/share.js`
- `server/services/shareService.js`
- `server/services/auditService.js`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`

Minimum DoD:

- share download supports Range/resume
- share expiry is checked at request start
- already-started response may finish after expiry in the first implementation
- new request after expiry is rejected clearly
- share download does not reuse media lease
- directory share is rejected until deliberate archive/package policy exists
- audit records share id, path, ip/user-agent, and result
- password/count/rate policy fields are represented or explicitly blocked before
  external exposure

Implementation sequence:

1. Inspect current public `GET /api/share/download/:id` behavior.
2. Keep share download independent from media lease.
3. Define request-start expiry semantics in route code and tests.
4. Replace or wrap `res.download()` only as needed to guarantee Range/resume and
   structured errors.
5. Revalidate target path at request start.
6. Reject directory shares until archive/package behavior is deliberately
   implemented.
7. Write audit evidence for success and failure:
   - share id
   - path
   - ip
   - user-agent
   - result
8. Represent or explicitly block password/count/rate policy before any external
   exposure.

Focused verification:

```bash
node --check server/routes/share.js
node --check server/services/shareService.js
npm test
```

### LFC-4 Durable Transfer Job Store

Source:

- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`

Layer(s):

- `Home Server Operations`
- `Docs / Verification`

Problem:

- cloud/backup/transfer work must not depend on a browser tab, media lease, or
  file ticket
- memory-only transfer/cloud jobs disappear across backend restart
- partial destination and retry behavior must be recoverable and explicit

Files to inspect first:

- `server/routes/transfer.js`
- `server/services/transferJobService.js`
- `server/routes/cloud.js`
- `server/services/cloudService.js`
- `server/tests/transfer-jobs.integration.test.js`
- `server/tests/cloud-upload-validation.test.js`
- `client/src/apps/system/transfer/TransferUI.svelte`
- `client/src/apps/system/download-station/DownloadStation.svelte`

Minimum DoD:

- job state survives backend restart
- `running` jobs recover as `interrupted` unless explicitly reconciled with a
  live child process
- interrupted jobs are visible and retryable
- browser tab closure does not cancel server-side work
- cancel terminates running child process/process group
- partial destination policy is explicit
- finished jobs can be pruned intentionally

Implementation sequence:

1. Inspect current transfer and cloud job `Map` state.
2. Define persistent job record shape before writing storage logic.
3. Start with a JSON job store unless a concrete code reason requires another
   store.
4. On backend startup, load jobs and convert stale `running` jobs to
   `interrupted` unless reconciled with a live child process.
5. Keep browser tab closure separate from server-side cancellation.
6. Make retry of `interrupted` and retryable failure explicit.
7. Make partial destination policy explicit before retry behavior:
   - temp/partial destination
   - cleanup or resume behavior
   - finalization rules
8. Add intentional prune behavior for finished jobs.

Focused verification:

```bash
node --check server/services/transferJobService.js
node --check server/routes/transfer.js
npm test -- server/tests/transfer-jobs.integration.test.js
```

### LFC-5 rclone Provider Policy

Source:

- `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`

Layer(s):

- `Home Server Operations`
- `Remote Computer UX`
- `Docs / Verification`

Problem:

- Google Drive/WebDAV/S3/rclone failures should not collapse into generic
  failure strings
- provider quota/backoff must become visible operational state without exposing
  rclone internals to ordinary users

Files to inspect first:

- `server/services/cloudService.js`
- `server/routes/cloud.js`
- `server/services/transferJobService.js`
- `client/src/apps/system/settings/CloudManager.svelte`
- `client/src/apps/system/transfer/TransferUI.svelte`
- `server/tests/cloud-upload-validation.test.js`

Minimum DoD:

- Google Drive 403/429/quota-like errors map to `backoff` or `paused_by_quota`
- WebDAV timeout/rate-like errors map to retryable/backoff state where practical
- rclone retry and low-level retry settings are explicit
- job records include provider, configured flags, exit code, stderr summary, and
  next retry time where available
- VFS cache directory/max-size/max-age are configurable before exposing
  mount-like remote UX
- UI explains paused/backoff/quota states without requiring users to understand
  rclone internals

Implementation sequence:

1. Inspect current rclone command spawning, error mapping, and upload job status.
2. Define provider-aware error mapping before UI changes.
3. Preserve rclone evidence in job records:
   - provider
   - configured flags
   - exit code
   - stderr summary
   - next retry time
4. Map Google Drive quota/rate-like failures to `backoff` or
   `paused_by_quota`.
5. Map WebDAV timeout/rate-like failures to retryable/backoff where practical.
6. Keep missing rclone/provider setup as a clear setup error.
7. Do not expose `rclone serve webdav` `127.0.0.1` URLs as remote browser UX
   without backend proxy or explicit local-only semantics.
8. Add UI wording for quota/backoff states without requiring users to understand
   rclone internals.

Focused verification:

```bash
node --check server/services/cloudService.js
node --check server/routes/cloud.js
npm test -- server/tests/cloud-upload-validation.test.js
```

## 9) Ready-State Criteria Before Real Use

1. `npm test` passes.
2. `cd client && npm run build` passes.
3. Backend syntax checks pass for touched files.
4. `npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json`
   has `fails=0` and `warns=0` unless an exception is explicitly documented.
5. Docker compose profile validates and has documented smoke evidence.
6. Core flows are verified:
   - file
   - terminal
   - Docker
   - package
   - backup
   - cloud
   - transfer
   - sandbox
   - launch
7. Security boundary remediation is complete:
   - no broad unauthenticated inventory static route
   - no normal query token auth
   - sensitive query logging redacted
   - symlink-aware path policy
8. Risky operations are approval/audit/recovery-aware.
9. `apiFetch` and core UI states preserve structured errors.
10. Spotlight uses the same app/file association contracts as the rest of the desktop.
11. Package Center exposes install/update/remove/backup/rollback and data-boundary state.
12. Addon install path supports:
   - Git registry (`webos-store.json` + `zipUrl`)
   - ZIP import (`/api/packages/import`)
13. README + AGENTS + planning + reference docs are aligned.
14. Generated runtime/storage churn is intentionally handled.
15. Large-file continuity follows the transparent wings model:
   - preview ticket and media lease are separate
   - large open/stream paths are Range-compatible
   - media recovery reacquires leases automatically where practical
   - share download is separate from media lease
   - cloud/backup jobs survive browser tab closure and recover after backend
     restart as visible interrupted/retryable/quota/backoff states

Runtime state policy:

- `server/storage/index.json` is generated runtime state and must stay out of
  commits unless explicitly promoted.
- `server/storage/media-library/` is local generated runtime state.
- Inventory fixtures required for bootstrap/tests remain trackable under
  `server/storage/inventory/`.

## 10) Verification Commands

Backend syntax:

```bash
node --check server/routes/packages.js
node --check server/routes/fs.js
node --check server/routes/share.js
node --check server/routes/runtime.js
node --check server/routes/sandbox.js
node --check server/routes/docker.js
node --check server/routes/cloud.js
node --check server/routes/transfer.js
node --check server/services/packageLifecycleService.js
node --check server/services/packageRegistryService.js
node --check server/services/templateCatalogService.js
node --check server/services/fileGrantService.js
node --check server/services/fileTicketService.js
node --check server/services/shareService.js
node --check server/services/cloudService.js
node --check server/services/transferJobService.js
```

Server tests:

```bash
npm test
```

Frontend build:

```bash
cd client
npm run build
```

Registry/package checks:

```bash
npm run apps:registry:migrate
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

Large-file continuity checks:

```bash
npm test -- server/tests/ticket-url-contract.test.js
npm test -- server/tests/transfer-jobs.integration.test.js
npm test -- server/tests/cloud-upload-validation.test.js
```

Manual/HTTP continuity checks when a local server and suitable fixture are
available:

```bash
curl -H "Range: bytes=0-99" "<media-lease-url>" -i
curl -H "Range: bytes=0-99" "http://127.0.0.1:3000/api/share/download/<id>" -i
```

Expected:

- `206 Partial Content`
- `Content-Range`
- structured error responses for expired/invalid/target-changed states
- audit evidence for share download attempts
- no leaked `ticket`, `grantId`, bearer token, password, secret, or
  authorization value in logs

Docker validation:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
docker compose down
```

HTTP smoke:

```bash
node -e "fetch('http://127.0.0.1:3000/health').then(r=>{console.log('backend',r.status);process.exit(r.status===200?0:1)}).catch(()=>process.exit(1))"
node -e "fetch('http://127.0.0.1:5173').then(r=>{console.log('frontend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Verification choice:

- Use focused syntax/build/test checks for narrow changes.
- Use the full relevant set for security boundary, package lifecycle, file
  grant, sandbox, Docker, or release-gate changes.
- Report skipped checks with a reason.

## 11) Worker Split Guidance

If workers are used, split by disjoint ownership:

- Worker 1: server route/service/backend contract only.
- Worker 2: client UI/store/api helper only.
- Worker 3: tools/tests/CI/migration scripts only.
- Worker 4: docs/ops evidence only.
- Main agent: item selection, file ownership split, integration, conflict
  review, verification, final reporting.

Workers must not edit the same files in parallel.

Preferred split for active remediation:

- `LFC-1`: Worker 1 for backend ticket/lease route/service contract; Worker 3
  for Range/expiry/target-mutation tests.
- `LFC-2`: Worker 2 for media/document viewer recovery UI and API helper
  handling; Worker 1 only if route error contracts need adjustment.
- `LFC-3`: Worker 1 for share route/service/audit contract; Worker 3 for
  share Range/expiry tests.
- `LFC-4`: Worker 1 for durable job store/service process handling; Worker 2
  for transfer/cloud UI state only after backend contract is explicit; Worker 3
  for restart/cancel/partial-destination tests.
- `LFC-5`: Worker 1 for rclone/provider error mapping; Worker 2 for
  quota/backoff UI states; Worker 4 for operations evidence if docs need sync.

## 12) Git Rules

- Worktree can be dirty; never revert unrelated changes.
- No destructive git operations unless explicitly requested.
- Do not rely on untracked runtime files for completion claims.
- Before commit/push, check:
  - `git status --short`
  - required runtime files/imports are present
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

For code review requests, findings come first and must include file/line
references.

## 14) Invocation Profile: Autonomous Continuity Remediation Loop

Use this profile when the user invokes `AGENTS.md` for autonomous work.

Trigger phrases:

- "AGENTS.md 기준으로 실행"
- "현재 백로그 첫 항목부터 진행"
- "large-file continuity 진행"
- "투명날개 작업 진행"
- "LFC 진행"
- "worker 병렬 사용"
- equivalent Korean/English phrasing with the same intent

Command object:

```yaml
command_profile:
  id: autonomous_large_file_continuity_loop_v1
  backlog_selection:
    default_start_priority:
      - LFC-1-raw-ticket-and-media-lease-contract
      - LFC-2-frontend-media-lease-recovery
      - LFC-3-share-download-policy
      - LFC-4-durable-transfer-job-store
      - LFC-5-rclone-provider-policy
    strategy: first_unfinished_in_order
    if_backlog_empty: ask_user_for_reassignment
  execution_scope:
    mode: user_selected
    default_mode: one_item_at_a_time
    supported_modes:
      - one_item_at_a_time
      - continuous_until_user_stop
    auto_start_next_item:
      one_item_at_a_time: false
      continuous_until_user_stop: true
  worker_policy:
    ask_worker_count_before_start: true
    default_parallel_workers: 2
    optional_parallel_workers: 4
    file_ownership_overlap_allowed: false
  main_codex_responsibility:
    - select_item
    - define_mvp
    - run_analysis
    - re_reference_docs
    - split_file_ownership
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

Mandatory questions before autonomous execution:

1. "백로그 시작 기준을 `LFC-1 Raw Ticket And Media Lease Contract`부터 진행할까요?"
2. "워커를 몇 명 사용할까요? (기본 2명, 필요 시 3~4명)"
3. "실행 게이트를 어떻게 할까요? (`1개 완료 후 멈춤` 또는 `사용자가 중단할 때까지 연속 진행`)"

Post-item policy:

- In `one_item_at_a_time` mode, do not auto-chain. Summarize changed files,
  behavior, verification, skipped checks, remaining risks, and ask for the next
  user choice.
- In `continuous_until_user_stop` mode, auto-chain to the next unfinished item
  and still provide a per-item summary.
