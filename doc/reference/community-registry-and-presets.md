# Community Registry And Presets

This document defines how real users can publish/install packages through Git-hosted registries without hardcoded server entries.

## 1. Goal

- Support app-store-like package publication by community maintainers.
- Keep package discovery/install contract data-driven (`JSON`), not route hardcoding.
- Keep runtime safety rules unchanged (preflight, approval, audit, lifecycle).

## 2. Distribution Model (Git + ZIP)

Recommended publisher model:

1. Maintain package source in a Git repository.
2. Produce distributable zip artifact per release.
3. Publish a registry index file (`webos-store.json`) in the same repository (or dedicated index repo).
4. Operators add repository URL or raw JSON URL in Package Center Store Source.

Direct ZIP model:

1. Build the same distributable zip artifact.
2. Upload it through Package Center ZIP import or `POST /api/packages/import`.
3. Use this path for local development, private packages, and pre-registry testing.

Current UI behavior already supports:

- GitHub repo URL -> `https://raw.githubusercontent.com/<owner>/<repo>/main/webos-store.json`
- GitHub blob URL -> raw URL conversion
- Direct raw JSON URL

Preset files used by this model:

- `doc/presets/webos-store.preset.json`
- `doc/presets/package-manifest.preset.json`
- `doc/presets/ecosystem-template-catalog.preset.json`

## 3. Registry Index Contract (`webos-store.json`)

Top-level contract:

```json
{
  "version": 1,
  "title": "My Web OS Community Store",
  "packages": [
    {
      "id": "sample-notes",
      "title": "Sample Notes",
      "description": "Simple note app",
      "version": "1.0.0",
      "author": "community",
      "repository": "https://github.com/example/sample-notes",
      "zipUrl": "https://github.com/example/sample-notes/releases/download/v1.0.0/sample-notes-1.0.0.zip",
      "manifestUrl": "https://raw.githubusercontent.com/example/sample-notes/main/manifest.json",
      "icon": "NotebookPen",
      "permissions": ["app.data.read", "app.data.write"],
      "capabilities": [],
      "release": {
        "channel": "stable",
        "publishedAt": "2026-04-25T00:00:00.000Z",
        "rolloutDelayMs": 0
      }
    }
  ]
}
```

Compatibility notes:

- Server accepts either:
  - JSON array of packages, or
  - object with `packages` array.
- `zipUrl` is required for install path.
- URL fields must be `http://` or `https://`.

## 4. Package Manifest Preset Contract

Community packages should start from preset shape and then customize:

```json
{
  "id": "your-app-id",
  "title": "Your App",
  "version": "0.1.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": [],
  "fileAssociations": [],
  "capabilities": []
}
```

## 5. Ecosystem Template Catalog Contract (Preset-Driven)

Ecosystem template metadata should be loaded from a catalog file, not expanded inline in route constants.

Runtime loader canonical location (git-tracked):

- `server/presets/ecosystem-template-catalog.json`

Documentation preset mirror (must stay in sync with runtime canonical):

- `doc/presets/ecosystem-template-catalog.preset.json`

Top-level contract:

```json
{
  "version": 1,
  "namespace": "official",
  "templates": [
    {
      "id": "empty-html",
      "title": "Empty HTML App",
      "category": "productivity",
      "description": "Minimal sandbox-html app template.",
      "defaults": {
        "runtimeType": "sandbox-html",
        "appType": "app",
        "entry": "index.html",
        "permissions": []
      }
    }
  ]
}
```

Validation expectations for file-based loader:

- invalid payload shape -> explicit `code` + `message`
- duplicate template id -> explicit `code` + `message`
- invalid defaults/runtime/appType/permissions -> explicit `code` + `message`

Optional runtime override:

- `server/storage/inventory/system/ecosystem-template-catalog.json`
- If this file exists, server uses it as inventory override source.
- If absent, server falls back to tracked builtin preset.

## 6. Template/Preset Direction (Non-Hardcoding)

Policy direction:

- Store/package/template metadata should be loaded from preset/catalog files.
- Avoid expanding route-level hardcoded catalogs over time.
- Prefer explicit preset versioning and validation over implicit inline data.

Practical target:

- Registry catalog preset files
- Manifest preset files
- Ecosystem template catalog preset files

## 7. Community Publish Workflow

1. Build package files (`manifest.json`, entry files, assets).
2. Run `npm run package:doctor -- --manifest=<manifest-path>`.
3. Zip package root.
4. Publish zip artifact (usually GitHub Releases).
5. Update `webos-store.json` with new version/zipUrl/release metadata.
6. Verify with `POST /api/packages/registry/preflight`.
7. Install from Package Center.

## 8. Direct ZIP Import Workflow

1. Build package files (`manifest.json`, entry files, assets).
2. Run `npm run package:doctor -- --manifest=<manifest-path>`.
3. Zip the package root.
4. Upload ZIP through Package Center.
5. Review preflight/import results when available.
6. Confirm overwrite/update only after backup and lifecycle state are visible.

## 9. Safety Constraints (Must Keep)

- No bypass of preflight/quality/lifecycle safeguards.
- No implicit host-wide file authority to package apps.
- No silent overwrite/update/remove flows.
- All risky operations must remain approval/audit/recovery aware.
