# App Ownership Matrix

This document locks the ownership model and launch contract for `P5-1`.

## Contract Version

- `ownershipContractVersion`: `2026-04-24.p5-1`
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
| `player` | `standard` | `core-addon` | `component` | `host-shared` | Media player |
| `doc-viewer` | `standard` | `core-addon` | `component` | `host-shared` | Document viewer |
| `model-viewer` | `standard` | `core-addon` | `component` | `host-shared` | Model viewer |
| `editor` | `standard` | `core-addon` | `component` | `host-shared` | Code editor |
| `widget-store` | `standard` | `core-addon` | `component` | `host-shared` | Widget catalog |

## Package App Contract

Any app discovered from `server/storage/inventory/apps/<appId>/manifest.json` and normalized as package app follows:

- `model`: `package`
- `ownerTier`: `package-addon`
- `launch.mode`: `sandbox`
- `dataBoundary`: `inventory-app-data`

Example in current workspace:

- `hello-sandbox`

## API Expectations

For roadmap consistency, ownership and launch contract must be available from backend registry contract:

- `GET /api/system/apps` returns app items including `appModel` and `launch`.
- `GET /api/system/apps/ownership-matrix` returns normalized ownership matrix items for docs/UI/ops usage.

This file is source-of-truth for P5-1 classification until P5-2 folder split changes physical locations.
