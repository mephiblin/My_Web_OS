# AGENTS.md

Operational guide and active work packet for coding agents working on My Web OS.

Keep this file lightweight. Do not store long readiness reviews, historical
completion evidence, or broad backlog here. Put detailed evidence in
`doc/operations/` and keep this file focused on the current engineering
contract.

## Active Development Focus

Current focus:

- Approval self-approval hardening is code-complete for the current packet.
- Keep sandbox/addon overwrite approval parent-owned.
- Keep system app approval UX on user-entered typed confirmation, not
  server-provided confirmation echoed by code.
- Keep verification failing when auto-confirm approval patterns return.

Current reference documents:

- Completion snapshot:
  `doc/operations/home-server-readiness-gap-resolution-report-2026-04-26.md`
- Readiness review:
  `doc/operations/home-server-readiness-review-2026-04-26.md`
- Verification gate:
  `doc/operations/verification-gate-guide.md`

Current decision:

- VPN/internal owner-only beta is conditionally acceptable.
- Addon-first development is allowed only through current Host/file/package
  contracts.
- Addon-only/core-freeze is conditionally acceptable after the self-approval
  hardening packet, with core changes limited to bugfix/security/reliability/
  performance/verification/platform contract maintenance.
- Direct public internet exposure remains out of scope until hardened deployment
  and real-use browser smoke coverage are verified.

## Working Model

My Web OS is a browser-based operations layer for a personally owned PC, home
server, or homelab.

It is not:

- a kernel OS replacement
- a virtual machine platform
- an enterprise multi-tenant SaaS
- a public internet service by default

Core model:

```text
Home Server = files, media, backup, services, Docker, logs
Remote Computer = terminal, app launch, file editing, system state
Web OS = permissions, approval, audit, lifecycle, recovery
Package Center = install/create/run/update/backup/rollback
```

## Source Precedence

Use this order when docs and code conflict:

1. Code-verified behavior in the current working tree.
2. `AGENTS.md`.
3. `doc/operations/home-server-readiness-gap-resolution-report-2026-04-26.md`
4. `doc/operations/home-server-readiness-review-2026-04-26.md`
5. `doc/operations/verification-gate-guide.md`
6. `doc/reference/architecture-api-reference.md`
7. `doc/planning/implementation-priority-plan.md`

If docs and code conflict, implement to code-verified behavior first, then sync
the relevant docs in the same work packet when practical.

## Workflow

Use this execution order:

```text
scope -> MVP -> analysis -> document re-reference -> contract/API
-> service/helper/store -> minimal UI -> verification -> docs/reporting
```

Required steps:

1. Run `git status --short` before editing.
2. Classify the task by layer.
3. Pick the smallest useful MVP slice.
4. Inspect existing route/service/store/UI/test files before editing.
5. Re-open the relevant `doc/operations/`, `doc/planning/`, or `doc/reference/`
   source before changing behavior.
6. Implement backend contract and validation before UI polish.
7. Add or update focused tests for changed behavior.
8. Run the smallest useful verification set and report skipped checks.
9. Sync docs when code-verified behavior changes.

## Task Packet Template

Fill this block before non-trivial implementation:

```text
Selected item:
Problem:
Why this matters:
Metaphor:
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

- [ ] Does this touch Host files, Docker, terminal, package lifecycle, rollback,
      cloud transfer, backup, or destructive operations?
- [ ] Does it need backend preflight, target evidence/hash, scoped nonce, TTL,
      consume-once approval, execution revalidation, and audit?
- [ ] Does it need structured errors with `code`, `message`, and `details`?
- [ ] Does it affect sandbox grants, raw tickets, media leases, shares, or job
      state?
- [ ] Can existing tests be extended instead of adding a broad new harness?

## Operating Rules

- Treat Host operations as real operations.
- Approval is a backend contract, not a browser-only confirmation.
- Typed confirmation must be user-entered in trusted UI code.
- Do not let sandbox/addon code mint approval nonces by echoing
  server-provided `typedConfirmation`.
- Hide complexity, not risk.
- Keep `client/src/core/Desktop.svelte` and `client/src/core/Window.svelte`
  orchestration-only.
- Do not bypass Host/file/package contracts from addons.
- Do not commit local runtime state unless it has explicitly become a redacted
  fixture or schema.

## Active Work Plan: Approval Self-Approval Hardening

### P0 - Parent-owned Sandbox Write Approval

Selected item:

- Sandbox apps may request host-file writes, but approval must be owned by the
  trusted Web OS parent frame.

Problem:

- Sandbox apps can request preflight evidence, read server-provided
  `typedConfirmation`, and call approval helpers themselves.

Why this matters:

- Host-file overwrite approval must prove user intent in trusted Web OS UI, not
  sandbox code cooperation.

Metaphor:

- A sandbox app can ask for a locked door to open, but the parent frame is the
  only desk allowed to issue the key.

Layer(s):

- Host
- Addon Runtime/UI
- Sandbox / Package
- Docs / Verification

In scope:

- Sandbox SDK and bridge changes for write approval.
- Parent-owned approval dialog and retry flow.
- Sandbox route, audit, and contract-test updates.
- Built-in sandbox package migration away from `approveWrite()`.

Out of scope:

- Full sandbox permission redesign.
- New package capabilities unrelated to host-file write.
- Browser click automation beyond source and smoke guards.

MVP behavior:

- Sandbox code calls `WebOS.files.write({ overwrite: true })`.
- If backend returns `428 SANDBOX_FILE_WRITE_APPROVAL_REQUIRED`, the parent
  frame opens a Web OS-owned approval dialog.
- The parent frame collects user-entered typed confirmation, calls
  `/api/sandbox/:appId/file/write/approve`, then retries write with
  `{ operationId, nonce, targetHash }`.
- Sandbox code cannot call `approveWrite()` or receive a nonce directly.

User-visible outcome:

- Addon overwrite attempts show a consistent Web OS approval dialog outside the
  sandbox frame.

Risk level:

- High. This mutates real Host files through delegated sandbox grants.

Files to inspect first:

- `server/static/webos-sandbox-sdk.js`
- `client/src/core/components/SandboxAppFrame.svelte`
- `server/routes/sandbox.js`
- `server/services/operationApprovalService.js`
- `server/tests/sandbox-sdk-contract.test.js`
- `server/tests/ticket-url-contract.test.js`

Implementation notes:

1. Keep `WebOS.files.write()`.
2. Remove `WebOS.files.approveWrite()` from the SDK, or keep a rejecting stub
   with code `WEBOS_APPROVAL_PARENT_ONLY`.
3. Remove `host.file.writeApprove` from the sandbox bridge permission map.
4. Prefer removing sandbox-exposed `writePreflight()` too. If retained for
   compatibility, it must be display-only and cannot provide a path to nonce
   issuance.
5. Add parent-frame approval state in `SandboxAppFrame.svelte`.
6. Bind sandbox write approval evidence to app id, host path, target hash, and
   grant context where practical.

First implementation slice:

- Remove or stub `WebOS.files.approveWrite()`, remove
  `host.file.writeApprove` from the bridge, and update SDK contract tests so
  sandbox-visible approval minting fails.

DoD:

- Sandbox code cannot obtain an approval nonce directly.
- Legacy `{ approved: true }` remains rejected.
- Overwrite approval is user-entered in parent-owned UI.
- Approval nonce is consume-once and target-hash scoped.
- Built-in sandbox package entries do not call `approveWrite()`.

Verification commands:

```bash
node --check server/static/webos-sandbox-sdk.js
node --check server/routes/sandbox.js
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
node --test --test-concurrency=1 server/tests/ticket-url-contract.test.js
npm run verify:ui-smoke
npm --prefix client run build
```

Rollback/safety notes:

- Prefer explicit compatibility failure over allowing sandbox self-approval.
- Existing packages that used `approveWrite()` must migrate to parent-mediated
  `WebOS.files.write({ overwrite: true })`.

Fallback path:

- Keep `writePreflight()` as display-only compatibility if needed, but remove
  nonce issuance from sandbox-visible APIs and return
  `WEBOS_APPROVAL_PARENT_ONLY` from `approveWrite()`.

### P1 - Addon Editor And Template Auto-confirm Cleanup

Selected item:

- Built-in Code Editor and generated package templates must not echo
  `preflight.approval.typedConfirmation`.

Problem:

- Code Editor paths and generated templates can still contain auto-confirm
  patterns that copy preflight approval text back into approve calls.

Why this matters:

- Trusted UI should make risky host overwrite intent explicit, and generated
  addon examples must not teach self-approval.

Metaphor:

- Templates are blueprints. If the blueprint shows a shortcut around approval,
  every generated room inherits the unsafe shortcut.

Layer(s):

- System Apps
- Addon Runtime/UI
- Sandbox / Package
- Docs / Verification

In scope:

- Trusted Code Editor file API and overwrite UI.
- Bundled sandbox editor package HTML.
- Inventory editor package HTML.
- Generated personal package templates and tests.

Out of scope:

- Monaco/editor feature work.
- Broad editor UX redesign.
- Unrelated package templates.

MVP behavior:

- Trusted non-sandbox Code Editor asks the user to type confirmation before
  host overwrite approval.
- Sandbox package Code Editor relies on parent-owned sandbox approval from P0.
- Generated templates do not scaffold approval self-confirmation code.

Files to inspect first:

- `client/src/apps/addons/code-editor/components/CodeEditorApp.svelte`
- `client/src/apps/addons/code-editor/services/fileApi.js`
- `client/src/apps/addons/code-editor/package/index.html`
- `server/storage/inventory/apps/editor/index.html`
- `server/routes/packages.js`
- `server/tests/sandbox-sdk-contract.test.js`
- `server/tests/package-personal-templates.integration.test.js`

Implementation notes:

1. Change trusted Code Editor `approveOverwrite()` helper to accept explicit
   user-entered typed confirmation.
2. Add an in-app typed confirmation dialog for trusted host overwrite.
3. Remove `approveWrite()` and auto `typedConfirmation` from sandbox package
   editor HTML.
4. Change generated `json-formatter` template to avoid self-approval. Prefer
   simple `sdk.files.write({ overwrite: true })` and parent-owned approval.
5. If the generated template does not need Host writes, remove Host path/grant
   write UI entirely.

First implementation slice:

- Change trusted Code Editor approval helper to require typed input, then add
  the smallest dialog/state needed to collect that value before approval.

Fallback path:

- If P0 lands first, let sandbox editors rely on
  `WebOS.files.write({ overwrite: true })` and only harden the trusted editor
  helper in this slice.

DoD:

- No built-in addon package entry contains `approveWrite`.
- No generated package template contains `typedConfirmation:
  preflight?.approval?.typedConfirmation`.
- Trusted editor overwrite requires user-entered confirmation.

Verification commands:

```bash
rg -n "approveWrite|typedConfirmation: .*preflight\\?\\.approval" \
  client/src/apps/addons server/storage/inventory/apps server/routes/packages.js
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
node --test --test-concurrency=1 server/tests/package-personal-templates.integration.test.js
npm --prefix client run build
```

### P2 - System App Typed-confirm Hardening

Selected item:

- System app approval flows must send actual user input, not a value derived
  from server preflight.

Problem:

- Transfer, Docker, and package-delete flows can approve by passing a
  server-derived expected confirmation instead of raw user-entered text.

Why this matters:

- Typed confirmation loses its protection if a client helper can satisfy it
  without the user typing the phrase.

Metaphor:

- Typed confirmation is a handwritten signature. Copying the printed label from
  the form is not a signature.

Layer(s):

- Host
- System Apps
- Docs / Verification

In scope:

- Transfer cloud-overwrite preflight, approve, and execute helpers.
- Docker Manager typed-confirm submit path.
- Package Center delete typed-confirm submit path.
- Smoke and focused regression guards for those flows.

Out of scope:

- New transfer engine design.
- Remote provider expansion.
- Package Center information architecture redesign.

MVP behavior:

- Transfer cloud overwrite, Docker actions, and Package delete all require
  typed input state before approving.
- API helpers do not combine preflight, approve, and execute in a way that
  makes auto-confirm easy to reintroduce.

Files to inspect first:

- `client/src/apps/system/transfer/TransferUI.svelte`
- `client/src/apps/system/transfer/api.js`
- `client/src/apps/system/docker-manager/DockerManager.svelte`
- `client/src/apps/system/package-center/PackageCenter.svelte`
- `client/src/apps/system/package-center/api.js`
- `tools/ui-smoke-gate.js`

Implementation notes:

1. Split Transfer cloud flow into:
   - `preflightCloudTransferJob(payload)`
   - `approveCloudTransferOverwrite(preflight, typedConfirmation)`
   - `createCloudTransferJob(payload, { approval })`
2. Add `cloudOverwriteTypedInput` and disable approve until it matches.
3. Send `typedConfirmation: cloudOverwriteTypedInput.trim()`.
4. In Docker Manager, send `typedConfirmation: approvalInput.trim()`.
5. In Package delete, send `typedConfirmation: packageDeleteTypedInput.trim()`.
6. Keep lifecycle install/import/rollback/manifest update on explicit typed
   input paths.

First implementation slice:

- Add `cloudOverwriteTypedInput`, pass that value to approval, and split or
  guard transfer helpers so execute cannot approve from expected confirmation.

Fallback path:

- If the transfer API split is too large, first replace auto-send in
  `TransferUI.svelte` and add a smoke guard against the old expression.

DoD:

- No system app sends `typedConfirmation` from a `preflight.approval` or
  `expectedConfirmation` variable without user input.
- Transfer helper cannot approve overwrite just because a caller passes a
  server-derived confirmation.

Verification commands:

```bash
rg -n "typedConfirmation: .*expectedConfirmation|typedConfirmation: .*preflight\\?\\.approval" client/src/apps/system
npm run verify:ui-smoke
node --test --test-concurrency=1 server/tests/cloud-upload-validation.test.js
node --test --test-concurrency=1 server/tests/docker-service.test.js
node --test --test-concurrency=1 server/tests/package-lifecycle-approval-contract.test.js
npm --prefix client run build
```

### P3 - Approval Regression Guards

Selected item:

- Dependency-free verification must catch approval self-confirmation
  regressions.

Problem:

- Current smoke coverage can prove markers exist while missing the exact
  auto-confirm patterns that created the risk.

Why this matters:

- The repository needs a cheap gate that fails before insecure approval
  patterns reach review again.

Metaphor:

- The smoke gate is a tripwire for known-dangerous shapes, so deeper tests do
  not have to rediscover the same approval mistake.

Layer(s):

- Docs / Verification
- Addon Runtime/UI
- System Apps

In scope:

- `tools/ui-smoke-gate.js` source-pattern guards.
- Focused server tests for wrong typed confirmation.
- Documentation of smoke limits and what must remain manually reviewed.

Out of scope:

- Full browser automation for destructive flows.
- Live destructive host operations in smoke tests.
- Replacing focused unit/contract tests with one broad harness.

MVP behavior:

- `npm run verify:ui-smoke` fails when production paths reintroduce
  `approveWrite()`, legacy approval flags, raw grant URLs, native prompts, or
  auto-typed-confirmation patterns.

Files to inspect first:

- `tools/ui-smoke-gate.js`
- `server/tests/sandbox-sdk-contract.test.js`
- `server/tests/cloud-upload-validation.test.js`
- `server/tests/docker-service.test.js`
- `server/tests/package-lifecycle-approval-contract.test.js`

Implementation notes:

1. Add `assertFileExcludes()` to `tools/ui-smoke-gate.js`.
2. Guard against:
   - `typedConfirmation: cloudOverwriteReview.expectedConfirmation`
   - `typedConfirmation: preflight?.approval?.typedConfirmation`
   - sandbox package entries calling `approveWrite`
   - generated templates containing `approved: true`
   - `rawUrl({ path, grantId })`
   - targeted native `confirm()` / `prompt()`
3. Add wrong typed-confirmation tests for cloud transfer, Docker approval, and
   package lifecycle approval.

First implementation slice:

- Add `assertFileExcludes()` and guard the known bad strings for auto typed
  confirmation, `approveWrite()`, and legacy approval flags.

Fallback path:

- If the smoke gate refactor is delayed, document equivalent narrow `rg`
  commands as temporary verification and keep them in the P-item DoD.

DoD:

- Smoke catches the self-approval patterns identified in the latest review.
- Focused server tests prove wrong typed confirmation does not issue a nonce.

Verification commands:

```bash
node --check tools/ui-smoke-gate.js
npm run verify:ui-smoke
npm test
```

### P4 - Docs And Readiness Score Sync

Selected item:

- Update readiness docs after P0-P3 are code-verified.

Problem:

- Readiness docs can drift from code after hardening work and overstate
  addon-only or core-freeze readiness.

Why this matters:

- Future agents need one current readiness conclusion, with residual risk tied
  to verified code behavior.

Metaphor:

- Readiness docs are the map. After the road changes, the map must change
  before the next driver follows it.

Layer(s):

- Docs / Verification

In scope:

- `AGENTS.md` task packet references.
- Active `doc/operations/` readiness and gap-resolution files.
- Score/status changes backed by verification output.
- Residual-risk wording for addon-only/core-freeze posture.

Out of scope:

- Rewriting all planning documents.
- Marketing/product roadmap docs.
- Claims not backed by code or verification output.

MVP behavior:

- Active docs state one current readiness conclusion and list remaining
  limitations without contradicting code.

Files to inspect first:

- `AGENTS.md`
- `doc/operations/home-server-readiness-gap-resolution-report-2026-04-26.md`
- `doc/operations/home-server-readiness-review-2026-04-26.md`
- `doc/operations/verification-gate-guide.md`

First implementation slice:

- After P0-P3 pass verification, update the readiness score table, completion
  notes, and remaining-risk list in the active operations docs.

Fallback path:

- If any P0-P3 item remains open, mark addon-only/core-freeze readiness as
  conditional and name the blocker explicitly.

DoD:

- Scores reflect code-verified behavior.
- Remaining risks are either explicit owner-only beta limits, disabled states,
  or new active backlog items.
- Addon-only/core-freeze posture is stated consistently.

Verification commands:

```bash
git status --short
rg -n "self-approval|auto-confirm|approveWrite|typedConfirmation" AGENTS.md doc/operations
git diff --check
```
## Expected Score Impact

If P0-P4 are completed and verified:

- Sandbox/addon write approval: `62 -> 82`
- Cloud transfer overwrite UX: `70 -> 82`
- Test/smoke coverage: `78 -> 84`
- Overall readiness: `82 -> 87-89`
- Addon-only/core-freeze readiness: `86 -> 89-91`

These improvements mainly reduce authenticated-user mistake risk, stale-tab
risk, and sandbox self-approval risk. They do not make direct public internet
exposure acceptable by themselves.

## Verification Commands

Use the narrowest relevant command first:

```bash
npm run verify:syntax
npm test
npm run verify
npm run verify:docker-config
npm run verify:ui-smoke
npm --prefix client run build
git diff --check
```
