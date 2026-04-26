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

Ordinary UI addons should use:

```text
type: app
runtime.type: sandbox-html
```

Other runtime/app types exist in validation, including `service`, `hybrid`, and
managed process runtimes. They should not be used for ordinary UI addons
without explicit lifecycle, approval, runtime, and audit design. Service
packages may not appear in the desktop launcher.

## Permissions

Common permissions:

| Permission | Use |
| --- | --- |
| `ui.notification` | Show Web OS notifications/toasts |
| `window.open` | Open another registered Web OS app |
| `system.info` | Read system overview |
| `app.data.list` | List addon-owned data files/directories |
| `app.data.read` | Read addon-owned data |
| `app.data.write` | Write addon-owned data |
| `host.file.read` | Read granted host files |
| `host.file.write` | Write granted host files |

Rules:

- Permission list must be explicit.
- Do not request host permissions for UI-only tools.
- `host.file.write` is high-risk and should be justified by the addon purpose.

## Extended Manifest Fields

Current normalizers also understand these fields:

| Field | Status | Notes |
| --- | --- | --- |
| `description` | Stable | User-facing package summary |
| `icon` | Stable | Lucide name, image URL/data URL, or package asset path |
| `author` | Stable metadata | Display/review metadata |
| `repository` | Stable metadata | Project or source URL |
| `singleton` | Stable | Reuses one app window and may receive `webos:launch-data` |
| `window.width/height/minWidth/minHeight` | Stable | Initial desktop window sizing hints |
| `media.scopes` | Advanced | Reviewed lifecycle risk; scope names are validated |
| `dependencies` | Advanced | Package dependency/version range metadata |
| `compatibility` | Advanced | Server/runtime compatibility checks |
| `release.channel` | Distribution | `stable`, `beta`, `alpha`, or `canary` |
| `service` | Experimental for ordinary addons | Runtime service settings; not a UI addon default |
| `healthcheck` | Experimental for ordinary addons | Managed runtime healthcheck metadata |
| `resources` | Experimental for ordinary addons | Managed runtime resource hints |

Package Center may preserve unknown fields in source files, but addon authors
should not rely on unknown fields becoming runtime behavior.

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
- Current File Station matching is extension-centered. `mimeTypes` are accepted
  as manifest metadata but should not be the only matching strategy.
- `actions` should match behavior the addon actually supports.
- `defaultAction` should be one of the declared actions.
- Editor-style apps normally need `host.file.read` and `host.file.write`.
- Supported actions are `preview`, `open`, `edit`, `import`, and `export`.

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
- Template `name` must be a safe file name and is capped at 128 characters.
- Template `content` is capped at 64 KiB.

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

## Validation Limits

Important current limits:

| Item | Limit |
| --- | --- |
| Extension value | `a-z`, numbers, `.`, `_`, `+`, `-`, max 32 chars |
| Contribution id | max 64 chars, `a-z`, numbers, `.`, `_`, `:`, `-` |
| Contribution label | max 80 chars |
| File template name | max 128 chars |
| File template content | max 64 KiB |
| Relative entry path | safe relative path, max 180 chars |

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
