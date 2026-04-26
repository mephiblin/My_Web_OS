# Home Server Readiness Gap Resolution Development Plan - 2026-04-26

Status: `[COMPLETE]`

Primary decision:

- VPN/internal owner-only beta operation is conditionally acceptable.
- Addon development may continue in parallel.
- Addon-only/core-freeze is conditionally declared because the gates in this
  document and the 2026-04-26 approval self-approval hardening pass are closed
  and verified.
- Direct public internet exposure remains out of scope until hardened deployment
  and real-use smoke coverage are verified.

## 1. User Intent Metadata

The user is not asking for a larger feature list. The user wants a credible
answer to this question:

```text
Can My Web OS be trusted as a personal home-server operations surface, and can
core work stop so development moves mainly to addons?
```

The expected answer must account for:

- VPN/internal access as the normal connection method.
- Home use and personal server administration, not enterprise SaaS.
- DSM-like expectations, while acknowledging this project cannot provide native
  OS/kernel-level isolation.
- Real Host impact from file operations, Docker actions, terminal sessions,
  cloud transfer, backup, package lifecycle, and shares.
- A practical decision: keep fixing core reliability/security gaps, or move to
  addon-first development.

This document is therefore an implementation plan, not a marketing readiness
summary. It converts the review findings into execution packets, DoD, and
verification commands.

## 2. Source Order

When sources disagree, use this order:

1. Code-verified behavior in the current working tree.
2. This development plan.
3. `doc/operations/home-server-readiness-review-2026-04-26.md`
4. `doc/operations/verification-gate-guide.md`
5. `doc/operations/remote-access-hardening-guide.md`
6. `doc/planning/implementation-priority-plan.md`
7. `doc/reference/architecture-api-reference.md`

`AGENTS.md` is intentionally reset to a lightweight template. Active backlog and
completion claims belong in this file or future `doc/operations/` plans.

## 3. Current Readiness Score

| 기준 | 점수 | 판정 |
| --- | ---: | --- |
| VPN/내부망 개인 홈서버 운영 | 8.3 / 10 | 조건부 가능 |
| DSM-like 일상 운영면 | 7.4 / 10 | 조건부 가능 |
| addon-only/core-freeze 준비도 | 90 / 100 | 조건부 가능 |
| 직접 공인 인터넷 노출 | N/A | hardened 검증 전 금지 |

Interpretation:

- The backend contract and targeted UI workflow are aligned for the gates in
  this document.
- Sandbox overwrite approval is parent-owned, and system-app typed confirmation
  no longer approves by echoing server-provided confirmation text.
- `npm run verify` passing is necessary but not sufficient for DSM-like
  readiness.
- Remaining work is future hardening: browser click-through automation,
  hardened deployment rehearsal, and ongoing platform contract maintenance.

## 4A. Approval Self-Approval Hardening Snapshot

Status: `[COMPLETE]` on 2026-04-26.

Code-verified behavior:

- Sandbox SDK `approveWrite()` no longer mints approval nonces for sandbox code.
- Sandbox frame owns overwrite approval collection and retries sandbox writes
  with scoped `{ operationId, nonce, targetHash }` evidence.
- Built-in sandbox editor packages and generated personal templates no longer
  call `approveWrite()` or echo `preflight.approval.typedConfirmation`.
- Trusted Code Editor overwrite approval now requires user-entered typed input.
- Transfer cloud overwrite, Docker actions, and Package delete submit trimmed
  user input instead of server-derived confirmation values.
- `npm run verify:ui-smoke` includes source guards for known self-approval and
  legacy approval patterns.

Score impact:

- Sandbox/addon write approval: `62 -> 82`
- Cloud transfer overwrite UX: `70 -> 82`
- Test/smoke coverage: `78 -> 84`
- Overall readiness: `82 -> 88`
- Addon-only/core-freeze readiness: `86 -> 90`

## 4. Last Verification Snapshot

Commands run during the completion pass:

```bash
npm run verify:syntax
npm test
npm run verify
npm run verify:docker-config
npm run verify:ui-smoke
git diff --check
```

Observed:

- `npm run verify:syntax`: passed.
- `npm test`: passed.
- `npm run verify`: passed.
- `npm run verify:docker-config`: passed.
- `npm run verify:ui-smoke`: passed after starting local backend/frontend dev
  servers.
- `git diff --check`: passed.
- Client build still reports large Monaco/Three chunk warnings.
- Focused gate tests passed for FS approval, sandbox ticket URLs, terminal
  approval, backup path boundaries, and transfer job durability.

Limits of this evidence:

- Current UI smoke is a source-contract and reachability gate, not browser
  click-through automation.
- UI smoke remains dependency-free source/reachability smoke, not full browser
  click-through workflow automation.

## 5. Development Gates

Addon-only/core-freeze is conditionally declared because all gates below are
closed.

| Gate | Status | Owner area |
| --- | --- | --- |
| G1 File Station approval UI completion | Closed | File Station / FS API |
| G2 Sandbox raw ticket contract cleanup | Closed | Sandbox / Addons |
| G3 Restore and archive extract approval | Closed | Host FS |
| G4 Backup path and local transfer durability | Closed | Backup / Transfer |
| G5 Terminal approval UX hardening | Closed | Terminal |
| G6 Real-use UI smoke upgrade | Closed | Verification |
| G7 Docs sync and final core-freeze decision | Closed | Docs / Verification |

## 6. Execution Queue

### G1 - File Station Approval UI Completion

Selected item:

- File Station destructive/write workflows must use the backend approval
  contract end to end.

Layer(s):

- Host
- System Apps
- Docs / Verification

MVP behavior:

- Delete, empty trash, and overwrite call backend preflight, display the server
  approval summary, approve with typed confirmation when required, then execute
  with `{ operationId, nonce, targetHash }`.

User-visible outcome:

- A user no longer sees a generic `428 approval required` after confirming an
  in-app dialog. The dialog itself becomes the approval workflow.

Risk level:

- High. These actions mutate real Host files.

Files to inspect first:

- `server/routes/fs.js`
- `server/services/operationApprovalService.js`
- `server/services/trashService.js`
- `client/src/apps/system/file-explorer/api.js`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `server/tests/fs-approval-contract.test.js`
- `tools/ui-smoke-gate.js`

In scope:

- `fs.delete`
- `fs.empty-trash`
- `fs.write.overwrite`
- structured error rendering for approval failures
- focused server tests and client build

Out of scope:

- Permanent delete UX beyond empty trash.
- Full browser automation; that is G6.

Implementation steps:

1. Add File Station API helpers:
   - `preflightDelete(path)`
   - `approveDelete(path, preflight)`
   - `executeDelete(path, approval)`
   - `preflightEmptyTrash()`
   - `approveEmptyTrash(preflight)`
   - `executeEmptyTrash(approval)`
   - `preflightOverwrite(path)`
   - `approveOverwrite(path, preflight)`
   - `executeOverwrite(path, content, approval)`
2. Replace direct destructive calls in `FileExplorer.svelte` with the helper
   sequence.
3. Render `impact`, `recoverability`, `target`, `typedConfirmation`, and
   `expiresAt` from the server preflight.
4. On stale approval or target hash mismatch, show a retryable preflight state.
5. Extend `tools/ui-smoke-gate.js` source guards to check concrete helper names,
   not only generic "approval" text.

DoD:

- Delete without approval remains blocked by backend.
- File Station delete succeeds through preflight/approve/execute.
- Empty trash succeeds through preflight/approve/execute.
- Overwrite succeeds only with scoped approval evidence.
- Legacy `{ approved: true }` does not execute overwrite.
- UI shows structured server error code/message.

Verification commands:

```bash
node --check server/routes/fs.js
node --test --test-concurrency=1 server/tests/fs-approval-contract.test.js
npm --prefix client run build
npm run verify:ui-smoke
```

Rollback/safety notes:

- Keep backend approval enforcement in place even if UI work is incomplete.
- Do not add a browser-only confirmation fallback.

### G2 - Sandbox Raw Ticket Contract Cleanup

Selected item:

- Sandbox package runtime must use raw tickets, not raw grant query URLs or old
  `rawUrl({ path, grantId })` calls.

Layer(s):

- Sandbox / Package
- Addon Runtime/UI
- Docs / Verification

MVP behavior:

- Built-in package entries call `WebOS.files.rawTicket()` and pass the result to
  `WebOS.files.rawUrl({ url })`.
- Legacy `/api/sandbox/:appId/file/raw` is removed or disabled with a structured
  `410`.

User-visible outcome:

- Document Viewer, Model Viewer, and Code Editor package runtime work with the
  current SDK contract.

Risk level:

- Medium to high. Raw file URLs carry delegated host file access.

Files to inspect first:

- `server/static/webos-sandbox-sdk.js`
- `server/routes/sandbox.js`
- `client/src/core/components/SandboxAppFrame.svelte`
- `client/src/apps/addons/document-viewer/package/index.html`
- `client/src/apps/addons/model-viewer/package/index.html`
- `client/src/apps/addons/code-editor/package/index.html`
- `server/tests/sandbox-sdk-contract.test.js`
- `server/tests/ticket-url-contract.test.js`

In scope:

- `rawTicket()` adoption in package HTML.
- Code Editor package overwrite approval contract.
- Legacy raw grant endpoint disablement.
- SDK tests.

Out of scope:

- Rewriting addon UI design.
- New addon capabilities.

Implementation steps:

1. Update Document Viewer package:
   - call `await WebOS.files.rawTicket({ path, grantId, profile: 'preview' })`.
   - pass returned payload to `WebOS.files.rawUrl(ticketResult)`.
2. Update Model Viewer package:
   - use raw ticket with media-oriented profile and timeouts.
3. Update Code Editor package:
   - replace `{ approved: true }` overwrite save with
     `writePreflight -> writeApprove -> write`.
4. Change `/api/sandbox/:appId/file/raw` to return
   `410 SANDBOX_RAW_GRANT_URL_DISABLED`, or remove it if no compatibility path
   is needed.
5. Add tests that fail on `rawUrl({ path, grantId })` in package entries.

DoD:

- No built-in package entry calls `rawUrl({ path, grantId })`.
- No built-in package entry sends overwrite approval as `{ approved: true }`.
- Raw file access from sandbox apps uses ticket URLs.
- Legacy raw grant query endpoint is disabled or gone.

Verification commands:

```bash
rg -n "rawUrl\\(\\{ path, grantId \\}|approved: true" client/src/apps/addons
node --check server/routes/sandbox.js
node --check server/static/webos-sandbox-sdk.js
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
node --test --test-concurrency=1 server/tests/ticket-url-contract.test.js
npm --prefix client run build
```

Rollback/safety notes:

- Prefer explicit failure over keeping a silent legacy bearer-like URL path.

### G3 - Restore And Archive Extract Approval

Selected item:

- Restore and archive extract must be treated as Host mutation workflows.

Layer(s):

- Host
- System Apps
- Docs / Verification

MVP behavior:

- Trash restore has preflight/approve/execute.
- Archive extract detects overwrite conflicts and requires scoped approval.

User-visible outcome:

- Users see restore/extract impact and conflicts before changing Host state.

Risk level:

- High. Restore and extract can create, move, or overwrite real files.

Files to inspect first:

- `server/routes/fs.js`
- `server/services/trashService.js`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `client/src/apps/system/file-explorer/api.js`
- `server/tests/fs-approval-contract.test.js`

In scope:

- Restore preflight/approval.
- Extract conflict preflight/approval.
- Path traversal and destination conflict checks.
- Focused tests.

Out of scope:

- Full archive manager UX.
- Non-ZIP archive formats.

Implementation steps:

1. Add `POST /api/fs/restore/preflight`.
2. Add `POST /api/fs/restore/approve`.
3. Make `POST /api/fs/restore` consume approval evidence.
4. Add `POST /api/fs/extract/preflight`.
5. Compute ZIP hash, entry list, destination paths, traversal blockers, and
   existing conflicts.
6. Execute extraction with overwrite disabled unless conflict approval is
   consumed.
7. Wire File Station restore/extract UI to the new contracts.

DoD:

- Restore without approval is blocked.
- Restore target conflict is explicit.
- Extract overwrite conflict is blocked without approval.
- Path traversal entries are rejected.
- Approval nonce cannot be replayed.

Verification commands:

```bash
node --check server/routes/fs.js
node --test --test-concurrency=1 server/tests/fs-approval-contract.test.js
npm --prefix client run build
```

Rollback/safety notes:

- Do not default to overwrite for archive extraction.
- Keep conflict details visible to the user.

### G4 - Backup Path And Local Transfer Durability

Selected item:

- Backup path validation and local transfer persistence must match the stronger
  Host boundary model.

Layer(s):

- Host
- System Apps
- Docs / Verification

MVP behavior:

- Backup source/destination validation is realpath-aware.
- Local transfer job store writes through tmp file then rename.

User-visible outcome:

- Symlink escapes are blocked for backup jobs.
- Transfer state is less likely to corrupt on backend interruption.

Risk level:

- Medium to high. Backup and transfer operate on real files and persistent job
  state.

Files to inspect first:

- `server/routes/system.js`
- `server/services/transferJobService.js`
- `server/services/cloudTransferJobService.js`
- `server/tests/security-boundary-contract.test.js`
- `server/tests/transfer-jobs.integration.test.js`

In scope:

- `resolveAndValidateBackupPath()` hardening.
- backup run-time revalidation.
- transfer job atomic persistence.
- corrupt transfer store recovery evidence if practical.

Out of scope:

- New backup scheduling engine.
- Remote backup provider expansion.

Implementation steps:

1. Add `assertWithinAllowedRealRoots()` to backup source/destination validation.
2. Revalidate saved backup job paths at run time.
3. Add symlink escape tests for backup source and destination.
4. Change local transfer persistence to sibling tmp write + rename.
5. If JSON parse fails, preserve corrupt file with timestamp and expose
   interrupted/recovered state.

DoD:

- Backup job create rejects symlink escape.
- Backup job run rejects paths that became unsafe after creation.
- Transfer job persistence is atomic.
- Transfer tests still pass.

Verification commands:

```bash
node --check server/routes/system.js
node --check server/services/transferJobService.js
node --test --test-concurrency=1 server/tests/security-boundary-contract.test.js
node --test --test-concurrency=1 server/tests/transfer-jobs.integration.test.js
```

Rollback/safety notes:

- Do not broaden `ALLOWED_ROOTS` to make old backup jobs work.
- Unsafe saved backup jobs should fail explicitly.

### G5 - Terminal Approval UX Hardening

Selected item:

- Terminal session approval is backend-enforced but should not auto-approve
  immediately after the start button.

Layer(s):

- Host
- System Apps
- Docs / Verification

MVP behavior:

- Start Shell requests preflight, shows impact/recoverability, requires typed
  confirmation, then approves and initializes the PTY session.

User-visible outcome:

- The user clearly acknowledges raw admin shell access before PTY spawn.

Risk level:

- High. Terminal is raw command execution.

Files to inspect first:

- `server/services/terminal.js`
- `client/src/apps/system/terminal/Terminal.svelte`
- `server/tests/terminal-approval-contract.test.js`

In scope:

- Terminal session approval UX.
- Error state for stale/invalid approval.

Out of scope:

- Parsing arbitrary shell input as a safety boundary.
- Per-command approval for manual interactive shell input.

Implementation steps:

1. Split Start Shell into preflight and approve UI states.
2. Render backend preflight evidence.
3. Require typed confirmation before `terminal:session-approve`.
4. Keep `terminal:init` blocked unless valid approval evidence is returned.

DoD:

- Terminal cannot spawn without backend approval.
- UI does not auto-approve session after a single click.
- Invalid/stale approval produces a visible error.

Verification commands:

```bash
node --check server/services/terminal.js
node --test --test-concurrency=1 server/tests/terminal-approval-contract.test.js
npm --prefix client run build
```

Rollback/safety notes:

- Backend enforcement must remain stricter than UI behavior.

### G6 - Real-use UI Smoke Upgrade

Selected item:

- Current UI smoke is source-marker based; add real workflow verification when a
  browser runner is available.

Layer(s):

- Web Desktop
- System Apps
- Docs / Verification

MVP behavior:

- Keep dependency-free smoke gate, but add stronger source guards now and define
  click-through targets for later.

User-visible outcome:

- Release checks catch workflow regressions earlier.

Risk level:

- Medium. This affects release confidence, not runtime behavior.

Files to inspect first:

- `tools/ui-smoke-gate.js`
- `doc/operations/verification-gate-guide.md`
- `doc/operations/local-run-guide.md`
- `client/src/core/Login.svelte`
- File Station, Package Center, Transfer UI, Sandbox frame.

In scope:

- Better source guards for the contracts introduced in G1-G5.
- Documentation of server prerequisites.

Out of scope:

- Adding a new dependency unless explicitly chosen.

Implementation steps:

1. Update source guards to check concrete approval helper names.
2. Add guards for raw ticket package entries.
3. Add guards for disabled legacy raw endpoint.
4. Document browser automation targets.

DoD:

- `npm run verify:ui-smoke` catches native prompt regression and missing workflow
  contract markers.
- Docs clearly state that click-through automation remains a future hardening
  enhancement unless implemented.

Verification commands:

```bash
npm run verify:ui-smoke
```

Rollback/safety notes:

- Do not execute destructive actions in dependency-free smoke.

### G7 - Docs Sync And Final Core-freeze Decision

Selected item:

- Reconcile readiness documents after G1-G6.

Layer(s):

- Docs / Verification

MVP behavior:

- Active docs agree on whether addon-only/core-freeze is declared.

User-visible outcome:

- Future contributors do not see contradictory active readiness conclusions.

Risk level:

- Low for runtime, high for project direction.

Files to inspect first:

- `AGENTS.md`
- `doc/operations/home-server-readiness-review-2026-04-26.md`
- this document
- `doc/operations/verification-gate-guide.md`
- `doc/operations/local-run-guide.md`
- `doc/operations/runtime-stability-notes-2026-04-26.md`

In scope:

- Status updates.
- Completion evidence.
- Known residual risks.

Out of scope:

- Rewriting all planning docs.

DoD:

- Full verification passes.
- Remaining risks are either disabled states, explicit owner-only beta limits, or
  new backlog items.
- Addon-only/core-freeze decision is stated once and consistently.

Verification commands:

```bash
git status --short
rg -n "addon-only|core-freeze|approval\\.approved|globalThis\\.(confirm|prompt)|\\bconfirm\\(|\\bprompt\\(|terminal:approval" AGENTS.md doc server client/src
npm run verify
npm run verify:docker-config
npm run verify:ui-smoke
git diff --check
```

Rollback/safety notes:

- Do not claim core-freeze if any G1-G6 gate is still open.

## 7. Global Acceptance Criteria

The project can move to addon-only/core-freeze because:

- G1 through G7 are closed.
- `npm run verify` passes.
- `npm run verify:docker-config` passes.
- `npm run verify:ui-smoke` passes with local servers.
- Focused approval and sandbox tests pass.
- No targeted production path uses native prompt for risky operations.
- No active built-in addon package entry uses legacy raw URL or approval flags.
- Runtime state files are ignored or intentionally tracked fixtures.
- Docs state one current readiness conclusion.

## 8. Development Notes

- Keep core changes limited to security, reliability, verification, performance,
  and platform contract maintenance.
- New user-facing expansion should normally land as packages/addons after these
  gates close.
- Backend contract comes before UI polish.
- UI dialogs explain intent; backend enforces safety.
- If implementation and docs disagree, update docs to code-verified behavior in
  the same work packet.

## 9. Final Recommendation

Completed in this order:

1. G1 File Station approval UI completion.
2. G2 Sandbox raw ticket contract cleanup.
3. G3 Restore and archive extract approval.
4. G4 Backup path and local transfer durability.
5. G5 Terminal approval UX hardening.
6. G6 Real-use UI smoke upgrade.
7. G7 Docs sync and final core-freeze decision.

Use this operating posture after this queue is closed:

- VPN/internal owner-only beta: allowed with explicit caution.
- Addon development: allowed only through current Host/file/package contracts.
- Addon-only/core-freeze: conditionally declared; keep core changes limited to
  bugfix/security/reliability/performance/verification/platform contract
  maintenance.
- Public internet exposure: not recommended.
