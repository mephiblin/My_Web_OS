# AGENTS.md

Operational guide and active work packet for coding agents working on My Web OS.

Keep this file lightweight. Long design notes, screenshots, and product
planning belong in `Addon_Dev_Help/NexusTerm/` or `doc/operations/`. This file
defines the current engineering contract.

## Active Development Focus

Current focus:

- Build NexusTerm as a trusted `system` app.
- NexusTerm combines real local terminal access, folder browsing,
  Markdown/code viewing and editing, search, mobile layout, and AI-assisted
  vibe-coding support.
- Keep the existing `terminal` system app working. NexusTerm starts as a
  separate app, not a replacement.
- Reuse the existing terminal approval/PTY backend contract.
- Reuse File Station, Code Editor, and Document Viewer contracts where
  practical.
- Keep AI suggestion-first. AI must not auto-run commands or auto-save files in
  the MVP.

Current reference documents:

- NexusTerm plan:
  `Addon_Dev_Help/NexusTerm/NexusTerm_Development_Plan_KO.md`
- Desktop reference:
  `Addon_Dev_Help/NexusTerm/NexusTerm_Ref_Desk.png`
- Mobile reference:
  `Addon_Dev_Help/NexusTerm/NexusTerm_Ref_Mobile.png`
- Addon/security limits:
  `doc/Addon_Dev_Ref/SECURITY_LIMITS_AND_APPROVALS.md`
- SDK and integration references:
  `doc/Addon_Dev_Ref/SDK_API_REFERENCE.md`
  `doc/Addon_Dev_Ref/CORE_INTEGRATION_MAP.md`
  `doc/Addon_Dev_Ref/MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`

Current decision:

- NexusTerm is not an ordinary `sandbox-html` addon.
- Ordinary addons may launch or document Terminal workflows, but they must not
  open local shells, bypass terminal approval, or call terminal socket
  protocols directly.
- NexusTerm belongs under `client/src/apps/system/nexus-term/`.
- Core desktop/window files stay orchestration-only. Only app registration and
  lazy loading should touch core launch surfaces.

## Working Model

My Web OS is a browser-based operations layer for a personally owned PC, home
server, or homelab.

NexusTerm is:

- a trusted Web OS system app,
- a local terminal workspace,
- a folder/file workspace,
- a Markdown/code viewer and editor,
- a mobile-friendly development surface,
- an AI-assisted coding cockpit where the user remains in control.

NexusTerm is not:

- a kernel or VM isolation layer,
- a public internet IDE,
- an addon sandbox escape hatch,
- a Docker/service lifecycle manager,
- an autonomous agent that executes commands or writes files without approval.

## Source Precedence

Use this order when docs and code conflict:

1. Code-verified behavior in the current working tree.
2. `AGENTS.md`.
3. `Addon_Dev_Help/NexusTerm/NexusTerm_Development_Plan_KO.md`.
4. `doc/Addon_Dev_Ref/SECURITY_LIMITS_AND_APPROVALS.md`.
5. `doc/Addon_Dev_Ref/CORE_INTEGRATION_MAP.md`.
6. `doc/Addon_Dev_Ref/SDK_API_REFERENCE.md`.
7. `doc/operations/home-server-readiness-gap-resolution-report-2026-04-26.md`.
8. `doc/operations/verification-gate-guide.md`.
9. `doc/reference/architecture-api-reference.md`.

If docs and code conflict, implement to code-verified behavior first, then sync
the relevant docs in the same packet when practical.

## Workflow

Use this execution order:

```text
scope -> MVP -> analysis -> document re-reference -> contract/API
-> service/helper/store -> minimal UI -> responsive/mobile pass
-> verification -> docs/reporting
```

Required steps:

1. Run `git status --short` before editing.
2. Classify the task by layer.
3. Pick the smallest useful MVP slice.
4. Inspect existing route/service/store/UI/test files before editing.
5. Re-open the NexusTerm plan and relevant Addon Dev Ref document before
   changing terminal, host file, approval, or AI behavior.
6. Preserve backend approval contracts before UI polish.
7. Add or update focused tests for changed terminal, file, or approval
   behavior.
8. Run the smallest useful verification set and report skipped checks.
9. Sync docs when code-verified behavior changes.

## Task Packet Template

Fill this block before non-trivial implementation:

```text
Selected item:
Problem:
Why this matters:
Layer(s):
In scope:
Out of scope:
MVP behavior:
User-visible outcome:
Risk level:
Files to inspect first:
Implementation notes:
First implementation slice:
DoD:
Verification commands:
Rollback/safety notes:
Fallback path:
```

## Layer Checklist

Mark all that apply:

- [ ] Host
- [ ] Web Desktop
- [ ] System Apps
- [ ] Addon Runtime/UI
- [ ] Sandbox / Package
- [ ] Docs / Verification

## Risk Checklist

Answer before implementation:

- [ ] Does this touch terminal, Host files, Docker, package lifecycle, rollback,
      cloud transfer, backup, destructive operations, or AI-assisted execution?
- [ ] Does it need backend preflight, target evidence/hash, scoped nonce, TTL,
      consume-once approval, execution revalidation, and audit?
- [ ] Does it need structured errors with `code`, `message`, and `details`?
- [ ] Does it affect file grants, raw tickets, media leases, shares, job state,
      or terminal sessions?
- [ ] Can existing tests be extended instead of adding a broad new harness?
- [ ] Does the mobile layout preserve approval visibility and keyboard-safe
      terminal input?

## Operating Rules

- Treat terminal and Host file operations as real operations.
- Approval is a backend contract, not a browser-only confirmation.
- Typed confirmation must be user-entered in trusted UI code.
- Do not copy `preflight.approval.typedConfirmation` or any expected
  confirmation value into approval requests.
- Never send legacy `approval: { approved: true }`.
- Do not weaken `terminal.session` preflight, scoped nonce, target hash,
  consume-once, or audit behavior.
- Do not bypass File Station or FS approval contracts for NexusTerm editing.
- AI output is advisory in the MVP. AI may suggest commands or patches, but it
  must not execute commands or save files automatically.
- Do not include secrets, full home-directory scans, raw terminal history, or
  hidden files in AI context by default.
- Keep `client/src/core/Desktop.svelte` and `client/src/core/Window.svelte`
  orchestration-only.
- Keep existing `terminal`, `files`, `editor`, and `doc-viewer` apps working
  while extracting reusable pieces.
- Do not commit local runtime state unless it has explicitly become a redacted
  fixture or schema.

## Files To Inspect First

For terminal/session work:

- `client/src/apps/system/terminal/Terminal.svelte`
- `server/services/terminal.js`
- `server/tests/terminal-approval-contract.test.js`
- `server/services/operationApprovalService.js`

For file browsing and editing:

- `client/src/apps/system/file-explorer/api.js`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `client/src/apps/addons/code-editor/components/CodeEditorApp.svelte`
- `client/src/apps/addons/code-editor/services/fileApi.js`
- `client/src/apps/addons/document-viewer/components/DocumentViewerApp.svelte`
- `server/routes/fs.js`
- `server/tests/fs-approval-contract.test.js`

For system app registration:

- `server/config/builtinAppsSeed.js`
- `client/src/core/appLaunchRegistry.js`
- `client/src/core/i18n/packs/en.json`
- `client/src/core/i18n/packs/ko.json`

For AI context:

- `client/src/core/stores/agentStore.js`
- `server/routes/ai.js`
- `doc/operations/verification-gate-guide.md`

## Active Work Plan: NexusTerm

### N0 - Terminal Session Client Extraction

Selected item:

- Extract reusable terminal session/socket logic from the existing Terminal UI.

Problem:

- NexusTerm needs the same approved local shell behavior without duplicating a
  fragile socket and approval flow.

Layer(s):

- Host
- System Apps
- Docs / Verification

In scope:

- Client-side terminal session helper/store.
- Existing Terminal app migration to the helper.
- Regression tests or focused smoke around approval flow.

Out of scope:

- Backend event renaming.
- Multiple concurrent terminal tabs.
- AI command execution.

MVP behavior:

- Existing `terminal` app still starts a local shell only after typed
  confirmation approval.

DoD:

- Existing terminal app works.
- Wrong typed confirmation remains rejected.
- Approval nonce remains target-hash scoped and consume-once.

Verification commands:

```bash
node --test --test-concurrency=1 server/tests/terminal-approval-contract.test.js
npm --prefix client run build
```

### N1 - NexusTerm System App Skeleton

Selected item:

- Register a new `nexus-term` system app with a desktop shell layout.

Problem:

- NexusTerm needs a trusted app surface before file and AI features are added.

Layer(s):

- Web Desktop
- System Apps

In scope:

- `client/src/apps/system/nexus-term/NexusTerm.svelte`.
- Built-in app seed entry.
- App launch registry entry.
- i18n title entries.
- Basic header, terminal pane, and status bar.

Out of scope:

- File editing.
- AI panel.
- Mobile polish.

MVP behavior:

- Launcher opens NexusTerm.
- Terminal pane starts through the same approval gate as Terminal.

DoD:

- NexusTerm opens without breaking existing Terminal.
- No core desktop/window feature code is added.

Verification commands:

```bash
npm --prefix client run build
npm run verify:ui-smoke
git diff --check
```

### N2 - Workspace Explorer

Selected item:

- Add read-only folder browsing in NexusTerm.

Problem:

- Vibe coding needs fast project navigation next to the terminal.

Layer(s):

- Host
- System Apps

In scope:

- Allowed roots and initial path loading.
- Folder tree/list view using existing FS APIs.
- File selection state.
- Refresh and boundary error display.

Out of scope:

- Delete, rename, move, upload, extract.
- Background indexing beyond existing services.

MVP behavior:

- User can browse allowed folders and select a file for viewing.

DoD:

- Boundary errors are visible.
- Explorer cannot bypass allowed roots.

Verification commands:

```bash
node --test --test-concurrency=1 server/tests/fs-approval-contract.test.js
npm --prefix client run build
```

### N3 - Markdown And Code Viewer

Selected item:

- Add file viewing for Markdown and common text/code formats.

Problem:

- The terminal workspace needs direct file inspection without opening separate
  windows for every file.

Layer(s):

- Host
- System Apps

In scope:

- Read-only viewer.
- Markdown preview/source tabs.
- Code/text display with language detection.
- Large/binary unsupported states.

Out of scope:

- Saving.
- Multi-file refactor.
- Raw media preview.

MVP behavior:

- Selected Markdown and code files render in the viewer pane.

DoD:

- Missing file and unsupported file states are clear.
- Read uses existing host file contracts.

Verification commands:

```bash
npm --prefix client run build
git diff --check
```

### N4 - Code Editing And Save Approval

Selected item:

- Add text/code editing with backend overwrite approval.

Problem:

- NexusTerm is only useful for vibe coding if edits can be saved safely.

Layer(s):

- Host
- System Apps

In scope:

- Dirty state.
- Save/reload.
- FS overwrite preflight.
- User-entered typed confirmation.
- Execute save with `{ operationId, nonce, targetHash }`.
- Approval recovery states.

Out of scope:

- AI patch auto-apply.
- Git commit/staging UI.
- Broad destructive file actions.

MVP behavior:

- User can edit and save a text/code file after trusted overwrite approval.

DoD:

- No auto-confirm approval pattern.
- Wrong typed confirmation fails.
- Target changed/expired approval is recoverable.

Verification commands:

```bash
rg -n "typedConfirmation: .*expectedConfirmation|typedConfirmation: .*preflight\\?\\.approval|approved: true" client/src/apps/system
node --test --test-concurrency=1 server/tests/fs-approval-contract.test.js
npm --prefix client run build
```

### N5 - Mobile Layout

Selected item:

- Implement mobile tabs for Terminal, Explorer, Viewer, Search, and More.

Problem:

- NexusTerm must be usable on phones where desktop split panes collapse badly.

Layer(s):

- Web Desktop
- System Apps

In scope:

- Bottom tab navigation.
- Keyboard-safe terminal viewport.
- Full-screen explorer/viewer/search panels.
- Touch-sized controls.
- Approval modal that remains readable on mobile.

Out of scope:

- Forcing desktop split layout onto mobile.
- Native mobile app packaging.

MVP behavior:

- Mobile users can switch between terminal, explorer, viewer, search, and more
  without overlap or hidden approval controls.

DoD:

- Terminal input remains usable with the software keyboard open.
- Approval confirmation text and input are visible.

Verification commands:

```bash
npm --prefix client run build
npm run verify:ui-smoke
```

### N6 - AI Vibe Coding Panel

Selected item:

- Add AI-assisted suggestions using explicit workspace context.

Problem:

- The target workflow is vibe coding, but AI must not become an uncontrolled
  command or file mutation path.

Layer(s):

- Host
- System Apps
- Docs / Verification

In scope:

- AI context builder with caps.
- Selected file/folder/recent terminal output context.
- Explain output, suggest command, suggest patch, summarize file.
- User-controlled copy/insert actions.

Out of scope:

- Auto-running terminal commands.
- Auto-saving files.
- Including secrets, full home directories, hidden files, or raw persistent
  terminal history by default.

MVP behavior:

- AI produces suggestions only. User performs execution or save through normal
  trusted UI and approval contracts.

DoD:

- AI panel cannot execute a command by itself.
- AI panel cannot save a file by itself.
- Context inclusion is visible and capped.

Verification commands:

```bash
npm --prefix client run build
npm run verify:ui-smoke
git diff --check
```

## Verification Commands

Use the narrowest relevant command first:

```bash
node --test --test-concurrency=1 server/tests/terminal-approval-contract.test.js
node --test --test-concurrency=1 server/tests/fs-approval-contract.test.js
npm run verify:ui-smoke
npm --prefix client run build
git diff --check
```

Broader gates when touching shared contracts:

```bash
npm run verify:syntax
npm test
npm run verify
```

## Rollback Notes

- Remove the `nexus-term` seed and app loader entry to disable the new app.
- Keep existing `terminal` and File Station behavior intact during every slice.
- If terminal extraction destabilizes Terminal, revert only the extraction slice
  and keep the backend contract unchanged.
- If AI context handling is uncertain, ship NexusTerm without AI until the
  context and approval boundaries are reviewed.
