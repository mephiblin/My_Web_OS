# AGENTS.md

Operational guide for coding agents working on My Web OS.

This format follows the repository's canonical-document-first workflow:
scope -> contract -> sources -> boundaries -> verification -> reporting.

## 1) Product Scope

My Web OS is a browser-based operations layer for a personally owned PC/home server/homelab.

It is not:

- a kernel OS replacement
- an enterprise multi-tenant platform
- a public internet service by default

Core model:

```text
Home Server = files, media, backup, services, Docker, logs
Remote Computer = terminal, app launch, file editing, system state
Web OS = permissions, approval, audit, lifecycle, recovery
Package Center = install/create/run/update/backup/rollback
```

Current product direction in this document:

- prioritize addon lifecycle as installable packages
- keep core desktop orchestration minimal and non-hardcoded for addon growth
- support both Git registry and ZIP import installation paths

## 2) Operating Contract

1. Classify every task into one or more layers:
   - `Host`
   - `Web Desktop`
   - `App Install / File Workflow`
   - `Sandbox / Package`
   - `Home Server Operations`
   - `Remote Computer UX`
   - `Agent / Automation`
   - `Docs / Verification`
2. Reuse existing routes/services/stores/components/helpers before adding new files.
3. Implement in order:
   - `contract/API -> service/helper/store -> minimal UI -> verification -> docs`
4. Boundary-first policy (before UI polish):
   - explicit error response with `code` and `message`
   - approval/audit/recoverability for risky operations
   - backend validation for path/appId/manifest/runtime/grant scope
5. Keep `client/src/core/Desktop.svelte` and `client/src/core/Window.svelte` orchestration-only.
6. Treat Package Center as operations/workshop, not just storefront.
7. Never silently execute risky actions (delete/overwrite/rollback/install/remove/command execution).
8. Run the smallest useful verification set and report what was skipped.
9. Never revert unrelated dirty changes.
10. Reserved continuation command:
   - If coding work remains after an implementation step, do not stop at a midpoint.
   - Continue development through integration, verification, and documentation when feasible.
   - If parallel work can safely accelerate completion, summon workers and split ownership by disjoint files/modules.
   - Only stop early for explicit user pause/stop, unsafe ambiguity, blocked external dependency, or required human testing.

## 3) Canonical Sources

Primary planning docs:

- `doc/planning/product-brief-home-server-remote-computer.md`
- `doc/planning/feature-inventory-home-server-remote-computer.md`
- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/planning/implementation-priority-plan.md`

Addon/package reference docs (current focus):

- `doc/reference/app-development-model.md`
- `doc/reference/app-ownership-matrix.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/reference/community-registry-and-presets.md`
- `doc/presets/webos-store.preset.json`
- `doc/presets/package-manifest.preset.json`
- `doc/presets/ecosystem-template-catalog.preset.json`

Code-verified baseline for addon location/structure:

- `client/src/apps/addons/`
- `client/src/core/appLaunchRegistry.js`
- `client/src/core/appOwnershipContract.js`
- `server/storage/inventory/system/apps.json`
- `client/src/apps/system/package-center/`
- `server/routes/packages.js`
- `server/services/packageRegistryService.js`
- `server/services/packageLifecycleService.js`
- `server/services/templateCatalogService.js`
- `server/presets/ecosystem-template-catalog.json`

Operations docs:

- `README.md`
- `USER_README.md`
- `doc/README.md`
- `doc/operations/local-run-guide.md`
- `doc/operations/remote-access-hardening-guide.md`
- `doc/operations/completed-backlog-log.md`

Precedence:

1. Roadmap + Product Brief
2. Active planning/reference docs for addon/package direction
3. Code-verified behavior
4. Historical logs

If docs and code conflict, implement to code-verified behavior first, then align docs.

## 4) Layer Map

Host:

- `server/routes/fs.js`
- `server/routes/system.js`
- `server/routes/settings.js`
- `server/routes/docker.js`
- `server/routes/logs.js`
- `server/routes/cloud.js`
- `server/routes/transfer.js`
- `server/services/*`
- `server/middleware/*`
- `server/utils/*`

Web Desktop:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
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

## 5) Ready-State Criteria (Pre-Real-Use)

1. `npm test` passes.
2. `cd client && npm run build` passes.
3. Backend syntax checks pass for touched files.
4. Docker compose profile validates and has documented smoke evidence.
5. Core flows are verified (file/terminal/docker/package/backup/cloud/transfer/sandbox/launch).
6. Risky operations are approval/audit/recovery-aware.
7. Package Center exposes install/update/remove/backup/rollback and data-boundary state.
8. Addon install path supports:
   - Git registry (`webos-store.json` + `zipUrl`)
   - ZIP import (`/api/packages/import`)
9. README + AGENTS + planning + reference docs are aligned.
10. Generated runtime/storage churn is intentionally handled.

## 6) Backlog Status

Status: `B0 COMPLETE + B1 SOURCE LAYOUT COMPLETE + B2 FILE ASSOCIATION LIFECYCLE COMPLETE + B3 PRIMARY ADDON SANDBOX PACKAGE COMPLETE + RUNTIME STABILITY PASS COMPLETE` (working tree, 2026-04-26).

There is no next active backlog item assigned in this file after B3.
When new work is assigned, register the item here before implementation.

Current runtime stability baseline (2026-04-26):

- `server/storage/index.json` and `server/storage/media-library/` are local generated runtime state and must stay out of commits.
- Inventory fixtures required for bootstrap/tests remain trackable under `server/storage/inventory/`.
- `/api/system/overview` and `/api/system/network-ips` use cache/coalescing to avoid UI polling from delaying app loading.
- Sandbox package launch must not silently infinite-load; SDK ready retry and `SANDBOX_BRIDGE_READY_TIMEOUT` are the current contract.
- Backend restart terminates existing Terminal PTY/local shell sessions; reconnect/new Terminal starts a new shell.
- Latest stability evidence: `doc/operations/runtime-stability-notes-2026-04-26.md`.

### B0) Addon Packageization and Distribution (Completed Item)

Item ID:

- `B0-addon-packageization-distribution`

Title:

- Convert addon workflow from project-bundled convenience to installable lifecycle model (Git registry + ZIP)

Layer(s):

- `Web Desktop`
- `App Install / File Workflow`
- `Sandbox / Package`
- `Remote Computer UX`
- `Docs / Verification`

Problem:

- Current addon apps exist in separated folders and launch mappings, but many still behave as project-bundled component apps.
- User direction is package-manager-like install/remove/update behavior.
- Distribution and onboarding must be format/preset-driven, not route-level hardcoding.

In Scope:

1. Define addon package contract for installable lifecycle (manifest/runtime/permissions/data-boundary).
2. Unify install pathways:
   - registry install (`/api/packages/registry/preflight`, `/api/packages/registry/install`)
   - ZIP import (`/api/packages/import`)
3. Improve Package Center UX for addon operations:
   - quick install/update
   - explicit remove/update/rollback visibility
   - boundary and approval clarity
4. Define seed strategy for developer convenience:
   - project-bundled addon source may exist for development
   - runtime ownership should be package-lifecycle-first
5. Align docs/presets with code reality for addon publication:
   - `webos-store.json`
   - manifest preset
   - template/catalog preset

Out of Scope:

- Full migration of every legacy component app into sandbox runtime in one shot.
- Large redesigns unrelated to addon lifecycle.
- Non-addon feature expansion.

DoD:

1. Addon install/update/remove paths are explicit and auditable.
2. Git registry and ZIP import are both documented and validated as first-class onboarding paths.
3. Core desktop orchestration remains launcher-level only (no addon-specific business logic hardcoding).
4. At least the primary addon targets (`editor`, `doc-viewer`, `model-viewer`) have a concrete migration/ownership plan recorded.
5. No contradiction remains across AGENTS + planning + reference docs.

Execution Plan (B0 Work Packets):

1. `B0-1-contract`
   - finalize addon package contract, ownership, and boundary definitions.
2. `B0-2-backend`
   - ensure registry install and ZIP import parity in validation/audit/lifecycle behavior.
3. `B0-3-ui`
   - tighten Package Center addon lifecycle UX (install/update/remove/review).
4. `B0-4-migration`
   - define and apply migration path for bundled addon apps toward package-first operation.
5. `B0-5-tests-docs`
   - integration tests + docs sync + operator guide updates.

Verification (minimum):

- `npm test`
- `cd client && npm run build`
- `node --check server/routes/packages.js`
- `node --check server/routes/fs.js`
- `node --check server/services/packageLifecycleService.js`
- `node --check server/services/packageRegistryService.js`
- `node --check server/services/templateCatalogService.js`
- `node --check client/src/core/appLaunchRegistry.js`
- `node --check client/src/core/appOwnershipContract.js`
- `node --check client/src/apps/system/package-center/api.js`

Completion Snapshot (2026-04-25):

- ZIP package import now has a preflight endpoint with registry-style readiness evidence.
- ZIP import and registry install share review concepts for permissions, quality, dependencies, backup, lifecycle safeguards, onboarding, update policy, execution readiness, and local workspace bridge.
- Package Center exposes a direct ZIP import panel with review-before-import behavior.
- Documentation now treats Git registry and direct ZIP import as first-class package onboarding paths.
- Primary bundled addon targets (`editor`, `doc-viewer`, `model-viewer`) have a recorded migration/ownership plan in reference docs.

Residual risks after B0:

- Dev convenience bundling can leak into runtime hardcoding if not controlled.
- ZIP import and registry install can drift in policy behavior if future changes skip parity tests.
- Addon-by-addon migration to package-first/sandbox-first operation is planned, not fully executed for every bundled addon.
- `package:doctor` still reports existing built-in registry warnings for system-app file associations and station allowlist entries.

### B1) Primary Addon Package-First Source Layout (Completed Item)

Item ID:

- `B1-primary-addon-package-first-source-layout`

Scope:

- `editor`
- `doc-viewer`
- `model-viewer`

Completion Snapshot (2026-04-25):

- Each target addon keeps a launcher-compatible root wrapper:
  - `client/src/apps/addons/code-editor/CodeEditor.svelte`
  - `client/src/apps/addons/document-viewer/DocumentViewer.svelte`
  - `client/src/apps/addons/model-viewer/ModelViewer.svelte`
- Each target addon now owns separated folders:
  - `components/` for Svelte UI implementation
  - `services/` for API/helper/runtime logic
  - `package/` for package manifest and package entry placeholder
- Each target addon has a `package/manifest.json` that follows the package preset shape and can be checked with `package:doctor`.

Current boundary:

- This is source-layout/package-contract separation, not full sandbox runtime migration.
- The existing desktop launch path still uses built-in Svelte components for development compatibility.
- The next migration step is to replace package placeholders with real sandbox package entries and then move ownership from `standard/component` to `package/sandbox` when runtime parity is proven.

### B2) File Association Lifecycle Integration (Completed Item)

Item ID:

- `B2-file-association-lifecycle-integration`

Problem:

- Installed apps should feel native in File Station.
- Opening a file should use declared `fileAssociations`, including installed package apps.
- User default app choices should not leave stale links after package removal.

Completion Snapshot (2026-04-25):

- File Station file association resolution is split into a helper module:
  - `client/src/apps/system/file-explorer/services/fileAssociations.js`
- File Station now opens files using the full app metadata from `/api/system/apps`, preserving package `launch.mode=sandbox` contracts.
- File Station context menu supports:
  - `Open With <app>`
  - `Always Open .<ext> With <app>`
  - `Clear Default App for .<ext>`
- User extension defaults still persist through `contextMenu.openWithByExtension`.
- Package delete now clears stale `openWithByExtension` entries pointing to the removed package app.

Current boundary:

- This completes the native-feeling association/lifecycle bridge for installed apps.
- It does not yet convert built-in viewers themselves into sandbox packages.
- A package with the same id as a built-in app is still skipped by the desktop registry merge; replacement/override policy remains a future explicit decision.

### B3) Primary Addon Sandbox Package Runtime (Completed Item)

Item ID:

- `B3-primary-addon-sandbox-package-runtime`

Scope:

- `doc-viewer`
- `model-viewer`
- `editor`

Completion Snapshot (2026-04-25):

- Each target addon now has an executable sandbox package entry:
  - `client/src/apps/addons/document-viewer/package/index.html`
  - `client/src/apps/addons/model-viewer/package/index.html`
  - `client/src/apps/addons/code-editor/package/index.html`
- Runtime package copies are present under:
  - `server/storage/inventory/apps/doc-viewer/`
  - `server/storage/inventory/apps/model-viewer/`
  - `server/storage/inventory/apps/editor/`
- The desktop app registry now lets an installed package replace a `standard` built-in addon with the same app id.
- `/api/system/apps` resolves the three target apps as:
  - `appModel=package`
  - `source=inventory-package`
  - `runtime=sandbox`
  - `launch.mode=sandbox`
- Sandbox SDK now exposes `WebOS.files.rawUrl({ path, grantId })`.
- Sandbox backend now exposes grant-bound raw file streaming:
  - `GET /api/sandbox/:appId/file/raw?path=...&grantId=...`

Current boundary:

- `doc-viewer` supports sandbox PDF/image raw preview and text search/read.
- `editor` supports sandbox text read/write through file grants.
- `model-viewer` supports sandbox GLTF/GLB/FBX/OBJ rendering with package-local Three.js vendor files, OrbitControls, wireframe, axes, fit, screenshot, and inspection metrics.
- Built-in component source remains as development fallback/source reference, but registry launch now prefers the sandbox package where the inventory package exists.

### Legacy Cleanup Policy

- Completed historical backlog details are tracked in `doc/operations/completed-backlog-log.md`.
- AGENTS keeps only active execution contract and active backlog.
- Legacy completed item narratives should not be retained here unless they are active blockers.

## 7) Work Packet Template

Use this before implementation:

```text
Selected item:
Layer(s):
Problem:
In scope:
Out of scope:
Files to inspect first:
Planned API/contract changes:
Verification commands:
Rollback/safety notes:
```

Completion report must include:

- changed files
- behavior change
- verification evidence
- skipped verification with reason
- remaining gaps/risks
- next recommended item

## 8) Worker Split Guidance

If workers are used:

- Worker 1: server route/service/backend contract only (+ related server tests)
- Worker 2: client UI/store/api helper only (+ frontend build fixes)
- Worker 3 (optional): migration scripts/tests/docs updates only
- Worker 4 (optional): operations/docs evidence updates only
- Main agent: work selection, file ownership split, integration, conflict review, verification, docs

Workers must not edit the same files in parallel.

## 9) Verification Commands

Backend syntax:

```bash
node --check server/routes/packages.js
node --check server/routes/fs.js
node --check server/routes/runtime.js
node --check server/services/packageLifecycleService.js
node --check server/services/packageRegistryService.js
node --check server/services/templateCatalogService.js
node --check server/services/fileGrantService.js
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

## 10) Git Rules

- Worktree can be dirty; never revert unrelated changes.
- No destructive git operations unless explicitly requested.
- Do not rely on untracked runtime files for "complete" claims.
- Before commit/push, check:
  - `git status --short`
  - required runtime files/imports are present
  - generated storage churn is intentional (`server/storage/index.json`)
- `AGENTS.md` is the canonical agent guide for this repository.

## 11) Invocation Profile: Autonomous Addon Roadmap Loop

Use this profile when user invokes `AGENTS.md` for autonomous addon roadmap execution.

### 11.1 Trigger Phrases

- "AGENTS.md 기준으로 실행"
- "현재 백로그 첫 항목부터 진행"
- "worker 병렬 사용"
- equivalent Korean/English phrasing with same intent

### 11.2 Command Object (Embedded Prompt Contract)

```yaml
command_profile:
  id: autonomous_addon_roadmap_loop_v1
  backlog_selection:
    default_start_priority: [B0]
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
    worker_1_scope: server route/service/backend contract (+server tests)
    worker_2_scope: client UI/store/api helper (+frontend build fixes)
    worker_3_scope: migration/tests/docs
    worker_4_scope: docs/ops evidence only
  main_codex_responsibility:
    - select_item
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

### 11.3 Mandatory Questions Before Execution

When this profile is triggered, ask these in order:

1. "백로그 시작 기준을 `B0 우선`으로 진행할까요?"
2. "워커를 몇 명 사용할까요? (기본 2명, 필요 시 3~4명)"
3. "실행 게이트를 어떻게 할까요? (`1개 완료 후 멈춤` 또는 `사용자가 중단할 때까지 연속 진행`)"

### 11.4 Post-Item Policy

After finishing each backlog item:

- In `one_item_at_a_time` mode:
  - do not auto-chain.
  - summarize changed files + behavior + verification, then ask:
    - "다음 추천 작업을 계속할까요, 다른 작업으로 갈까요, 지금 커밋할까요, 여기서 중단할까요?"
- In `continuous_until_user_stop` mode:
  - auto-chain to the next unfinished backlog item in order.
  - still provide per-item summary (changed files + behavior + verification).
  - stop immediately when user requests stop/branch/commit or when backlog is exhausted.

### 11.5 Current Focus Bootstrap (Updated 2026-04-25)

- Default current items `B0-addon-packageization-distribution`, `B1-primary-addon-package-first-source-layout`, `B2-file-association-lifecycle-integration`, and `B3-primary-addon-sandbox-package-runtime` are complete in the working tree.
- If user intent is app-store-like addon install/remove/update after B0, assign the next item explicitly:
  - addon-by-addon package migration
  - sandbox-first runtime hardening
  - Package Center remove/update/rollback UX polish
- Keep "easy install UX" and "approval/audit boundary" as co-equal acceptance constraints.
