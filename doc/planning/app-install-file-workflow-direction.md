# App Install And File Workflow Direction

## Purpose

My Web OS should feel like an installable app environment around the local PC.
Apps are installed, updated, launched, inspected, and removed through Web OS,
but useful apps such as model viewers, document editors, media players, and code editors
must still work with real local files.

The goal is not to isolate every app from the Host so strongly that local work becomes useless.
The goal is to make local file access explicit, permissioned, recoverable, and visible.

```text
File Station owns local file selection and path intent.
Apps own focused workflows.
Web OS owns permissions, approval, audit, lifecycle, and recovery.
Package Center owns install/update/remove/runtime health.
```

## Product Philosophy

Web OS is closer to Windows, macOS, Android, or iOS app management than to a static web portal.

- Apps can be installed and removed.
- Apps can declare supported file types.
- Users can open local files with apps.
- Apps can request read/write access through Web OS APIs.
- Risky writes, overwrite, delete, rollback, and command execution require approval.
- System apps remain privileged, but ordinary apps should not silently bypass Web OS boundaries.

This means "modular app" does not mean "cannot touch local files".
It means local file access is mediated by File Station, Web OS APIs, permissions, and audit.

## App Classes

### System Apps

System apps wrap Host or operating capabilities.

Examples:

- File Station
- Terminal
- Settings
- Control Panel
- Package Center
- Resource Monitor
- Log Viewer
- Docker Manager
- Transfer Manager

Rules:

- They may call privileged backend routes.
- They must show explicit errors and recovery paths.
- Risky actions need approval and audit.
- They should stay under `client/src/apps/system/*`.
- They should not be converted into untrusted sandbox apps unless a stronger permission model exists.

### Trusted Built-in Addons

Trusted built-in addons are bundled apps that provide user workflows but are not core Host operators.

Examples:

- Model Viewer
- Document Viewer / Editor
- Media Player
- Code Editor
- Widget Store

Rules:

- They should live under `client/src/apps/addons/*`.
- They should be registered as `appModel: "standard"`.
- They may open local files when File Station, Spotlight, or an explicit open-file flow provides context.
- They should use Web OS file APIs instead of ad hoc Host path access where practical.
- Save/overwrite flows should move toward approval, audit, and recoverability.
- They are trusted for early development, but should be designed so they can later become package addons.

Development note:

- A bundled addon can be the fastest way to develop and test a viewer/editor inside the desktop shell.
- Once the addon needs user-facing install/update/remove behavior, it should have a package artifact path.
- Package artifacts should be installable from both Git registry and direct ZIP import.

### Package Addons

Package addons are installed apps discovered from package manifests.

Examples:

- Third-party Notepad
- Markdown editor
- Image editor
- PDF annotator
- Game or widget installed through Package Center

Rules:

- They live under `server/storage/inventory/apps/<appId>/`.
- They declare manifest permissions, runtime, entry, type, and metadata.
- Their app-owned data lives under `server/storage/inventory/data/<appId>`.
- They use sandbox/package APIs for local file operations.
- Their lifecycle, health, logs, backup, rollback, and runtime state are visible in Package Center.
- Their install source can be Git registry or direct ZIP import.

## Current Isolation Gap (A0 Baseline)

Current code behavior is a split by app class and folder, not full runtime isolation for all addons.

- Most trusted built-in addons (`appModel: "standard"`) still run as component launches with host-shared access patterns.
- This is an intentional transitional state for practical local file workflows.
- Folder split (`system` vs `addons`) and ownership contract are real, but they do not by themselves guarantee sandbox isolation.
- Directionally, standard addons should move toward sandbox/package-compatible contracts, but that migration is not complete.

This document describes the migration direction and execution gates; it does not claim full isolation is already delivered.

## Current Packageization Gap (B0 Baseline)

The folder and ownership split is in place, but package-manager behavior is not yet the default mental model for all ordinary addons.

Current direction:

- keep system apps privileged and modular
- keep project-bundled addons available for development
- make ordinary addon distribution package-first over time
- keep Git registry and ZIP import as equivalent package artifact onboarding paths
- avoid adding addon-specific business logic to `Desktop.svelte` or `Window.svelte`

## File Station As The File Hub

File Station is the primary place where local file intent is created.

Expected workflows:

```text
Open file:
File Station -> Open With -> app receives { path, mode: "read", source: "file-station" }

Edit file:
File Station -> Open With Editor -> app receives { path, mode: "readwrite", source: "file-station" }

Save file:
App -> Web OS file API -> backend path policy -> approval if overwrite/risky -> audit -> result

Import to app-owned data:
File Station -> Import to App -> app data root copy -> package/app owns new copy
```

File Station should not become a place where app-specific logic accumulates.
It should resolve file type, available apps, requested mode, and user intent,
then pass a narrow launch context to the selected app.

## File Association Contract

Apps should be able to declare file support.

Suggested registry or manifest shape:

```json
{
  "fileAssociations": [
    {
      "extensions": ["fbx", "glb", "gltf", "obj"],
      "mimeTypes": ["model/gltf-binary"],
      "actions": ["open", "preview"],
      "defaultAction": "open"
    }
  ]
}
```

Actions:

- `preview`: read-only quick inspection
- `open`: read-only full app view
- `edit`: read/write workflow
- `import`: copy into app-owned data
- `export`: write a new file chosen by user

The association registry should support both built-in addons and package addons.

## File Access Contract

Apps should receive file context, not broad Host authority.

Suggested launch data:

```json
{
  "source": "file-station",
  "file": {
    "path": "/home/user/Models/demo.fbx",
    "name": "demo.fbx",
    "extension": "fbx",
    "mode": "read"
  },
  "permissionContext": {
    "grantId": "temporary-session-grant",
    "scope": "single-file",
    "expiresOnWindowClose": true
  }
}
```

Rules:

- Single-file grants should not become directory-wide grants.
- Directory grants require explicit user action.
- Write access should be separate from read access.
- Overwrite should require confirmation unless the file was already opened in edit mode by the user.
- Package addons should not receive raw allowed-root browsing by default.

## Local File Write Policy

Writes are allowed when they are intentional and recoverable.

Low-risk writes:

- Save to app-owned data
- Export to a newly selected path
- Save a new file created by the app

Higher-risk writes:

- Overwrite an existing Host file
- Batch modify files
- Delete files
- Move files across roots
- Write into protected or project/system directories

Higher-risk writes should use:

- approval prompt
- explicit error codes
- audit event
- rollback/trash/backup where practical

## Package Center Role

Package Center should make installed apps feel manageable.

It should show:

- app model: `system`, `standard`, `package`
- app type: `app`, `widget`, `service`, `hybrid`, `developer`
- runtime: `builtin`, `sandbox-html`, `process-node`, `process-python`, `binary`
- file associations
- permissions and capabilities
- health, logs, lifecycle events
- backup/rollback availability
- app-owned data location

Package Center is not only a store.
It is the operational console for installed apps.

## Development Direction

Implement in this order.

1. Registry source reliability

   Make the built-in app registry durable and versioned.
   `server/storage/inventory/system/apps.json` must be available in new checkouts or generated by a reliable bootstrap path.

2. File association model

   Add file association metadata for built-in addons first:
   Model Viewer, Document Viewer, Media Player, Code Editor.

3. File Station Open With flow

   File Station should resolve file associations and launch apps with a normalized file context.

4. Web OS file grant model

   Add a small grant object for read/readwrite file contexts.
   Start with trusted built-in addons, then extend to package addons.

5. Save/overwrite approval path

   Route writes through backend policy, approval, audit, and recoverable behavior.

6. Package addon parity

   Allow package manifests to declare the same file associations and permissions.

7. Package Center visibility

   Show associations, grants, permissions, runtime, and app data boundaries in installed operations views.

## Standard Addon Hardening Plan (Phased)

Move standard addons from the current component + host-shared baseline toward sandbox/package parity in phases.

1. Manifest readiness gate

   Define and maintain manifest-equivalent metadata for each standard addon
   (file associations, requested capabilities, runtime intent, data boundary intent)
   so migration can be tracked per app instead of ad hoc.

2. Permission mapping gate

   Map current implicit addon behaviors to explicit permission scopes
   (read, readwrite, import, export, risky-write operations)
   and reject or warn on unmapped privileged behavior.

3. Data migration gate

   Introduce clear app-owned data locations and migration helpers
   from mixed host paths to app-scoped storage where applicable,
   while preserving user-visible file workflows.

4. Approval/audit parity gate

   Ensure overwrite, delete, batch modify, move, rollback, and command-like risky operations
   follow the same approval and audit posture expected in package/sandbox paths.

5. Rollback and recovery gate

   Add practical rollback/recovery coverage for high-risk writes and app lifecycle changes
   before marking an addon as hardened for sandbox/package transition.

6. Runtime transition gate

   Promote addons incrementally to sandbox/package runtime models only after the above gates pass,
   with per-app validation rather than one-shot ecosystem migration.

## Station App Ownership Decision (A0)

Station apps remain `system`-classified in current code.

- This keeps current operational authority stable while separation hardening is in progress.
- Boundary note: keep Station capabilities under system-app rules and approval/audit expectations;
  do not treat Station as a standard/package addon until a stricter permission and runtime boundary is ready.
- Reclassification can be revisited later, but this document records the current decision as "system for now."

## Non-goals

- Do not block trusted built-in addons from opening local files.
- Do not force every useful app into sandbox runtime immediately.
- Do not put app-specific parsing or editing logic into File Station.
- Do not let sandbox/package addons browse all Host files by default.
- Do not treat UI folder separation as complete security isolation.

## Success Criteria

This direction is working when:

- A user can open an FBX file from File Station with Model Viewer.
- A user can open and save a text/document file with an editor through Web OS file APIs.
- Package Center can explain what file types an app handles and what permissions it needs.
- System apps, trusted built-in addons, and package addons are visibly distinct.
- Host writes are approved, audited, and recoverable when risk is meaningful.
- New app features do not require editing `Desktop.svelte` or `Window.svelte`.
