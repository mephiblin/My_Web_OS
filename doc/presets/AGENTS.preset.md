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
2. Read current code and reuse existing routes/services/stores/components/helpers.
3. Implement in order:
   - `contract/API -> service/helper/store -> minimal UI -> verification -> docs`
4. Prioritize boundaries before UI polish:
   - explicit error response with `code` and `message`
   - approval/audit/recoverability for risky operations
   - backend validation for path/appId/manifest/runtime/grant scope
5. Keep `client/src/core/Desktop.svelte` and `client/src/core/Window.svelte` orchestration-only.
6. Treat Package Center as operations/workshop, not just storefront.
7. Never silently execute risky actions (delete/overwrite/rollback/install/remove/command execution).
8. Run the smallest useful verification set and report what was skipped.
9. Never revert unrelated dirty changes.

## 3) Canonical Sources

Primary planning docs:

- `doc/planning/product-brief-home-server-remote-computer.md`
- `doc/planning/feature-inventory-home-server-remote-computer.md`
- `doc/planning/roadmap-home-server-remote-computer.md`

Supporting planning docs:

- `doc/planning/project-identity-boundaries.md`
- `doc/planning/feature-scope-priorities.md`
- `doc/planning/app-install-file-workflow-direction.md`
- `doc/planning/ui-ux-customization-agent.md`
- `doc/planning/implementation-priority-plan.md`

Operations/reference docs:

- `README.md` (developer/agent)
- `USER_README.md` (user/operator)
- `doc/README.md` (doc index + status labels)
- `doc/operations/completed-backlog-log.md`
- `doc/operations/local-run-guide.md`
- `doc/operations/remote-access-hardening-guide.md`
- `doc/operations/backup-restore-rehearsal-2026-04-25.md`
- `doc/operations/next-tasks-2026-04-25.md`
- `doc/reference/architecture-api-reference.md`
- `doc/reference/app-development-model.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/reference/app-ownership-matrix.md`

Precedence:

1. Roadmap + Product Brief
2. Other active planning docs
3. Code-verified behavior
4. Historical/snapshot logs

If docs and code conflict, use code-verified behavior for implementation and update docs.

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

App Install / File Workflow:

- `client/src/apps/system/file-explorer/*`
- `client/src/apps/system/transfer/*`
- `client/src/apps/addons/*`
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
- `server/storage/inventory/`
- `tools/package-doctor.js`
- `tools/migrate-apps-registry.js`

Home Server Operations:

- `client/src/apps/system/docker/*`
- `client/src/apps/system/resource-monitor/*`
- `client/src/apps/system/log-viewer/*`
- `client/src/apps/system/package-center/*`
- `docker-compose.yml`
- `docker/*`

Remote Computer UX:

- `client/src/apps/system/terminal/*`
- `client/src/apps/system/file-explorer/*`
- `client/src/apps/addons/code-editor/*`
- `client/src/apps/addons/document-viewer/*`
- `client/src/apps/addons/media-player/*`
- `client/src/apps/addons/model-viewer/*`

Agent / Automation:

- `client/src/core/components/Agent.svelte`
- `client/src/core/components/AgentChatPanel.svelte`
- `client/src/core/stores/agentStore.js`
- `server/routes/ai.js`
- `server/services/aiActionService.js`

## 5) Ready-State Criteria (Pre-Real-Use)

1. `npm test` passes.
2. `cd client && npm run build` passes.
3. Backend syntax checks pass for touched files.
4. Docker compose profile validates and has documented smoke evidence.
5. Core flows are verified (file/terminal/docker/package/backup/cloud/transfer/sandbox/launch).
6. Risky operations are approval/audit/recovery-aware.
7. Package Center exposes runtime/lifecycle/health/logs/permissions/data-boundary/backup state.
8. README + AGENTS + planning + reference docs are aligned.
9. Generated runtime/storage churn is intentionally handled.
10. Remote access hardening guide exists before external exposure.

## 6) Active Backlog (Assigned)

Status: `ACTIVE` (reassigned 2026-04-25).

### A0) Core/Addon Separation Hardening (Current First Item)

Item ID:
- `A0-core-addon-hardening`

Title:
- Core vs Addon separation hardening (post-folder-split phase)

Layer(s):
- `Web Desktop`
- `Sandbox / Package`
- `Docs / Verification`

Problem:
- Concept and folder split are in place, but security isolation and doc sync are only partially complete.

Code-verified baseline evidence:
- Folder split exists (`system` vs `addons`):
  - `client/src/core/appLaunchRegistry.js:3`
- App model contract exists (`system | standard | package`):
  - `client/src/core/appOwnershipContract.js:5`
- Built-in registry is inventory-based:
  - `server/services/packageRegistryService.js:334`
- Launch split is explicit (`component` vs `sandbox`):
  - `server/services/packageRegistryService.js:628`
- Contract APIs are exposed:
  - `server/routes/system.js:384` (`/api/system/apps`)
  - `server/routes/system.js:397` (`/api/system/apps/ownership-matrix`)

In Scope:
1. Isolation gap definition and execution plan:
   - standard addon (`component + host-shared`) hardening strategy toward sandbox/package path.
2. Station app ownership decision:
   - currently classified as `system`; decide whether to keep system or reclassify toward addon ecosystem.
3. Documentation sync to code reality:
   - remove stale pre-split phrasing and outdated launch mapping wording.
4. Preserve one-item execution gate:
   - finish this item, report, then ask user whether to continue/branch/commit/stop.

Out of Scope:
- Full migration of every standard addon to sandbox runtime in one shot.
- Large UX redesign unrelated to ownership/isolation boundary.
- New feature expansion not tied to separation/hardening.

DoD:
1. AGENTS/planning/reference docs all describe current separation state consistently.
2. A concrete decision is recorded for station app classification (`system` keep vs addon reclass).
3. A concrete migration path is recorded for standard addon isolation hardening.
4. No contradiction remains in key docs:
   - `doc/reference/app-ownership-matrix.md`
   - `doc/reference/app-development-model.md`
   - `doc/planning/app-install-file-workflow-direction.md`

Verification:
- `npm test`
- `cd client && npm run build`
- `node --check server/routes/system.js`
- `node --check server/services/packageRegistryService.js`
- `node --check client/src/core/appOwnershipContract.js`
- `node --check client/src/core/appLaunchRegistry.js`

Remaining gaps currently acknowledged:
- Most `standard` addons are still not sandbox-isolated (`component + host-shared` path).
  - `client/src/core/appOwnershipContract.js:78`
- Station apps are currently `system`-classified (decision pending if addon-ecosystem direction is preferred).
  - `server/storage/inventory/system/apps.json:127`
- Docs still include stale wording:
  - `doc/reference/app-ownership-matrix.md:62`
  - `doc/reference/app-development-model.md:59`

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
- Main agent: work selection, file ownership split, integration, conflict review, verification, docs

Workers must not edit the same files in parallel.

## 9) Verification Commands

Backend syntax:

```bash
node --check server/routes/packages.js
node --check server/routes/runtime.js
node --check server/routes/fs.js
node --check server/routes/cloud.js
node --check server/routes/ai.js
node --check server/services/packageLifecycleService.js
node --check server/services/runtimeManager.js
node --check server/services/cloudService.js
node --check server/services/aiActionService.js
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
  - required imported runtime files are present (`server/routes/ai.js`, `server/services/aiActionService.js`)
  - generated storage churn is intentional (`server/storage/index.json`)
- `AGENTS.md` is the canonical agent guide for this repository.

## 11) Invocation Profile: Autonomous Roadmap Loop

Use this profile when user invokes `AGENTS.md` for autonomous roadmap execution.

### 11.1 Trigger Phrases

- "AGENTS.md 기준으로 Autonomous Roadmap Loop 실행"
- "P0부터 첫 번째 미완료 작업 진행"
- "worker 병렬 사용"
- equivalent Korean/English phrasing with same intent

### 11.2 Command Object (Embedded Prompt Contract)

```yaml
command_profile:
  id: autonomous_roadmap_loop_v1
  backlog_selection:
    default_start_priority: [P0, R0]
    strategy: first_unfinished_in_order
    if_backlog_empty: ask_user_for_reassignment
  execution_scope:
    one_item_at_a_time: true
    auto_start_next_item: false
  worker_policy:
    ask_worker_count_before_start: true
    default_parallel_workers: 2
    optional_parallel_workers: 3
    file_ownership_overlap_allowed: false
    worker_1_scope: server route/service/backend contract (+server tests)
    worker_2_scope: client UI/store/api helper (+frontend build fixes)
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

1. "백로그 시작 기준을 `P0 우선`으로 진행할까요? (`P0 -> R0 -> first unfinished`)"
2. "워커를 몇 명 사용할까요? (기본 2명, 필요 시 3명)"
3. "이번 턴은 backlog item 1개만 완료 후 멈추고 선택지를 드릴까요?"

### 11.4 Mandatory Post-Item Question

After finishing each backlog item, do **not** auto-chain.
Always summarize changed files + behavior + verification, then ask:

- "다음 추천 작업을 계속할까요, 다른 작업으로 갈까요, 지금 커밋할까요, 여기서 중단할까요?"
