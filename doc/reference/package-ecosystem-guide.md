# Package Ecosystem Guide

This guide is for community package authors and maintainers.

## 1. Required Package Shape

- Place app files under `server/storage/inventory/apps/<app-id>/`
- Add `manifest.json` with:
  - `id`
  - `title`
  - `version`
  - `type` (`app`, `widget`, `service`, `hybrid`, `developer`)
  - `runtime.type` (`sandbox-html`, `process-node`, `process-python`, `binary`)
  - `runtime.entry` for non-service packages
  - `permissions` list (optional but explicit is recommended)

## 2. Validation Workflow

Use both local and server-side checks:

1. Local static check:
   - `npm run package:doctor -- --manifest=<path-to-manifest.json>`
2. Server preflight checks:
   - `POST /api/packages/wizard/preflight`
   - `POST /api/packages/registry/preflight`
3. Quality gate:
   - `POST /api/packages/ecosystem/templates/:templateId/quality-check`

## 3. Runtime Capability Model

Capability catalog endpoint:

- `GET /api/packages/runtime/capabilities`

Sandbox app capability map:

- `GET /api/sandbox/:appId/capabilities`

SDK policy endpoint:

- `GET /api/system/app-api-policy?clientVersion=0.1.0`

## 4. Sandbox SDK

Sandbox SDK script:

- `/api/sandbox/sdk.js`

Basic include example (inside sandbox app HTML):

```html
<script src="/api/sandbox/sdk.js"></script>
<script>
  window.WebOS.ready().then(() => window.WebOS.system.info().then(console.log));
</script>
```

## 5. Release Safety Expectations

Before release:

- run preflight
- check dependency/compatibility results
- check lifecycle safeguards
- verify backup/rollback path for updates
- verify permissions are minimal

## 6. Backup / Rollback Operations

Key lifecycle endpoints:

- `GET /api/packages/:id/lifecycle`
- `GET /api/packages/:id/backup-policy`
- `PUT /api/packages/:id/backup-policy`
- `POST /api/packages/:id/backup`
- `GET /api/packages/:id/backup-jobs`
- `POST /api/packages/:id/backup-jobs`
- `POST /api/packages/:id/backup-jobs/:jobId/cancel`
- `POST /api/packages/:id/rollback/preflight`

Policy notes:

- `backupPolicy.maxBackups` controls retention pruning.
- `backupPolicy.schedule` is metadata today (execution wiring is roadmap scope).
- nonexistent app requests return `PACKAGE_NOT_FOUND`.
- cancel is only valid while backup job status is `queued`.

## 7. Test / Verification Notes

- Use root `npm test` as canonical server verification path.
- Direct parallel multi-file `node --test` can intermittently fail due shared storage state races.
- For focused file lists, prefer `node --test --test-concurrency=1 ...`.
