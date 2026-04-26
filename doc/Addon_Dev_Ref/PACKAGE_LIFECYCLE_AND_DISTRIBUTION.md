# Package Lifecycle And Distribution

Status: `[ACTIVE]`

This file covers Package Center, ZIP import, registry install/update, lifecycle
approval, local workspace bridge, backup, and rollback. It is for addon
authors and AI agents that need to distribute or update packages.

## Development And Distribution Modes

| Mode | Use For | Notes |
| --- | --- | --- |
| Direct inventory | Fast local development | Put files under `server/storage/inventory/apps/<app-id>/`; reload browser after first app-registry load. |
| Package Center wizard | Guided local package creation | Uses templates, preflight, quality gate, and lifecycle metadata. |
| ZIP import | Manual install or transfer | Upload a `.zip`; Package Center runs preflight and lifecycle approval. |
| Registry install | Shared distribution | Add an HTTP(S) store index; install ZIP artifacts listed by that index. |
| Local workspace bridge | Developer convenience | Optional metadata linking inventory package to an allowed local workspace path; inventory remains canonical. |

## Lifecycle Approval Contract

Fresh install, ZIP import, registry install, update, rollback, and manifest
update all require scoped lifecycle approval.

Sequence:

```text
preflight
  -> show risk, target, typedConfirmation, operationId, targetHash
  -> POST /api/packages/lifecycle/approve
  -> execute operation with approval { operationId, nonce, targetHash }
```

Approval request:

```json
{
  "action": "package.install",
  "targetId": "my-addon",
  "operationId": "op_...",
  "typedConfirmation": "my-addon"
}
```

Execution payload includes:

```json
{
  "approval": {
    "operationId": "op_...",
    "nonce": "nonce_...",
    "targetHash": "sha256:..."
  }
}
```

Allowed lifecycle actions:

```text
package.install
package.update
package.import
package.rollback
package.manifest.update
```

Rules:

- The typed confirmation is currently the target package id.
- Approval nonce is consume-once and target-hash scoped.
- `{ "approved": true }` is rejected.
- If preflight data changes, target hash changes and approval must be repeated.
- Browser helpers must send user-entered text, not auto-copy
  `preflight.approval.typedConfirmation`.

## ZIP Import

Direct upload limit:

```text
50 MB
```

Accepted layouts:

```text
manifest.json
index.html
assets/
vendor/
```

or:

```text
my-addon/
  manifest.json
  index.html
  assets/
  vendor/
```

The importer searches for a `manifest.json`. Avoid multiple manifests or extra
top-level package roots because they make package intent hard to review.

ZIP import preflight checks:

- manifest shape and runtime entry,
- permissions and media scopes,
- dependency and compatibility constraints,
- quality gate,
- existing package conflict,
- backup plan for overwrite/update,
- lifecycle safeguards.

## Registry Sources

Registry sources are stored through:

```text
GET    /api/packages/registry/sources
POST   /api/packages/registry/sources
DELETE /api/packages/registry/sources/:id
```

Source shape:

```json
{
  "id": "my-store",
  "title": "My Store",
  "url": "https://example.com/webos-store.json",
  "enabled": true
}
```

Rules:

- `url` must start with `http://` or `https://`.
- Package Center converts GitHub repository URLs to
  `https://raw.githubusercontent.com/<owner>/<repo>/main/webos-store.json`.
- GitHub blob URLs are converted to raw URLs.
- Private Git authentication is not a stable addon contract yet.
- Registry install downloads ZIP artifacts over HTTP(S); it does not `git clone`.

Store package rows should expose:

```json
{
  "id": "my-addon",
  "title": "My Addon",
  "version": "1.0.0",
  "zipUrl": "https://example.com/releases/my-addon.zip",
  "release": {
    "channel": "stable",
    "publishedAt": "2026-04-26T00:00:00.000Z",
    "rolloutDelayMs": 0
  }
}
```

Registry ZIP download limit:

```text
80 MB, 15 seconds
```

`zipUrl` or `downloadUrl` is required for install. Missing zip URLs fail with
`REGISTRY_PACKAGE_ZIP_MISSING`.

## Version, Channel, And Update Policy

Manifest and registry metadata support channels:

```text
stable | beta | alpha | canary
```

Dependencies support strings or objects:

```json
{
  "dependencies": [
    "doc-viewer",
    { "id": "editor", "version": "^1.2.0", "optional": false }
  ]
}
```

Supported version range patterns include:

```text
*
1
1.2
1.2.3
^1.2.0
~1.2.0
>=1.0.0 <2.0.0
>=1.0.0 || >=2.0.0-beta
```

Prerelease versions are excluded unless the range mentions a prerelease.
Blocked channel updates can only be bypassed by the admin user through the
explicit policy bypass path.

## Local Workspace Bridge

Local workspace bridge is optional developer metadata. Inventory remains the
canonical installed package location.

Payload:

```json
{
  "localWorkspace": {
    "enabled": true,
    "path": "/allowed/root/my-addon",
    "mode": "readwrite"
  }
}
```

Rules:

- `mode` is `read` or `readwrite`; default is `readwrite`.
- `path` must be inside configured allowed roots.
- Protected inventory system paths are blocked.
- This bridge does not make the sandbox iframe read arbitrary workspace files.
- Treat it as Package Center lifecycle metadata and developer workflow hint.

## Backup And Rollback

Lifecycle state is stored under the inventory system directory. Package backups
are ZIP snapshots under:

```text
<inventory-system-dir>/package-backups/<app-id>/
```

Defaults:

```text
maxBackups: 20
maxBackups upper limit: 100
schedule intervals: manual | daily | weekly | monthly
default schedule time: 00:00
```

Overwrite/update operations create a pre-operation backup when required.
Rollback requires:

1. existing backup,
2. rollback preflight,
3. lifecycle approval,
4. restore execution.

If install/update fails after a backup was created, the server attempts to
restore the backup and restart the runtime if it was running.

## Package Creation Wizard And Templates

Package Center exposes template and scaffold flows through the package
ecosystem endpoints. Use wizard/templates when you want guided creation,
quality gate output, and lifecycle metadata in one path.

Use direct inventory when iterating quickly on a known addon. Use ZIP or
registry when testing real install/update/rollback behavior.

## Common Error Codes

| Code | Meaning |
| --- | --- |
| `PACKAGE_IMPORT_MANIFEST_MISSING` | ZIP does not contain a readable `manifest.json` |
| `PACKAGE_ALREADY_EXISTS` | Install target already exists and overwrite/update was not requested |
| `PACKAGE_LIFECYCLE_APPROVAL_INVALID` | Approval was missing, expired, wrong, or already consumed |
| `PACKAGE_INSTALL_APPROVAL_REQUIRED` | Install requires lifecycle approval evidence |
| `PACKAGE_UPDATE_APPROVAL_REQUIRED` | Update requires lifecycle approval evidence |
| `PACKAGE_IMPORT_APPROVAL_REQUIRED` | ZIP import requires lifecycle approval evidence |
| `PACKAGE_ROLLBACK_APPROVAL_REQUIRED` | Rollback requires lifecycle approval evidence |
| `PACKAGE_MANIFEST_APPROVAL_REQUIRED` | Manifest update requires lifecycle approval evidence |
| `TEMPLATE_QUALITY_GATE_FAILED` | Quality gate produced blocking failures |
| `REGISTRY_UPDATE_POLICY_BLOCKED` | Channel/update policy blocked the candidate |
| `REGISTRY_PACKAGE_TOO_LARGE` | Registry ZIP exceeded 80 MB |
| `REGISTRY_PACKAGE_DOWNLOAD_TIMEOUT` | Registry ZIP download exceeded timeout |
| `LOCAL_WORKSPACE_PATH_NOT_ALLOWED` | Local workspace path is outside allowed roots |
| `DEPENDENCY_MISSING` | Required dependency is not installed or compatible |
| `PACKAGE_ENTRY_NOT_FOUND` | Runtime entry file is missing |
| `PACKAGE_MEDIA_SCOPE_APPROVAL_REQUIRED` | Media scope change requires approval |
