# My Web OS - Developer README

This is the developer and agent-facing guide.
For end users/operators, read `USER_README.md`.

## 1) Project Scope

My Web OS is a browser-based operations layer for a personally owned PC/home server.
It is not a kernel replacement, VM platform, or public multi-tenant SaaS.

Core model:

```text
Home Server = files, media, backup, services, Docker, logs
Remote Computer = terminal, app launch, file editing, system state
Web OS = permissions, approval, audit, lifecycle, recovery
Package Center = install/create/run/update/backup/rollback
```

## 2) Canonical Docs

Priority:

1. `AGENTS.md` + product/roadmap docs
2. active planning/reference docs
3. dated operations snapshots
4. archived/legacy docs

Document index and status labels live in `doc/README.md`.

Primary docs:

- `AGENTS.md`
- `doc/planning/product-brief-home-server-remote-computer.md`
- `doc/planning/feature-inventory-home-server-remote-computer.md`
- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/reference/architecture-api-reference.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/operations/completed-backlog-log.md`
- `doc/operations/local-run-guide.md`
- `doc/operations/remote-access-hardening-guide.md`

## 3) Development Contract

Implementation order:

1. contract/API
2. service/helper/store
3. minimal UI
4. verification
5. docs sync

Rules:

- Keep route handlers thin; put state transitions in services.
- Validate risky state changes on backend (path, appId, runtime, manifest, grants).
- Never make risky operations silent (delete/overwrite/rollback/command execution).
- Do not move feature logic into `client/src/core/Desktop.svelte` or `Window.svelte`.
- Do not revert unrelated dirty workspace changes.

## 4) Layer Ownership

Host:

- `server/routes/fs.js`
- `server/routes/system.js`
- `server/routes/settings.js`
- `server/routes/docker.js`
- `server/routes/logs.js`
- `server/routes/cloud.js`
- `server/routes/transfer.js`
- `server/services/*`

Web Desktop:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
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

## 5) Verification Commands

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

Tests/build:

```bash
npm test
cd client && npm run build
```

Registry/package checks:

```bash
npm run apps:registry:migrate
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

Compose smoke:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
docker compose down
```

## 6) Commit Safety

Before committing:

- check `git status --short`
- verify runtime imports from `server/index.js` are present
  - especially `server/routes/ai.js`, `server/services/aiActionService.js`
- avoid accidental generated storage churn (`server/storage/index.json`) unless intentional

## 7) Roadmap Execution

Use `AGENTS.md` roadmap and pick the first unfinished item unless the user requests chaining.

For each completed item report:

- changed files
- behavior change
- verification results
- skipped checks (with reason)
- remaining risks
- next recommended item

## 8) Doc Lifecycle

- active: current implementation/operations baseline
- snapshot: date-based progress record
- completed: completion evidence
- legacy: one-time migration/backward-compat guidance
- archived: historical reference only

Archive index: `doc/archive/README.md`.
