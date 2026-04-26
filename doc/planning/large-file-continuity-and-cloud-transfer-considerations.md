# Large File Continuity And Cloud Transfer Plan

기준일: 2026-04-26

상태: `[ACCEPTED]`

결정 수준:

- 이 문서는 장시간 파일 열람, 미디어 스트리밍, 공유 다운로드, cloud/WebDAV/rclone 백업의 제품/아키텍처 방향을 확정한다.
- 세부 route name, request/response schema, UI 컴포넌트 배치는 각 `LFC-*` 구현 패킷에서 코드 검증 기준으로 확정한다.
- 구현 중 코드와 문서가 충돌하면 현재 코드 검증 동작을 우선하고, 이 문서를 같은 작업 패킷에서 갱신한다.

## 0) Final Decision

My Web OS는 대용량/장시간 작업을 하나의 긴 TTL, 하나의 query token, 하나의 사용자 세션, 하나의 background job 모델로 합치지 않는다.

확정된 continuity model:

```text
Preview raw ticket
  small preview/export handoff
  short TTL, scoped, memory-only, reacquirable

Media stream lease
  video/audio/large document/object open
  idle timeout, absolute max TTL, Range response, frontend reacquire

Share download
  public/guest file access
  share expiry, Range/resume, audit, optional password/count/rate policy

Durable cloud/backup job
  rclone/WebDAV/Google Drive/local backup/restore
  persistent job store, checkpoint, restart recovery, quota/backoff state
```

Core rule:

```text
Do not stretch a preview ticket into a streaming or backup model.
Do not copy a long Synology-style authenticated session lifetime into a raw file URL.
Do not make cloud/backup depend on a browser tab, media lease, or file ticket.
```

## 1) Product Experience: Transparent Wings

Target experience:

- Users open a large file and it just opens.
- Users pause, seek, or resume media and it just continues.
- Users start a backup and can close the browser tab.
- Users return after backend restart and see clear job state, not lost work.
- Users do not need to understand tickets, leases, TTL, Range, retries, rclone, quota, or partial files.

Internal obligation:

- Web OS handles lease refresh, retry, resume, checkpoint, and state recovery.
- UI stays quiet while recovery is automatic.
- UI becomes explicit only when user intent or operator action is required:
  - risky overwrite/delete/rollback/command/install/update/remove
  - provider quota pause
  - missing rclone/provider setup
  - unrecoverable file mutation
  - destination conflict
  - authentication or permission failure

This is the "transparent wings" standard: continuity should feel natural to the user, but the system must still keep security, audit, approval, and recovery visible where they matter.

## 2) Planning Constraints

From `doc/planning/product-brief-home-server-remote-computer.md`:

- My Web OS is a personal Home Server and Remote Computer platform.
- File system, terminal, Docker, and service control affect the real machine.

From `doc/planning/app-install-file-workflow-direction.md`:

```text
File Station owns local file selection and path intent.
Apps own focused workflows.
Web OS owns permissions, approval, audit, lifecycle, and recovery.
Package Center owns install/update/remove/runtime health.
```

From `doc/planning/real-use-remediation-plan.md`:

- query token and grant leakage through URLs/logs is a security boundary issue.
- browser-native media/image contexts may need opaque temporary URLs.
- those URLs must be scoped, short enough for purpose, and log-redacted.

From `doc/planning/implementation-priority-plan.md`:

- core work should remain `bugfix/security/perf/reliability` oriented.
- new user value should normally land in packages/addons.

## 3) Non-Negotiable Architecture Decisions

| Decision | Policy |
| --- | --- |
| Normal auth | `Authorization: Bearer <token>`, not query JWT |
| Browser file URL | opaque scoped ticket/lease only, never full JWT |
| Log handling | redact `token`, `grantId`, `ticket`, `code`, `secret`, `password`, `authorization` |
| Host boundary | backend validates path, appId, scope, grant, manifest/runtime boundaries |
| Media continuity | memory-only media lease in first implementation, frontend reacquires after expiry/restart |
| Range behavior | large local open/download must be Range-compatible and tested with `206 Partial Content` |
| Share links | separate public policy, not media lease reuse |
| Cloud/backup | durable server-side job, no browser ticket dependency |
| Risky writes | approval, audit, and recoverability still required |
| Partial writes | never silently overwrite; use temp/partial policy plus explicit retry/cleanup |

## 4) Continuity Model Matrix

| Flow | Examples | User expectation | Internal model | First implementation default |
| --- | --- | --- | --- | --- |
| Preview raw ticket | thumbnail, small image/PDF preview, package export handoff | preview opens quickly | short scoped ticket | 5 min default, 10 min max, memory-only |
| Media stream lease | video/audio, large PDF/object viewer, repeated seek | pause/seek works naturally | purpose-bound lease | idle 45 min, absolute 8 h, memory-only + reacquire |
| Share download | public download link | recipient can resume large download | share policy | expiry at request start, Range/resume, audit |
| Cloud/backup job | rclone copy/sync, WebDAV/Drive backup, restore | job continues without browser | durable job store | persistent state, restart -> interrupted/reconciled |

## 5) Detailed Models

### A) Preview Raw Ticket

Use for:

- thumbnails
- quick image/PDF preview
- short package export handoff
- small direct-open flows that can cheaply request a new URL

Default policy:

```text
profile: preview
ttl: 5 minutes default
max ttl: 10 minutes
scope: fs.raw or package.export
bound to: user, path, appId/scope
storage: memory-only
restart behavior: old URL fails; caller requests a new one
```

Expected errors:

- `FILE_TICKET_INVALID`
- `FILE_TICKET_SCOPE_MISMATCH`
- `FILE_TICKET_TARGET_MISMATCH`
- `FS_PATH_NOT_FOUND`
- `FS_ACCESS_DENIED`

Required tests:

- expired ticket returns structured 403.
- different scope cannot redeem the ticket.
- different appId cannot redeem the ticket.
- logs redact `ticket`.

### B) Media Stream Lease

Use for:

- video/audio playback
- PDF/object viewer issuing repeated Range requests
- large local file open where the browser may retry, seek, or pause for a long time

Default policy:

```text
profile: media
idle timeout: 45 minutes
absolute max ttl: 8 hours
configurable range: idle 30-60 minutes, absolute 6-12 hours
storage: memory-only for first implementation
on successful Range/full request: update lastAccess
bound to: user, path, appId/scope, purpose=media
file mutation binding: size + mtime in first implementation
restart behavior: old URL fails; frontend reacquires a new lease
```

Decisions:

- Media lease is not a broad user session.
- Media lease is not a public share link.
- Media lease may be implemented in the same service as raw tickets, but the profile and validation must be explicit.
- Backend restart does not preserve media leases in the first implementation.
- Frontend recovery is mandatory: on lease expiry/restart, reacquire once and restore current media position when possible.
- A changed `size + mtime` should invalidate the lease and return a clear target-changed error instead of silently streaming a different file.
- 24-hour trusted LAN media lease is deferred, not a first implementation default.

Expected errors:

- `FS_MEDIA_LEASE_INVALID`
- `FS_MEDIA_LEASE_EXPIRED`
- `FS_MEDIA_LEASE_IDLE_TIMEOUT`
- `FS_MEDIA_LEASE_TARGET_CHANGED`
- `FS_PATH_NOT_FOUND`
- `FS_ACCESS_DENIED`

Required tests:

- `Range: bytes=0-99` returns `206 Partial Content`.
- video seek after idle activity but before absolute max works.
- request after idle timeout fails clearly or triggers frontend refresh.
- request after backend restart fails, then frontend reacquires.
- copied URL cannot access another path.
- changed `size + mtime` invalidates the lease.

### C) Share Download Policy

Use for:

- public/guest file download links
- user-created file sharing
- large downloads that may need browser resume

Default policy:

```text
share expiry: user-selected hours/days
expiry check: at request start
active response after expiry: allowed to finish for first implementation
new request after expiry: rejected
download response: Range/resume-capable
path check: revalidate path exists and remains allowed
audit: share id, path, ip/user-agent, result
schema-ready optional policy: password, download count, rate limit
```

Decisions:

- Share download never reuses media lease.
- Share identity is public-link identity, not logged-in user session identity.
- Directory share is rejected until a deliberate archive/package policy exists.
- Password, download count, and rate limit are part of the final model, but can be staged after Range/expiry/audit if external exposure is blocked.
- If the file is moved/deleted after share creation, download returns a clear expired/not-found style response and writes audit evidence.

Expected errors:

- `SHARE_NOT_FOUND`
- `SHARE_EXPIRED`
- `SHARE_TARGET_NOT_FOUND`
- `SHARE_DIRECTORY_UNSUPPORTED`
- `SHARE_RATE_LIMITED`
- `SHARE_PASSWORD_REQUIRED`

Required tests:

- large share download supports `Range`.
- expired share rejects new requests.
- response started before expiry has defined behavior.
- directory share is rejected.
- deleted/moved target gives clear error and audit.

### D) Durable Cloud / Backup Job

Use for:

- Google Drive/WebDAV/S3 backup
- rclone copy/sync/move
- local-to-cloud upload
- cloud-to-local restore
- package backup export/import when it becomes long-running
- tera/peta-scale operations

Default policy:

```text
browser dependency: none after job creation
job store: persistent JSON file first; sqlite can replace later if needed
job states: queued, running, paused, backoff, paused_by_quota,
            completed, failed, retryable_failed, canceled, interrupted
checkpoint: source, destination, mode, provider, bytes/files counters,
            last error, next retry, created/started/ended timestamps
process: spawn rclone with controlled args and process group tracking
restart: running -> interrupted unless a live child can be reconciled
retry: explicit retry action or scheduled retry for backoff/quota state
partial writes: temp/partial destination, then atomic finalization when practical
verification: optional rclone check/hash/size pass
```

Decisions:

- Large backup is not browser upload.
- Browser upload endpoint remains for small/direct uploads only.
- rclone jobs should keep configured retry flags, exit code, stderr summary, provider, and next retry time in the job record.
- Google Drive 403/429/quota-like failures map to `backoff` or `paused_by_quota`, not generic `failed`.
- WebDAV timeout/rate behavior maps to retryable or backoff states where possible.
- Canceling a running job must terminate the child process/process group and leave visible job evidence.
- Finished jobs are pruned only through an explicit retention/prune policy.
- Destination overwrite remains a risky operation and must go through approval/preflight where applicable.

Required tests:

- mock rclone 403/429 maps to `backoff` or `paused_by_quota`.
- backend restart during job maps to `interrupted` or reconciled state.
- cancel running job terminates the child process/process group.
- retry failed/interrupted job does not corrupt existing destination.
- large browser upload route rejects with explicit guidance.
- missing rclone returns a clear setup error.

## 6) External Benchmark Interpretation

Synology File Station:

- Uses authenticated File Station session continuity rather than file-specific short URLs as the only continuity mechanism.
- Download/open behavior is still a direct browser response model.
- My Web OS should copy the direct response and explicit share separation ideas, not the broad long session lifetime for raw path-bound URLs.

CasaOS:

- Uses direct file responses that fit browser streaming/download behavior.
- Query token fallback is convenient but exposes secrets through logs, browser history, referrers, copied URLs, and proxies.
- My Web OS should keep direct response behavior but use opaque scoped tickets/leases instead of query JWTs.

rclone:

- Has low-level operation retry and whole-operation retry controls.
- VFS cache can support random reads but introduces cache size, cache isolation, eviction, and process lifecycle policy.
- Cloud backup/sync is a durable job lifecycle problem, not a browser ticket TTL problem.

Google Drive / Shared Drives:

- Provider quota and retry behavior can pause large jobs for long periods.
- UI must distinguish provider quota pause/backoff from generic failure.
- Job state must survive browser tab closure and backend restart.

## 7) Current Gaps

Known implementation gaps from current code inspection:

1. `fileTicketService` is memory-only and models short tickets, not media leases.
2. `server/routes/fs.js` raw ticket route uses direct file response, but lease refresh semantics are not implemented.
3. `shareService` persists share metadata, but share download password/count/rate/resume policy is not complete.
4. `cloudService` has rclone upload jobs, but upload jobs are memory-only and the browser upload route has a 64 MB request upload limit.
5. `transferJobService` has queue/progress/cancel/retry, but job state is memory-only.
6. `rclone serve webdav` currently exposes a local `127.0.0.1` mount URL; remote browser UX needs backend proxy or explicit local-only semantics.
7. Google Drive quota/backoff is not modeled as a first-class job state.

## 8) Implementation Order

Preferred order:

1. `LFC-1` Raw Ticket And Media Lease Contract
2. `LFC-2` Frontend Media Lease Recovery
3. `LFC-3` Share Download Policy
4. `LFC-4` Durable Transfer Job Store
5. `LFC-5` rclone Provider Policy

Reasoning:

- `LFC-1` and `LFC-2` deliver the transparent large-file open/seek experience first.
- `LFC-3` must remain independent because public share security is not media security.
- `LFC-4` and `LFC-5` are larger Home Server operations work and should build on a stable file-read contract.

### LFC-1 Raw Ticket And Media Lease Contract

Layer(s):

- `Host`
- `Remote Computer UX`
- `App Install / File Workflow`

Goal:

- Split short preview tickets and longer media leases into explicit purpose-aware contracts.

Minimum DoD:

- `profile=preview|media` or equivalent purpose exists.
- preview ticket keeps short TTL semantics.
- media lease supports idle timeout and absolute max TTL.
- media lease stores `createdAt`, `lastAccess`, `absoluteExpiresAt`, `size`, and `mtime`.
- successful Range/full request updates `lastAccess`.
- tests cover Range, expiry, idle timeout, target mutation, scope mismatch, and log redaction.

Suggested verification:

```bash
node --check server/services/fileTicketService.js
node --check server/routes/fs.js
npm test -- server/tests/ticket-url-contract.test.js
```

### LFC-2 Frontend Media Lease Recovery

Layer(s):

- `Web Desktop`
- `Remote Computer UX`

Goal:

- Make media/PDF users recover from expired or restarted leases without manual friction.

Minimum DoD:

- media element error can request a fresh lease.
- video/audio restores `currentTime` when possible.
- PDF/image preview retries once with a fresh lease.
- expired lease is distinguishable from path-not-found and target-changed.
- UI stays quiet on successful automatic recovery.

Suggested verification:

```bash
cd client
npm run build
```

### LFC-3 Share Download Policy

Layer(s):

- `Home Server Operations`
- `Remote Computer UX`

Goal:

- Implement large-file public share behavior without reusing media leases.

Minimum DoD:

- share download supports Range/resume.
- share expiry, audit, and path revalidation are explicit.
- request-start expiry semantics are documented in code/tests.
- directory share is rejected until deliberate archive policy exists.
- password/count/rate policy fields are represented or explicitly blocked before external exposure.

Suggested verification:

```bash
node --check server/routes/share.js
npm test
```

### LFC-4 Durable Transfer Job Store

Layer(s):

- `Home Server Operations`
- `Docs / Verification`

Goal:

- Move transfer/cloud job state from memory-only to restart-aware persistent state.

Minimum DoD:

- job state survives backend restart.
- `running` jobs recover as `interrupted` or reconciled.
- interrupted jobs are visible and retryable.
- cancel terminates running child process/process group.
- partial destination policy is explicit.
- finished jobs can be pruned intentionally.

Suggested verification:

```bash
node --check server/services/transferJobService.js
npm test -- server/tests/transfer-jobs.integration.test.js
```

### LFC-5 rclone Provider Policy

Layer(s):

- `Home Server Operations`
- `Remote Computer UX`

Goal:

- Treat Google Drive/WebDAV/S3 constraints as provider policy, not generic failure strings.

Minimum DoD:

- Google Drive 403/429/quota-like errors map to `backoff` or `paused_by_quota`.
- WebDAV timeout/rate-like errors map to retryable/backoff state where practical.
- rclone retry and low-level retry settings are explicit.
- VFS cache directory/max-size/max-age are configurable before exposing mount-like remote UX.
- UI explains paused/backoff/quota states without asking users to understand rclone internals.

Suggested verification:

```bash
node --check server/services/cloudService.js
npm test -- server/tests/cloud-upload-validation.test.js
```

## 9) Decided Now

These decisions are closed for implementation planning:

1. `preview ticket`, `media lease`, `share download`, and `durable job` are separate models.
2. Media lease first implementation is memory-only with frontend reacquire.
3. Media lease default is idle 45 minutes and absolute 8 hours.
4. Media lease target mutation check uses `size + mtime` first.
5. Share expiry is checked at request start; already-started response may finish.
6. Share download does not reuse media lease.
7. Cloud/backup uses durable server-side jobs and does not depend on browser tickets.
8. Large backup should use rclone/server-side transfer paths, not browser upload endpoints.
9. Running jobs after backend restart become `interrupted` unless explicitly reconciled with a live child process.
10. Provider quota/backoff is a first-class user-visible job state.

## 10) Deferred Decisions

These are intentionally deferred and must not block `LFC-1` or `LFC-2`:

1. Whether trusted LAN mode allows a 24-hour media lease.
2. Whether media leases should persist across backend restart.
3. Whether target mutation should use inode/hash beyond `size + mtime`.
4. Full public-share password/count/rate UI policy.
5. Backend proxy versus local-only semantics for `rclone serve webdav`.
6. Whether package backup, cloud backup, and transfer jobs share one unified job database.
7. Whether sqlite replaces JSON for durable job storage.
8. Full rclone VFS cache lifecycle policy for mount-like workflows.

## 11) Verification Matrix

Stream:

```bash
curl -H "Range: bytes=0-99" "<media-lease-url>" -i
```

Expected:

- `206 Partial Content`
- `Content-Range`
- no leaked `ticket` or lease token in logs

Preview ticket:

```bash
curl "<preview-ticket-url>" -i
```

Expected:

- valid ticket streams the file.
- expired ticket returns structured 403.
- logs redact `ticket`.

Share:

```bash
curl -H "Range: bytes=0-99" "http://127.0.0.1:3000/api/share/download/<id>" -i
```

Expected:

- `206 Partial Content` for supported file Range requests.
- expired share rejects new request.
- audit entry is written.

Transfer/cloud:

```bash
npm test -- server/tests/transfer-jobs.integration.test.js
npm test -- server/tests/cloud-upload-validation.test.js
```

Future required tests:

- rclone quota/backoff fixture.
- restart recovery fixture.
- process-group cancel fixture.
- partial destination retry fixture.
- VFS cache config validation.

## 12) Completion Criteria

This plan is implemented well when:

- A large video can be paused, resumed, and seeked without the user managing URLs or TTL.
- A backend restart interrupts media URLs but the frontend reacquires and recovers where possible.
- A public large-file share supports resume without becoming a broad Host access token.
- A cloud/backup job survives browser tab closure.
- A backend restart does not make a running backup disappear.
- Provider quota pause is shown as quota/backoff, not generic failure.
- Risky writes and overwrite paths remain approval/audit/recovery-aware.
- Logs do not leak bearer tokens, grants, tickets, passwords, or authorization values.

## 13) Source References

- Synology File Station API Guide: <https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf>
- Synology DSM Login Web API Guide: <https://global.download.synology.com/download/Document/Software/DeveloperGuide/Os/DSM/All/enu/DSM_Login_Web_API_Guide_enu.pdf>
- CasaOS v1 auth route source: <https://github.com/IceWhaleTech/CasaOS/blob/0d3b2f444ec0193193cf03eef6d43c6e35b0183e/route/v1.go>
- CasaOS v1 file route source: <https://github.com/IceWhaleTech/CasaOS/blob/0d3b2f444ec0193193cf03eef6d43c6e35b0183e/route/v1/file.go>
- CasaOS v2 file handler source: <https://github.com/IceWhaleTech/CasaOS/blob/0d3b2f444ec0193193cf03eef6d43c6e35b0183e/route/v2.go>
- Google Drive API usage limits: <https://developers.google.com/workspace/drive/api/guides/limits>
- rclone global docs: <https://rclone.org/docs/>
- rclone Google Drive backend: <https://rclone.org/drive/>
- rclone mount / VFS cache: <https://rclone.org/commands/rclone_mount/>
- rclone serve WebDAV: <https://rclone.org/commands/rclone_serve_webdav/>
- MDN HTTP Range requests: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests>
