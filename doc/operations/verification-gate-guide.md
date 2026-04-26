# Verification Gate Guide

Status: `[ACTIVE]`

Scope:

- `RUR-5-verify-gate`
- release verification command shape
- package registry checks
- client build and UI smoke plan
- destructive rehearsal guardrails

This guide defines the verification gate expected before real-use releases. In
the current working tree, `package.json` and CI wiring are present; use the
manual equivalents below only when isolating a failed gate step.

## Gate Contract

`npm run verify` is the local release gate. It should run:

1. backend syntax checks
2. server tests
3. package registry and manifest checks
4. client build
5. Docker Compose config validation when Docker is available

`npm run verify:ci` is the deterministic pull-request gate. It should avoid
long-lived local stack mutation and run:

```bash
npm ci
cd client
npm ci
cd ..
npm run verify:ci
```

`npm run verify:syntax` should cover the high-risk backend routes, services, and
tools that are easy to break with syntax-only changes:

```bash
node --check server/routes/packages.js
node --check server/routes/fs.js
node --check server/routes/runtime.js
node --check server/routes/sandbox.js
node --check server/routes/docker.js
node --check server/services/packageLifecycleService.js
node --check server/services/packageRegistryService.js
node --check server/services/templateCatalogService.js
node --check server/services/fileGrantService.js
node --check server/services/fileTicketService.js
node --check tools/migrate-apps-registry.js
```

`npm run verify:ci` runs this syntax gate before server tests, package checks,
and the client build. CI should call `npm run verify:ci` rather than duplicating
the individual steps.

## Manual Equivalents

Use these commands when isolating a failure:

```bash
npm test
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
cd client
npm run build
```

Docker Compose config checks:

```bash
docker compose config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml config
```

Package doctor failures are release blockers. Warnings should be reviewed before
release and either fixed or documented as intentional debt; they should not
become permanent background noise.

Client build is the minimum frontend gate:

```bash
cd client
npm run build
```

It proves Vite/Svelte compilation, but it does not prove core user workflows.
Use the UI smoke plan below for workflow coverage.

Dependency-free local shell smoke:

```bash
npm run verify:ui-smoke
```

This command expects the backend and frontend dev servers to already be running.
It checks deterministic workflow source guards, backend health, and the frontend
app shell boot contract. The source guards currently fail if targeted system
apps reintroduce native `confirm()` / `prompt()` or if the expected approval and
recoverable-state markers disappear from Login, File Station, Package Center,
Transfer UI, or Sandbox frame code.

This is stronger than a reachability-only smoke and is the current dependency-free
release smoke gate. It is still not a browser click-through automation gate.
Adding Playwright-style workflow automation remains a future hardening
enhancement.

## Future Browser Automation Plan

If a browser runner is added, the first click-through smoke should cover:

1. Desktop loads after authentication and does not render a blank shell.
2. Package Center opens from the desktop/start surface and shows an installed,
   available, loading, or explicit error/retry state.
3. File Station/File Explorer shows an explicit empty state for an empty folder
   or empty search result.
4. Spotlight can launch Package Center through the shared app launch contract.
5. Spotlight can find and launch at least one installed package app.
6. A sandbox app reaches an explicit ready state, or shows an explicit bridge or
   package error such as `SANDBOX_BRIDGE_READY_TIMEOUT`; it must not stay as a
   blank frame or indefinite spinner.

Playwright smoke tests should prefer user-visible selectors:

- `getByRole`
- `getByText`
- `getByLabel`
- stable accessible names

Avoid brittle implementation selectors such as generated classes, Svelte
component internals, DOM depth, and styling hooks. Use test ids only where the
UI has no stable user-visible role or text, and keep them tied to behavior
rather than layout.

## Operations Guardrails

Registry migration should be inspected before overwrite:

```bash
node tools/migrate-apps-registry.js --dry-run
node tools/migrate-apps-registry.js --dry-run --force
```

Release/package verification uses:

```bash
node tools/migrate-apps-registry.js --dry-run --fail-on-removal
```

The command still prints added, removed, and changed ids, but exits nonzero when
the dry-run target would remove currently registered app ids. Use plain
`--dry-run` for manual inspection when a removal is intentional and will be
handled separately.

Actual overwrite still requires `--force`. When `--force` overwrites an existing
current registry, the migration tool keeps a timestamped backup of the current
file before writing.

Backup/restore rehearsal is dry-run by default:

```bash
bash tools/rehearse-storage-backup-restore.sh
```

Actual Docker and volume mutation requires `--execute`:

```bash
bash tools/rehearse-storage-backup-restore.sh --execute
```

Noninteractive execution must pass `--yes`:

```bash
bash tools/rehearse-storage-backup-restore.sh --execute --yes
```

The rehearsal script uses an isolated compose project by default:

```text
webos_rehearsal_<timestamp>
```

Set `COMPOSE_PROJECT_NAME` or pass `--project-name` only when intentionally
targeting a specific compose project. Use `--keep-stack` only when the remaining
stack is needed for manual inspection.
