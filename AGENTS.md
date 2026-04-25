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

## 6) Active Backlog (Reset State)

Status: `EMPTY` (intentionally cleared for reassignment).

There is currently no active roadmap item in this file.
When work is reassigned:

1. register the new item here first
2. define DoD and verification scope
3. execute one item at a time unless user explicitly asks for chaining

Template for reassignment:

```text
Item ID:
Title:
Layer(s):
Problem:
In Scope:
Out of Scope:
DoD:
Verification:
```

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

- Worker 1: server routes/services/backend contracts/server tests
- Worker 2: client UI/stores/api helpers/frontend build fixes
- Main agent: work selection, ownership split, integration, conflict review, verification, docs

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
