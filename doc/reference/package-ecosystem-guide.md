# Package Ecosystem Guide

This guide is for community package authors and maintainers.
For Git-based store publication and preset contracts, see:

- `doc/reference/community-registry-and-presets.md`
- `doc/presets/webos-store.preset.json`
- `doc/presets/package-manifest.preset.json`
- `doc/presets/ecosystem-template-catalog.preset.json`
- `server/presets/ecosystem-template-catalog.json` (runtime builtin catalog)

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

Supported installation paths:

- Git registry install: publish `webos-store.json` using preset format (`doc/presets/webos-store.preset.json`) and include per-package `zipUrl`.
- ZIP import install: upload a `.zip` package artifact through Package Center / package API.
- Both paths should converge on the same package lifecycle model: manifest validation, install/update audit, backup before overwrite, rollback evidence, and Package Center visibility.
- For ecosystem scaffold templates, use preset catalog format (`doc/presets/ecosystem-template-catalog.preset.json`).
- Runtime loads tracked builtin catalog from `server/presets/ecosystem-template-catalog.json`.
- Optional inventory override is `server/storage/inventory/system/ecosystem-template-catalog.json`.

Developer convenience note:

- Addon source can remain in `client/src/apps/addons/*` while a feature is being built and tested.
- That does not make the addon a permanent core app.
- The operational target for ordinary addons is package lifecycle ownership: install, update, remove, backup, rollback, and explicit data boundary state.

## 2. Validation Workflow

Use both local and server-side checks:

1. Local static check:
   - `npm run package:doctor -- --manifest=<path-to-manifest.json>`
2. Server preflight checks:
   - `POST /api/packages/wizard/preflight`
   - `POST /api/packages/registry/preflight`
   - ZIP import preflight when exposed by the server/package center flow
3. Quality gate:
   - `POST /api/packages/ecosystem/templates/:templateId/quality-check`
4. Registry index sanity:
   - ensure `webos-store.json` follows preset fields and valid URLs
5. Template catalog sanity:
   - ensure `ecosystem-template-catalog` payload uses versioned preset shape
   - ensure duplicate template IDs are rejected by contract checks

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
<script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
<script>
  window.WebOS.ready().then(() => window.WebOS.system.info().then(console.log));
</script>
```

Runtime notes:

- The SDK announces `webos:ready` repeatedly for a short window until the parent frame sends context.
- The parent frame must surface bridge timeout as an explicit error instead of leaving the app in infinite loading.
- Package entries that require a file must handle missing `launchData.fileContext` with a visible message.

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

## 8. Git Store Publication (Recommended)

1. Keep package source in Git repository.
2. Publish zip artifact (commonly GitHub Releases).
3. Update `webos-store.json` in repository root.
4. Add repository URL in Package Center store source.

## 9. ZIP Import Publication

ZIP import is the direct package artifact path. It is useful for local testing, private sharing, and releases that do not need a public registry.

Expected artifact:

- root contains `manifest.json`
- root contains runtime entry files referenced by the manifest
- archive does not rely on generated runtime storage outside the package root

Expected API/UI behavior:

- preflight should inspect the ZIP manifest before write when available
- overwrite/update should create a backup before replacing an existing package
- import should record lifecycle source as ZIP/upload/import
- risky overwrite should remain visible and auditable
- imported package should appear in Package Center with the same operations as registry-installed packages

## 10. File Association Install Experience

For a package to feel like a native Web OS app, include `fileAssociations` and optional `contributes` entries in `manifest.json`.

Example:

```json
{
  "id": "better-image-viewer",
  "title": "Better Image Viewer",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": ["host.file.read"],
  "fileAssociations": [
    {
      "extensions": ["png", "jpg", "jpeg", "webp"],
      "actions": ["open", "preview"],
      "defaultAction": "open"
    }
  ],
  "contributes": {
    "fileContextMenu": [
      {
        "label": "Open in Better Image Viewer",
        "action": "open",
        "extensions": ["png", "jpg", "jpeg", "webp"]
      }
    ],
    "fileCreateTemplates": [
      {
        "label": "Markdown File",
        "name": "Untitled.md",
        "extension": "md",
        "content": "# Untitled\n\n",
        "action": "edit",
        "openAfterCreate": true
      }
    ],
    "previewProviders": [
      { "label": "Image Preview", "extensions": ["png", "jpg", "jpeg", "webp"] }
    ],
    "thumbnailProviders": [
      { "label": "Image Thumbnail", "extensions": ["png", "jpg", "jpeg", "webp"] }
    ],
    "settingsPanels": [
      { "label": "Image Viewer Settings", "entry": "settings.html" }
    ],
    "backgroundServices": [
      { "id": "image-indexer", "label": "Image Indexer", "entry": "service.js", "autoStart": false }
    ]
  }
}
```

Expected operator behavior:

- install package through registry or ZIP import
- open File Station
- right-click a matching file
- choose the app-provided context menu item when declared
- choose `Open With <app>` or `Always Open .<ext> With <app>`
- right-click empty folder space and choose app-provided `New <template>` entries
- double-click matching files after default selection

Removal behavior:

- deleting the package removes stale user default file-open mappings for that package
- built-in fallback apps continue to open supported file types

Contribution rules:

- `contributes.fileContextMenu[]` is declarative only; it must map to a supported file action such as `open`, `preview`, or `edit`.
- If `extensions` is omitted, Web OS derives matching extensions from the app's `fileAssociations` for the same action.
- `contributes.fileCreateTemplates[]` lets apps add safe file templates to File Station. The template writes static content only; no app code executes during creation.
- `contributes.previewProviders[]` connects matching files to the File Station preview panel through sandbox preview handoff and file grants. The panel shows an explicit preview button first; a temporary read grant is issued only after that click and is revoked when the preview is closed or replaced.
- `contributes.thumbnailProviders[]` connects matching files to File Station provider discovery. Matching files show a thumbnail-provider badge and can hand off to the sandbox preview panel only after the user clicks the action, so directory listing does not auto-read host files.
- `contributes.settingsPanels[]` declares safe relative package entries for future Package Center settings launch.
- `contributes.backgroundServices[]` declares service candidates only. `autoStart: true` is treated as a request, not an execution command, until lifecycle policy, approval, and audit handling exist.
- Package Center and `package:doctor` validate contribution shape so core code does not need app-specific menu hardcoding.

Permission rules:

- `previewProviders` and `thumbnailProviders` require `host.file.read`
- template entries using `openAfterCreate` must use a boolean value
- editor-style apps that open host files for editing should declare both `host.file.read` and `host.file.write`

## 11. Built-In Addon Replacement Policy

Package apps may replace built-in `standard` addons when they use the same app id and are present in inventory.

Current package-first replacements:

- `doc-viewer`
- `model-viewer`
- `editor`

Rules:

- package replacement is allowed for `standard` addons only
- package replacement is not allowed for `system` apps
- replacement preserves the familiar app id used by File Station and Open With
- the visible launch contract changes from component launch to sandbox launch

This lets a default viewer/editor feel built-in while still being managed as an installable package.
