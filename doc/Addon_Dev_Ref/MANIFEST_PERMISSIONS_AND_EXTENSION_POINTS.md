# Manifest, Permissions, And Extension Points

Status: `[ACTIVE]`

## Required Manifest Fields

```json
{
  "id": "my-addon",
  "title": "My Addon",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": []
}
```

Fields:

- `id`: stable package/app identifier
- `title`: user-visible title
- `version`: semver-like version string
- `type`: usually `app`
- `runtime.type`: use `sandbox-html` for ordinary addons
- `runtime.entry`: relative entry file
- `permissions`: declared platform capability list

## Runtime Types

Current addon default:

```text
sandbox-html
```

Other runtime types may exist in package validation, but they should not be used
for ordinary UI addons without explicit lifecycle, approval, and audit design.

## Permissions

Common permissions:

| Permission | Use |
| --- | --- |
| `ui.notification` | Show Web OS notifications/toasts |
| `window.open` | Open another registered Web OS app |
| `system.info` | Read system overview |
| `app.data.read` | Read addon-owned data |
| `app.data.write` | Write addon-owned data |
| `host.file.read` | Read granted host files |
| `host.file.write` | Write granted host files |

Rules:

- Permission list must be explicit.
- Do not request host permissions for UI-only tools.
- `host.file.write` is high-risk and should be justified by the addon purpose.

## File Associations

Use `fileAssociations` to register opener behavior.

```json
{
  "fileAssociations": [
    {
      "extensions": ["json", "txt"],
      "actions": ["open", "edit", "preview"],
      "defaultAction": "open"
    }
  ]
}
```

Rules:

- Extensions are lowercase without dots.
- `actions` should match behavior the addon actually supports.
- `defaultAction` should be one of the declared actions.
- Editor-style apps normally need `host.file.read` and `host.file.write`.

## `contributes.fileContextMenu`

Adds File Station right-click file actions.

```json
{
  "contributes": {
    "fileContextMenu": [
      {
        "label": "Open in JSON Tool",
        "action": "open",
        "extensions": ["json"]
      }
    ]
  }
}
```

Rules:

- Declarative only.
- No app code executes during menu construction.
- Action should map to a supported launch/open behavior.

## `contributes.fileCreateTemplates`

Adds safe new-file templates.

```json
{
  "contributes": {
    "fileCreateTemplates": [
      {
        "label": "JSON File",
        "name": "Untitled.json",
        "extension": "json",
        "content": "{\n  \"hello\": \"world\"\n}\n",
        "action": "edit",
        "openAfterCreate": true
      }
    ]
  }
}
```

Rules:

- Template content is static.
- `openAfterCreate` must be boolean.
- No addon code executes to create the file.

## `contributes.previewProviders`

Registers preview providers for File Station.

```json
{
  "contributes": {
    "previewProviders": [
      { "label": "JSON Preview", "extensions": ["json"] }
    ]
  }
}
```

Rules:

- Requires `host.file.read`.
- File Station should issue a temporary grant only after explicit user handoff.
- Addon must handle missing grant.

## `contributes.thumbnailProviders`

Registers thumbnail provider discovery.

```json
{
  "contributes": {
    "thumbnailProviders": [
      { "label": "Image Thumbnail", "extensions": ["png", "jpg"] }
    ]
  }
}
```

Current behavior:

- Provider metadata is discoverable.
- Host file grants are not issued during ordinary directory listing.
- Explicit user handoff is still required.

## `contributes.settingsPanels`

Declares future package settings panels.

```json
{
  "contributes": {
    "settingsPanels": [
      { "label": "Settings", "entry": "settings.html" }
    ]
  }
}
```

Current status:

- Validated and visible as metadata.
- Full Package Center settings launch is a later UI step.

## `contributes.backgroundServices`

Declares background service candidates.

```json
{
  "contributes": {
    "backgroundServices": [
      {
        "id": "indexer",
        "label": "Indexer",
        "entry": "service.js",
        "autoStart": false
      }
    ]
  }
}
```

Current status:

- Metadata only for ordinary addon work.
- `autoStart: true` is treated as a request, not execution permission.
- Do not rely on background service execution until lifecycle policy exists.

## Package Replacement Policy

Inventory package apps may replace built-in `standard` addons with the same id.

Current package-first replacements:

- `doc-viewer`
- `model-viewer`
- `editor`

Rules:

- Replacement is allowed for `standard` addons.
- Replacement is not allowed for `system` apps.
- Package replacement should preserve app id and file association behavior.

