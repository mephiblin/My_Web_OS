# App Ownership Matrix

This document defines the active ownership model and launch contract after the `system` vs `addons` folder split (`as-of: 2026-04-25`).

## Contract Version

- `ownershipContractVersion`: `2026-04-25.b0-addon-packageization`
- Canonical models: `system`, `standard`, `package`
- Canonical owner tiers:
  - `system` -> `core-system`
  - `standard` -> `core-addon`
  - `package` -> `package-addon`
- Canonical launch modes: `component`, `sandbox`

## Data Boundary Contract

- `core-system`: `host-shared`
- `core-addon`: `host-shared`
- `package-addon`: `inventory-app-data`
- explicit app metadata override: `dataBoundary` can force `inventory-app-data` for trusted built-in addons when app-owned data isolation is required.
- Fallback/unknown: `none`

## Built-in App Matrix

| appId | model | ownerTier | launch.mode | dataBoundary | Notes |
|---|---|---|---|---|---|
| `files` | `system` | `core-system` | `component` | `host-shared` | File Station |
| `terminal` | `system` | `core-system` | `component` | `host-shared` | Terminal |
| `monitor` | `system` | `core-system` | `component` | `host-shared` | Resource Monitor |
| `docker` | `system` | `core-system` | `component` | `host-shared` | Docker Manager |
| `settings` | `system` | `core-system` | `component` | `host-shared` | Server/runtime settings |
| `control-panel` | `system` | `core-system` | `component` | `host-shared` | Desktop customization |
| `logs` | `system` | `core-system` | `component` | `host-shared` | Log Viewer |
| `package-center` | `system` | `core-system` | `component` | `host-shared` | Package operations console |
| `transfer` | `system` | `core-system` | `component` | `host-shared` | Transfer manager |
| `download-station` | `system` | `core-system` | `component` | `host-shared` | Station app (kept as system) |
| `photo-station` | `system` | `core-system` | `component` | `host-shared` | Station app (kept as system) |
| `music-station` | `system` | `core-system` | `component` | `host-shared` | Station app (kept as system) |
| `document-station` | `system` | `core-system` | `component` | `host-shared` | Station app (kept as system) |
| `video-station` | `system` | `core-system` | `component` | `host-shared` | Station app (kept as system) |
| `player` | `standard` | `core-addon` | `component` | `host-shared` | Media player |
| `doc-viewer` | `standard` | `core-addon` | `component` | `host-shared` | Document viewer |
| `model-viewer` | `standard` | `core-addon` | `component` | `host-shared` | Model viewer |
| `editor` | `standard` | `core-addon` | `component` | `host-shared` | Code editor |
| `widget-store` | `standard` | `core-addon` | `component` | `inventory-app-data` | Widget catalog and widget package workflow tool |

## Package App Contract

Any app discovered from `server/storage/inventory/apps/<appId>/manifest.json` and normalized as package app follows:

- `model`: `package`
- `ownerTier`: `package-addon`
- `launch.mode`: `sandbox`
- `dataBoundary`: `inventory-app-data`

Package apps must be installable through Package Center lifecycle paths:

- Git registry install (`webos-store.json` + `zipUrl`)
- direct ZIP import
- remove/update/backup/rollback operations after install

Example in current workspace:

- `hello-sandbox`

## API Expectations

For roadmap consistency, ownership and launch contract must be available from backend registry contract:

- `GET /api/system/apps` returns app items including `appModel` and `launch`.
- `GET /api/system/apps/ownership-matrix` returns normalized ownership matrix items for docs/UI/ops usage.

## A0 Decision Log (2026-04-25)

- Station app classification decision:
  - Keep `download/photo/music/document/video-station` as `appModel=system` for now.
  - Rationale: they still operate in host-level file/media workflows and must remain inside core approval/audit/recovery boundaries used by system operations.
- Standard addon isolation hardening path (`non-breaking`, phased):
  - Phase 1 (now): keep `standard` apps on `launch.mode=component` with explicit ownership/dataBoundary metadata and API-visible contract.
  - Phase 2: introduce optional sandbox-capable runtime profile for selected `standard` apps while preserving existing appId/entry contracts.
  - Phase 3: move hardened addons to `package` launch path (`launch.mode=sandbox`, `ownerTier=package-addon`, `dataBoundary=inventory-app-data`) after lifecycle/backup/rollback evidence is validated.
  - Phase 4: flip defaults for eligible addon classes to sandbox/package and keep a compatibility lane only for exceptions with documented host-bound requirements.

## B0 Addon Packageization Decision Log (2026-04-25)

- Development convenience:
  - Addons may remain project-bundled under `client/src/apps/addons/*` while features are being built and tested.
  - This is not the same as declaring them permanent core apps.
- Runtime ownership target:
  - ordinary addons should move toward `package` ownership when they need install/update/remove distribution.
  - Package Center lifecycle is the owner of install, update, remove, backup, rollback, health, and visible data boundary state.
- Primary migration targets:
  - `editor`
  - `doc-viewer`
  - `model-viewer`
- Distribution target:
  - Git registry and direct ZIP import should behave as equivalent onboarding paths for package artifacts.

## B1 Primary Addon Source Layout Decision Log (2026-04-25)

- `editor`, `doc-viewer`, and `model-viewer` now use package-first source layout.
- Current runtime classification remains:
  - `appModel=standard`
  - `ownerTier=core-addon`
  - `launch=component`
  - `dataBoundary=host-shared`
- The new folder contract is:
  - root wrapper keeps legacy launch compatibility
  - `components/` owns UI implementation
  - `services/` owns API/helper/runtime logic
  - `package/` owns manifest and future ZIP/registry package entry
- This separates source ownership from runtime ownership.
- Full separation is only complete when each addon runs through `package` + `sandbox` lifecycle with Package Center install/update/remove ownership.

## B2 File Association Lifecycle Decision Log (2026-04-25)

- File Station resolves file open targets from `/api/system/apps`, which includes built-in apps and installed package apps.
- Installed package apps can become native-feeling file openers by declaring `fileAssociations` in their manifest.
- User defaults are stored in `contextMenu.openWithByExtension`.
- File Station must pass full app metadata into `openWindow`, not just `{ id }`, so package launch contracts such as `launch.mode=sandbox` are preserved.
- Package deletion must clear stale user defaults pointing to the removed app.
- Built-in defaults remain available as fallback openers:
  - image/audio/video -> `player`
  - pdf/text preview -> `doc-viewer`
  - 3D model files -> `model-viewer`
  - text/code edit -> `editor`

## B3 Primary Addon Sandbox Runtime Decision Log (2026-04-25)

- `doc-viewer`, `model-viewer`, and `editor` now have inventory package runtime entries.
- When an inventory package has the same app id as a `standard` built-in addon, package ownership wins.
- This produces the desired runtime classification:
  - `appModel=package`
  - `ownerTier=package-addon`
  - `launch=sandbox`
  - `dataBoundary=inventory-app-data`
- Replacement is intentionally limited to `standard` addons.
- `system` apps must not be shadowed by package apps without a separate explicit policy.
- Feature parity notes:
  - `doc-viewer`: package runtime is usable for PDF/image/text viewing.
  - `editor`: package runtime is usable for grant-based text read/write.
  - `model-viewer`: package runtime includes local Three.js vendor files and supports GLTF/GLB/FBX/OBJ rendering.
