# Real-Use Remediation Plan

기준일: 2026-04-26

상태: `[ACTIVE]`

목적:

- 2026-04-26 프로젝트 평가에서 드러난 실사용 전 핵심 문제를 구현 가능한 작업 단위로 정리한다.
- 보안 경계, 위험 작업 승인, 사용자 오류 복구, 런처 일관성, 검증 게이트를 코어 freeze 전 우선 해결 대상으로 둔다.
- 외부 벤치마크는 공식 문서와 1차 자료를 기준으로 삼고, 구현은 현재 코드 검증 동작을 우선한다.

## 1) 평가 요약

종합 판단:

- 현재 프로젝트는 "개발 실험작" 단계는 넘었고 "개인 실사용 베타"에 가깝다.
- Package Center, sandbox runtime, file association, server integration test는 강점이다.
- 외부 노출 또는 실제 홈서버 운영 전에는 아래 5개 축을 먼저 닫아야 한다.

점수 기준:

- 유저 UX: `6.8 / 10`
- 프로젝트 안정성: `6.5 / 10`
- 코드 신뢰성/검증: `7.2 / 10`
- 완성도: `6.8 / 10`
- 종합: `6.8 / 10`

핵심 개선 축:

1. 보안 안정화: 정적 inventory 공개, query token, 로그 민감값, symlink 경계.
2. 위험 작업 approval contract 통일.
3. UX 신뢰성: `apiFetch` 에러 보존, 오류/빈 상태 표준화.
4. 런처 통합: Spotlight와 app registry/file association 통합.
5. 검증 게이트: `verify`, frontend smoke, CI.

## 2) 벤치마크 Sources

보안/경계:

- OWASP REST Security Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html>
- OWASP Path Traversal: <https://owasp.org/www-community/attacks/Path_Traversal>
- Express static files: <https://expressjs.com/en/starter/static-files.html>
- Node.js `fs.realpath` / `fs.lstat`: <https://nodejs.org/api/fs.html>

승인/재인증:

- OWASP Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP Transaction Authorization Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>

오류 계약/접근성:

- RFC 9457 Problem Details for HTTP APIs: <https://datatracker.ietf.org/doc/html/rfc9457>
- GOV.UK Design System Error Message: <https://design-system.service.gov.uk/components/error-message/>
- W3C ARIA live error technique: <https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA19>

런처/검색 UX:

- VS Code Command Palette UX Guidelines: <https://code.visualstudio.com/api/ux-guidelines/command-palette>
- VS Code Quick Picks UX Guidelines: <https://code.visualstudio.com/api/ux-guidelines/quick-picks>

검증:

- GitHub Actions Node.js build/test: <https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs>
- Playwright Best Practices: <https://playwright.dev/docs/best-practices>
- Testing Library Guiding Principles: <https://testing-library.com/docs/guiding-principles/>

## 3) Remediation Item 1 - Security Boundary Stabilization

Layer(s):

- `Host`
- `Sandbox / Package`
- `Home Server Operations`
- `Remote Computer UX`

Problem:

- `/api/inventory-files`가 inventory root 전체를 정적으로 노출한다.
- query token과 `grantId`가 URL, browser history, proxy/server logs에 남을 수 있다.
- request logger가 전체 URL을 그대로 출력한다.
- 일부 path boundary가 `path.resolve` 문자열 비교 중심이라 symlink 우회 위험이 남는다.

Current touchpoints:

- `server/index.js`
  - request logger.
  - `/api/inventory-files`.
  - `/api/media-library-files`.
- `server/middleware/auth.js`
  - `req.query.token` fallback.
- `server/routes/sandbox.js`
  - raw file streaming query `grantId`.
- `server/utils/pathPolicy.js`
- `server/utils/appPaths.js`
- `server/middleware/pathGuard.js`
- `server/routes/fs.js`
- `server/routes/media.js`

Benchmark interpretation:

- OWASP REST guidance treats sensitive tokens in URLs as unsafe because URLs are frequently logged, cached, copied, and forwarded.
- `express.static(root)` is a broad file-server primitive. It should only expose public assets, not mixed internal state.
- Node `realpath` resolves symlinks to actual filesystem targets; `lstat` can detect a symlink before following it. Host path policy should use both when path traversal or root containment matters.

Target contract:

```text
Public static file route = explicit public asset allowlist only
Internal inventory state = authenticated API only
Host file access = allowed root + realpath containment + symlink policy
Authentication token = Authorization header only
Temporary file URL = short-lived ticket, redacted in logs
Request log = method + redacted path/query + status + duration
```

Implementation guide:

1. Replace broad `/api/inventory-files` with a package asset route.
   - Allow only paths needed by sandbox package static assets.
   - Deny `manifest.json`, lifecycle files, registry files, backup files, app data, and system inventory.
   - Run auth before serving unless the asset route is backed by a separate expiring asset ticket.
2. Remove `req.query.token` from normal auth.
   - Keep `Authorization: Bearer <token>` as the default.
   - If a URL-based flow is unavoidable for browser media tags, issue short-lived tickets through authenticated `POST`.
3. Replace query `grantId` raw file access with one of:
   - authenticated fetch using Authorization header, or
   - `POST /api/sandbox/:appId/file/raw-ticket` returning a short TTL, range-compatible ticket URL.
4. Add URL redaction helper.
   - Redact keys: `token`, `grantId`, `ticket`, `code`, `secret`, `password`, `authorization`.
   - Apply to request logger and any explicit route logs.
5. Add realpath/lstat boundary utility.
   - Resolve allowed roots to real paths at startup or cache with invalidation.
   - For read/write/delete/sendFile, verify the final real target remains under an allowed real root.
   - Decide symlink policy per route:
     - default: reject symlink traversal for host operations.
     - explicit allow: only if manifest/route grants opt into following symlinks.

Acceptance criteria:

- No route exposes inventory root as a generic static directory.
- Tokens and grants no longer appear in normal request URLs.
- Request logs redact known sensitive query keys.
- Path tests cover symlink from allowed root to outside root.
- Sandbox package assets still load.
- Existing file grant tests continue to pass.

Verification:

```bash
node --check server/index.js
node --check server/middleware/auth.js
node --check server/routes/sandbox.js
node --check server/utils/pathPolicy.js
npm test
```

Residual risk:

- Browser-native media/image tags cannot attach Authorization headers in every context. Ticket URLs may still be needed, but they must be short-lived and log-redacted.

## 4) Remediation Item 2 - Risky Operation Approval Contract

Layer(s):

- `Host`
- `Sandbox / Package`
- `Home Server Operations`
- `Remote Computer UX`
- `Agent / Automation`

Problem:

- Some risky operations still execute with only a normal authenticated session.
- Current approval UX is inconsistent across package delete, rollback, Docker operations, file delete/overwrite, empty trash, and terminal actions.
- Native `confirm()` / `prompt()` is not enough for auditable operations.

Current touchpoints:

- `server/routes/packages.js`
  - package delete.
  - rollback.
  - import/update overwrite.
  - manifest update.
- `server/routes/docker.js`
  - restart/remove/stop.
- `server/routes/fs.js`
  - delete.
  - write overwrite.
  - empty trash.
- `server/services/auditService.js`
- `client/src/apps/system/package-center/PackageCenter.svelte`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `client/src/apps/system/docker-manager/DockerManager.svelte`
- `client/src/apps/system/terminal/Terminal.svelte`
- `client/src/core/components/Agent.svelte`

Benchmark interpretation:

- OWASP reauthentication guidance says sensitive features should require renewed intent, not only a pre-existing session.
- Transaction authorization separates "who is logged in" from "did this user approve this exact high-risk transaction".

Target contract:

```text
Risky operation = preflight + scoped approval + execute + audit

preflight:
  input target/action
  validate permission and current state
  return risk, impact, recoverability, backup evidence, operationId, expiresAt

approval:
  user confirms exact target and impact
  optional typed confirmation for destructive actions
  server issues nonce scoped to user/action/target/hash/TTL

execute:
  require nonce + expected target hash + optional reason
  revalidate current state
  perform operation
  write audit success/failure
```

Recommended response shape:

```json
{
  "operationId": "pkg-delete:editor:...",
  "action": "package.delete",
  "target": {
    "type": "package",
    "id": "editor",
    "label": "Code Editor"
  },
  "riskLevel": "high",
  "impact": [
    "Package files will be removed.",
    "App data may be removed depending on policy.",
    "Open With defaults will be cleared."
  ],
  "recoverability": {
    "backupAvailable": true,
    "latestBackupId": "backup-...",
    "rollbackSupported": true
  },
  "approval": {
    "required": true,
    "typedConfirmation": "editor",
    "expiresAt": "2026-04-26T00:00:00.000Z"
  }
}
```

Implementation guide:

1. Add a small approval service.
   - Name candidate: `server/services/operationApprovalService.js`.
   - Store short-lived nonce in memory or state store, depending on restart requirements.
   - Bind nonce to user id, action, target id, target hash, createdAt, expiresAt.
2. Introduce preflight endpoints before changing all operations.
   - `POST /api/packages/:id/delete/preflight`
   - `POST /api/packages/:id/rollback/preflight` already exists and can be aligned.
   - `POST /api/fs/delete/preflight`
   - `POST /api/fs/empty-trash/preflight`
   - `POST /api/docker/containers/:id/remove/preflight`
3. Update execute endpoints to require approval where risk is high.
4. Standardize audit event fields.
   - `operationId`
   - `action`
   - `target`
   - `riskLevel`
   - `approval`
   - `result`
   - `recoverability`
5. Replace browser native confirmations with in-app approval panels.
   - Show target, exact impact, backup/rollback state, and audit notice.
   - Disable execute until typed confirmation matches when required.

Acceptance criteria:

- Package delete cannot execute silently.
- Rollback and empty trash have preflight and approval evidence.
- Docker destructive actions require approval if Docker is enabled.
- Audit log includes approval result and target.
- UI no longer relies on native `confirm()` for high-risk operations.

Verification:

```bash
node --check server/routes/packages.js
node --check server/routes/fs.js
node --check server/routes/docker.js
node --check server/services/auditService.js
npm test
cd client && npm run build
```

Residual risk:

- Approval contract should not become a click-through form. For high impact operations, typed target confirmation and short TTL should remain required.

## 5) Remediation Item 3 - API Error And UI State Standardization

Layer(s):

- `Web Desktop`
- `App Install / File Workflow`
- `Sandbox / Package`
- `Remote Computer UX`

Problem:

- `client/src/utils/api.js` currently throws `Error(message)` and drops server `code`, `details`, and validation payloads.
- Server routes mix `{ error, message }` and `{ error, code, message }`.
- Empty, loading, error, retry, and permission-denied states are inconsistent across Desktop, File Explorer, Package Center, and sandbox apps.

Current touchpoints:

- `client/src/utils/api.js`
- `client/src/core/Desktop.svelte`
- `client/src/core/Spotlight.svelte`
- `client/src/core/components/SandboxAppFrame.svelte`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `client/src/apps/system/package-center/PackageCenter.svelte`
- `client/src/apps/system/transfer/TransferUI.svelte`
- `server/routes/*`

Benchmark interpretation:

- RFC 9457 gives a standard shape for HTTP API problem details.
- GOV.UK error guidance emphasizes concrete, user-actionable error text near the source of failure.
- ARIA live regions make dynamic validation and error changes visible to assistive technology.

Target client contract:

```js
class ApiError extends Error {
  status
  code
  details
  validation
  retryAfter
  requestId
  payload
}
```

Target server response:

```json
{
  "error": true,
  "code": "PACKAGE_NOT_FOUND",
  "message": "Package was not found.",
  "details": null,
  "requestId": "req_..."
}
```

RFC 9457-compatible extension:

```json
{
  "type": "https://webos.local/problems/package-not-found",
  "title": "Package not found",
  "status": 404,
  "detail": "Package was not found.",
  "code": "PACKAGE_NOT_FOUND",
  "details": null
}
```

Implementation guide:

1. Update `apiFetch`.
   - Preserve `status`, `code`, `message`, `details`, `validation`, `retryAfter`, `payload`.
   - Keep backward compatibility with existing callers expecting thrown `Error`.
2. Add helpers.
   - `isApiError(err)`
   - `getErrorCode(err)`
   - `getUserFacingMessage(err, fallback)`
3. Add shared UI state components.
   - Candidate path: `client/src/core/components/AsyncState.svelte` or separate `ErrorState.svelte`, `EmptyState.svelte`, `LoadingState.svelte`.
   - Include retry button slot and `aria-live`.
4. Convert high-visibility flows first.
   - Desktop app registry load.
   - Spotlight search failure.
   - File Explorer directory/search empty state and grant creation failure.
   - Package Center registry source/import/preflight failures.
5. Align server error responses incrementally.
   - Do not block on converting every route at once.
   - Prioritize routes used by the above UI flows.

Acceptance criteria:

- UI can branch on `err.code`.
- File grant creation failure does not silently open an app without usable access.
- Desktop app list failure shows retry, not a silent empty app list.
- File Explorer empty folder and empty search states are explicit.
- Package Center error messages include operation context and retry where useful.

Verification:

```bash
node --check client/src/utils/api.js
cd client && npm run build
npm test
```

Residual risk:

- Server route conversion can be incremental, but client code should tolerate both legacy and structured payloads during migration.

## 6) Remediation Item 4 - Spotlight Launcher Contract Unification

Layer(s):

- `Web Desktop`
- `App Install / File Workflow`
- `Sandbox / Package`
- `Remote Computer UX`

Problem:

- Spotlight uses a hardcoded app list and does not reflect `/api/system/apps`.
- Package-installed sandbox apps may be missing from Spotlight.
- File results open the editor directly and bypass file association logic.
- Mock system actions like reboot/shutdown weaken trust in the launcher.

Current touchpoints:

- `client/src/core/Spotlight.svelte`
- `client/src/core/Desktop.svelte`
- `client/src/core/appLaunchRegistry.js`
- `client/src/core/stores/startMenuStore.js`
- `client/src/core/stores/windowStore.js`
- `client/src/apps/system/file-explorer/services/fileAssociations.js`
- `client/src/apps/system/file-explorer/api.js`

Benchmark interpretation:

- VS Code Command Palette and Quick Pick patterns center on one searchable command surface backed by the same command registry used elsewhere.
- Search results should expose enough detail to distinguish app, file, folder, command, and risky action.
- Disabled or unavailable commands should be explicit, not mock-executed.

Target contract:

```text
Spotlight result types:
  app      -> openAppById(appId, data)
  file     -> resolve file association -> open target app with grant/data
  folder   -> open File Station at path
  command  -> execute registered command or show unavailable state
  setting  -> open Control Panel/Settings section

Source of truth:
  apps     = /api/system/apps or shared desktop app store
  files    = File Explorer search API
  commands = explicit command registry
```

Implementation guide:

1. Extract app registry load from Desktop into a shared store/service.
   - Candidate: `client/src/core/stores/appRegistryStore.js`.
   - Desktop, Start Menu, Spotlight should read the same normalized app list.
2. Pass an app launcher function to Spotlight.
   - Avoid `openWindow(item)` for app results.
   - Use `openAppById(app.id, data)` so sandbox/package/component launch stays consistent.
3. Reuse file association resolution.
   - Spotlight file result should call the same helper File Explorer uses to choose target app/action.
   - Grant creation errors should block open and show a structured error.
4. Model commands explicitly.
   - Hide reboot/shutdown until implemented, or mark as unavailable.
   - Risky system commands should route through the approval contract.
5. Improve result metadata.
   - Group labels: Apps, Files, Folders, Commands.
   - Show package/system badge, file path, and disabled reason.

Acceptance criteria:

- Installing a package app makes it discoverable in Spotlight without hardcoding.
- Sandbox package app launches from Spotlight with the same launch contract as Start Menu.
- File results honor default app and Open With association.
- Mock command toasts are removed from real user flows.

Verification:

```bash
cd client && npm run build
```

Recommended future smoke:

```text
Open Spotlight -> search Package Center -> launch
Open Spotlight -> search installed package app -> launch sandbox frame
Open Spotlight -> search text file -> open with default association
```

Residual risk:

- Desktop currently owns `openAppById`; extracting shared registry/launcher should be done carefully so `Desktop.svelte` remains orchestration-only.

## 7) Remediation Item 5 - Verification Gate And Frontend Regression Coverage

Layer(s):

- `Docs / Verification`
- `Web Desktop`
- `Sandbox / Package`
- `Home Server Operations`

Problem:

- Root `npm test` currently exercises server tests only.
- Client verification is mostly `vite build`.
- No visible CI gate is present.
- Package doctor warnings can be accepted indefinitely.
- Docker and backup rehearsal checks are documented but not part of a single repeatable verification command.

Current touchpoints:

- `package.json`
- `client/package.json`
- `tools/package-doctor.js`
- `tools/migrate-apps-registry.js`
- `tools/rehearse-storage-backup-restore.sh`
- `tools/station-real-use-snapshot.js`
- `.github/workflows/` if introduced.
- `doc/operations/runtime-stability-notes-2026-04-26.md`

Benchmark interpretation:

- GitHub Actions Node CI should run install, tests, and build on PR/push.
- Playwright recommends testing user-visible behavior using role/text/test ids rather than brittle implementation selectors.
- Testing Library's principle is that tests should resemble how users use the software.

Target contract:

```text
npm run verify =
  backend syntax checks
  server tests
  registry/package checks
  client build
  optional docker config check

npm run verify:ci =
  deterministic subset suitable for pull requests

npm run smoke:ui =
  Playwright browser smoke for critical user flows
```

Implementation guide:

1. Add root scripts.
   - `verify:syntax`
   - `verify:packages`
   - `verify:client`
   - `verify`
   - optional `verify:docker-config`
2. Add Playwright smoke after core security/UX changes.
   - Desktop loads.
   - Package Center opens.
   - File Explorer empty state renders.
   - Sandbox package launches or shows explicit bridge error.
   - Spotlight launches app through registry.
3. Add CI workflow.
   - `npm ci`
   - `npm test`
   - `npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json`
   - `cd client && npm ci && npm run build`
4. Add release strictness.
   - `package:doctor --strict-warnings` or `package:doctor:release`.
   - Keep current warning-tolerant behavior for local development.
5. Harden operations scripts.
   - `rehearse-storage-backup-restore.sh`: dry-run, explicit confirmation, isolated compose project/volume by default, trap cleanup.
   - `migrate-apps-registry.js`: dry-run, backup current file before `--force`, show diff.

Acceptance criteria:

- A single command can reproduce the minimum release gate.
- CI enforces server tests, package doctor, and client build.
- UI smoke catches blank desktop, broken launcher, and broken Package Center before manual testing.
- Destructive rehearsal tools have dry-run and confirmation safeguards.

Verification:

```bash
npm run verify
```

Residual risk:

- Playwright smoke needs stable test data. Prefer deterministic fixture data under tracked inventory paths and avoid relying on local generated runtime state.

## 8) Recommended Implementation Order

1. Security boundary stabilization.
   - 이유: inventory/static/token/log exposure는 외부 접근 전에 먼저 닫아야 한다.
2. API error and UI state standardization.
   - 이유: 이후 approval, launcher, smoke test가 모두 structured error에 의존한다.
3. Risky operation approval contract.
   - 이유: 서버 계약과 UI approval panel을 함께 맞춰야 하며, 고위험 작업 방어 효과가 크다.
4. Spotlight launcher contract unification.
   - 이유: 설치된 패키지 앱이 자연스럽게 검색/실행되어야 package-first 방향과 맞는다.
5. Verification gate and frontend regression coverage.
   - 이유: 위 변경들이 반복 작업 중 회귀하지 않도록 release gate로 고정한다.

## 9) Work Packet Breakdown

### P0 Security Boundary Work Packet

Selected item:

- `RUR-1-security-boundary`

Layer(s):

- `Host`
- `Sandbox / Package`
- `Home Server Operations`

Files to inspect first:

- `server/index.js`
- `server/middleware/auth.js`
- `server/routes/sandbox.js`
- `server/utils/pathPolicy.js`
- `server/utils/appPaths.js`
- `server/middleware/pathGuard.js`

Planned API/contract changes:

- Remove normal query token auth.
- Add redacted URL logger.
- Replace broad inventory static route with narrow asset route or authenticated route.
- Add symlink-aware containment helper.

Verification commands:

```bash
node --check server/index.js
node --check server/middleware/auth.js
node --check server/routes/sandbox.js
npm test
```

Rollback/safety notes:

- Keep package asset loading testable before removing static route.
- If browser media previews need URL access, introduce temporary ticket route before deleting old behavior.

### P1 Error Contract Work Packet

Selected item:

- `RUR-2-api-error-state`

Layer(s):

- `Web Desktop`
- `Remote Computer UX`

Files to inspect first:

- `client/src/utils/api.js`
- `client/src/core/Desktop.svelte`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`
- `client/src/apps/system/package-center/PackageCenter.svelte`

Planned API/contract changes:

- `ApiError` preserving `status/code/details/validation`.
- Common error/empty/retry state components.
- Incremental route error shape alignment.

Verification commands:

```bash
node --check client/src/utils/api.js
cd client && npm run build
npm test
```

Rollback/safety notes:

- Preserve `err.message` compatibility for existing callers.

### P2 Approval Contract Work Packet

Selected item:

- `RUR-3-risk-approval`

Layer(s):

- `Host`
- `Sandbox / Package`
- `Home Server Operations`
- `Agent / Automation`

Files to inspect first:

- `server/routes/packages.js`
- `server/routes/fs.js`
- `server/routes/docker.js`
- `server/services/auditService.js`
- `client/src/apps/system/package-center/PackageCenter.svelte`
- `client/src/apps/system/file-explorer/FileExplorer.svelte`

Planned API/contract changes:

- Preflight + approval nonce + execute pattern.
- Audit operation schema.
- Approval modal replacing native confirmation for high-risk actions.

Verification commands:

```bash
node --check server/routes/packages.js
node --check server/routes/fs.js
node --check server/routes/docker.js
npm test
cd client && npm run build
```

Rollback/safety notes:

- Start with package delete or empty trash, then generalize.

### P3 Spotlight Contract Work Packet

Selected item:

- `RUR-4-spotlight-launcher`

Layer(s):

- `Web Desktop`
- `App Install / File Workflow`
- `Sandbox / Package`

Files to inspect first:

- `client/src/core/Spotlight.svelte`
- `client/src/core/Desktop.svelte`
- `client/src/core/appLaunchRegistry.js`
- `client/src/apps/system/file-explorer/services/fileAssociations.js`

Planned API/contract changes:

- Shared app registry store/service.
- Spotlight app launch through same app id launcher as Start Menu/Desktop.
- File result open through file association.

Verification commands:

```bash
cd client && npm run build
```

Rollback/safety notes:

- Keep Desktop as orchestration-only; do not move business logic into `Desktop.svelte`.

### P4 Verification Gate Work Packet

Selected item:

- `RUR-5-verify-gate`

Layer(s):

- `Docs / Verification`
- `Web Desktop`
- `Sandbox / Package`

Files to inspect first:

- `package.json`
- `client/package.json`
- `tools/package-doctor.js`
- `.github/workflows/`
- `doc/operations/local-run-guide.md`

Planned API/contract changes:

- None.

Verification commands:

```bash
npm run verify
```

Rollback/safety notes:

- Keep heavy Docker compose smoke optional so routine local verification remains fast.

## 10) Reporting Template

Each remediation item completion report must include:

- changed files
- behavior change
- security/UX contract change
- verification evidence
- skipped verification with reason
- remaining risks
- next recommended item
