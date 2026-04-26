# Home Server Readiness Review - 2026-04-26

Status: `[UPDATED SNAPSHOT]` VPN/내부망 홈서버 운영 준비도 논의 기준.

## 목적

이 문서는 My Web OS를 개인 홈서버 운영면으로 사용해도 되는지 검토한
프로젝트 전체 리뷰 스냅샷이다.

이 리뷰의 기본 접속 전제:

- VPN으로 내부망에 접속.
- 집 내부망에서 홈서버를 관리.
- hardened reverse-proxy 프로필 검증 전에는 직접 공인 인터넷 노출을
  전제로 하지 않음.

목표 기준은 "DSM처럼 매일 써도 되는 홈서버 운영면"이다. 단, 이
프로젝트가 실제 네이티브 OS, 커널, VM 플랫폼, 엔터프라이즈 멀티테넌트
SaaS는 아니라는 현실적 한계를 반영한다.

## 왜 이런 고민을 하는가

이 리뷰의 핵심 질문은 "기능이 많아졌는가"가 아니라 "이제 이 프로젝트를
실제 홈서버 운영면으로 믿고 맡겨도 되는가"이다. My Web OS는 브라우저에서
동작하지만, 버튼 하나가 실제 파일, Docker 컨테이너, 터미널, 클라우드
전송, 백업 상태를 바꾼다. 따라서 일반 웹앱보다 실수 비용이 크고, 운영
계약이 흐리면 기능이 늘어날수록 위험도 같이 커진다.

VPN/내부망 접속은 중요한 전제지만 충분조건은 아니다. VPN은 공인 인터넷
공격면을 줄여줄 뿐, 로그인한 사용자의 실수, stale browser tab, 복사된
권한 URL, symlink escape, 잘못된 overwrite, Docker restart, rclone quota
failure, backend restart 같은 운영 리스크를 없애지는 않는다. 이 프로젝트의
준비도는 "외부 공격을 막는가"와 별개로 "인증된 사용자의 고위험 행동을
시스템이 얼마나 명확히 통제하고 복구 가능하게 만드는가"로도 평가해야 한다.

DSM-like라는 비교는 기능 숫자 경쟁이 아니다. Synology DSM 같은 네이티브
OS급 제품은 커널, 파일시스템, 서비스 관리, 패키지 격리, 권한 모델을 더 낮은
레벨에서 통제한다. My Web OS는 그 수준의 native isolation을 가질 수 없기
때문에 같은 방식을 흉내 내기보다, 웹 기반 운영면이 할 수 있는 방식으로
보완해야 한다. 그 보완 수단이 allowed-root policy, realpath validation,
backend approval, audit evidence, durable job state, rollback evidence, explicit
failure state다.

애드온 전용 개발로 넘어갈 수 있는지 따지는 이유도 여기에 있다. core 계약이
아직 흔들리면 애드온은 그 불안정한 경계 위에서 host file, package lifecycle,
raw URL, approval UX를 각자 다르게 쓰게 된다. 그러면 나중에 core를 고치려 할
때 public API와 애드온 UX를 동시에 깨야 한다. 반대로 core의 위험 작업 승인,
파일 권한, 전송 job, package lifecycle 계약을 먼저 닫아두면 이후 애드온 개발은
더 빨라지고 안전해진다.

이 문서에서 approval을 반복해서 강조하는 이유는 단순히 confirm modal을
띄우자는 뜻이 아니다. 신뢰할 수 있는 승인은 서버가 생성한 preflight, 대상
evidence, target hash, nonce, TTL, consume-once semantics, audit log가 묶인
계약이어야 한다. UI 확인은 사용자에게 의미를 설명하는 표면이고, 실제 안전성은
backend가 상태 변경 직전에 다시 검증하고 승인 evidence를 소비하는 데서 나온다.

또 하나의 기준은 "복잡함은 숨기되 위험은 숨기지 않는다"이다. 사용자는 ticket,
lease, Range, retry, quota, partial file, rclone flag를 몰라도 되어야 한다.
하지만 quota pause, overwrite conflict, permission failure, unrecoverable state,
backend restart로 인한 interruption은 숨기면 안 된다. 이 균형이 맞아야
홈서버 운영면으로 신뢰할 수 있다.

## 적용한 기준

리뷰는 현재 `AGENTS.md`와 planning/reference 문서의 운영 계약을 기준으로
했다.

- 파일, 터미널, Docker, 서비스, 클라우드, 백업은 실제 장비에 영향을 주는
  Host 작업이다.
- `Desktop.svelte`와 `Window.svelte`는 오케스트레이션만 맡아야 한다.
- risky write, overwrite, delete, rollback, install/update/remove, command
  execution, Docker stop/restart/remove, empty trash는 승인, 감사, 복구 가능성이
  필요하다.
- Registry install과 ZIP import는 같은 package lifecycle 정책으로 수렴해야
  한다.
- 실제 홈서버/외부 노출 전에는 security boundary, risky-operation approval,
  API/UI error state, Spotlight contract, verification/frontend regression
  coverage 5개 축이 기준이다.
- 대용량 파일, 미디어, 공유, 클라우드 작업은 사용자에게 자연스럽게 이어져야
  하지만 preview ticket, media lease, share download, durable cloud/backup job
  모델은 섞이면 안 된다.

## 검토 범위

검토 레이어:

- Host
- Web Desktop
- Addon Runtime/UI
- App Install / File Workflow
- Sandbox / Package
- Home Server Operations
- Remote Computer UX
- Docs / Verification

현재 dirty worktree 기준으로 검토했다. 아래 파일은 점수에 중요한 구현이지만
현재 untracked 상태이므로, 이 스냅샷은 해당 파일들이 의도된 구현이라는
가정 위에 작성했다.

- `server/services/cloudTransferJobService.js`
- `server/tests/share-download-policy.test.js`

## 결론

2026-04-26 HSR completion pass 이후에는 addon-only/core-freeze mode가 조건부로
가능하다. 단, 이 뜻은 core를 버린다는 의미가 아니라 core 변경을
bugfix/security/reliability/performance/verification/platform contract
maintenance로 제한한다는 의미다.

권장 판단:

- 애드온 개발은 가능하다.
- core remediation gate는 닫혔고, 이후 core 작업은 유지보수성 변경으로 제한한다.
- VPN/내부망에서 개인이 조심해서 쓰는 beta 운영은 가능하다.
- DSM처럼 파일, 패키지, 백업, 공유, Docker, 터미널을 매일 맡기는 수준은 조건부
  가능하지만, native OS/kernel isolation 수준을 제공하는 것은 아니다.

점수:

- VPN/내부망 개인 운영: `8.0 / 10`
- DSM-like 홈서버 운영면: `7.2 / 10`
- 애드온 전용 개발 전환 준비도: `86 / 100`
- 직접 공인 인터넷 노출 준비도: hardened 배포와 추가 검증 전에는 권장하지
  않음.

## 체크리스트

| 영역 | 판정 | 점수 | 메모 |
| --- | --- | ---: | --- |
| 제품 범위/아키텍처 경계 | 통과 | 8.0 | Desktop/window 경계는 대체로 유지된다. 앱 로직도 대부분 앱, 스토어, 라우트, 서비스에 있다. |
| 인증/접속 하드닝 | 조건부 | 6.5 | Bearer auth와 query-token 제거는 좋다. 기본 compose의 개발용 credential은 운영용으로 보면 안 된다. |
| Host path/file 보안 | 조건부 | 7.2 | 주요 경로에 realpath/symlink escape 방어가 들어갔다. sandbox raw grant URL과 일부 backup path 검증은 약하다. |
| 위험 작업 승인/감사 | 조건부 통과 | 7.6 | HSR completion pass 기준 file delete, empty trash, Docker stop/restart/remove, package install/update/import/rollback/manifest update, terminal session start가 backend approval nonce contract를 사용한다. |
| File Station/NAS UX | 조건부 통과 | 7.4 | targeted native `confirm()` / `prompt()` 흐름은 in-app approval/review UI로 이동했다. Secure Folder는 mock 보안 대신 명시적 disabled 상태로 둔다. |
| 대용량/공유/미디어/클라우드 연속성 | 조건부 양호 | 7.7 | ticket/lease/share Range/A-owned cloud transfer가 분리되어 있고 overwrite-required cloud transfer는 approval flow를 통해 완료할 수 있다. |
| Package Center/lifecycle | 조건부 통과 | 8.0 | install/update/import/rollback/manifest update가 preflight + typed confirmation + consume-once approval nonce를 사용한다. Package Center UI도 typed confirmation을 사용자가 입력해야 approve endpoint를 호출한다. |
| Web Desktop/launcher | 양호 | 8.0 | registry 기반 app loading과 Spotlight 통합은 좋은 상태다. |
| Docker/Terminal | 조건부 통과 | 7.3 | Docker high-impact actions와 Terminal session start는 backend approval evidence를 요구한다. raw interactive shell 권한 자체는 owner-only beta 위험으로 남는다. |
| API error/UI state | 양호 | 7.5 | `ApiError`와 structured server error가 많이 정리됐다. 일부 legacy auth/cloud/system 응답은 남아 있다. |
| Verification/CI | 양호 | 8.0 | `npm run verify`와 dependency-free `npm run verify:ui-smoke`가 현재 release gate다. Full browser click-through automation은 향후 hardening enhancement다. |
| 운영 문서 | 양호 | 8.0 | User README, hardening guide, runtime notes, planning docs는 대체로 잘 정리되어 있다. |

## 애드온 전용 모드 전 원본 차단 항목

아래 항목은 최초 리뷰 당시의 차단 항목을 보존한 원본 분석이다. 현재 실행
상태와 완료 판단은 이어지는 "2026-04-26 최종 완료 패스"와 HSR-C completion
sections를 우선한다.

### 1. Risky approval contract가 통합되지 않음

좋은 현재 사례:

- `server/services/operationApprovalService.js`
- `server/routes/packages.js` package delete flow
- `server/services/cloudTransferJobService.js` cloud overwrite approval flow

남은 gap:

- `server/routes/fs.js`
  - `DELETE /api/fs/delete`
  - `DELETE /api/fs/empty-trash`
  - addon overwrite가 scoped backend approval nonce가 아니라
    `approval.approved === true` 계열 flag에 가깝다.
- `server/routes/docker.js`
  - container stop, restart, remove가 인증만으로 실행된다.
- `server/routes/packages.js`
  - registry install, ZIP import/update, rollback, 일부 manifest scope 변경이
    consume-once approval evidence 계약을 쓰지 않는다.
- `server/services/terminal.js`
  - `terminal:approval`은 프론트 결정을 감사 로그로 남기지만, backend가 명령
    실행을 승인 계약으로 막지는 않는다.

필요한 방향:

- destructive/high-impact operation은 `operationApprovalService`를 공통 승인
  primitive로 사용한다.
- approval을 user, operation type, target hash/evidence, typed confirmation,
  TTL, nonce, consume-once semantics에 묶는다.
- preflight, approval, rejection, execution, failure, recovery/rollback evidence를
  감사 로그로 남긴다.

### 2. Sandbox raw file URL이 grantId query string을 사용

현재 우려:

- `server/routes/sandbox.js`에 `GET /api/sandbox/:appId/file/raw`가 있다.
- `server/static/webos-sandbox-sdk.js`가 `grantId` query string이 포함된 raw URL을
  만든다.
- request logging은 grantId를 redact하지만, 복사된 URL 자체는 grant lifetime 동안
  scoped bearer link처럼 동작한다.

필요한 방향:

- raw grant query URL을 짧은 raw ticket/media lease 또는 authenticated fetch로
  바꾼다.
- grant scope와 app ownership check는 유지하되, 권한성 데이터를 공유 가능한 URL에
  오래 두지 않는다.

### 3. File Station에 mock/브라우저 기본 확인 UX가 남아 있음

현재 우려:

- 여러 destructive/sensitive flow가 native `confirm()` / `prompt()`에 의존한다.
- Secure Folder가 frontend mock password 비교를 사용한다.

필요한 방향:

- mock security behavior를 제거한다.
- 위험 작업은 application modal + server-side preflight/approval evidence로
  바꾼다.
- delete, overwrite, empty trash, extract overwrite, restore 경로에서 복구 가능성과
  영향 범위를 명확하게 보여준다.

### 4. Durable transfer/backup hardening 마감 필요

좋은 현재 상태:

- A-owned cloud transfer가 별도 `/api/cloud/transfer*` 계약을 갖는다.
- source path validation이 allowed root와 realpath-aware check를 쓴다.
- directory source는 거절된다.
- cloud overwrite는 backend approval evidence를 요구한다.
- running job은 reload 시 interrupted로 남는다.
- retry/cancel/prune은 명시 API다.
- provider quota/backoff state가 표현된다.

남은 gap:

- Transfer UI는 overwrite-required cloud transfer를 완료하는 대신 현재 막는다.
- `server/services/transferJobService.js` local transfer store는 atomic tmp-then-rename
  persistence가 아니다.
- `server/routes/system.js` backup job source/destination path도 최신 file/transfer
  코드와 같은 realpath/symlink-escape 정책으로 확인할 필요가 있다.

### 5. Runtime state 정책 정리 필요

현재 우려:

- `.gitignore`는 `server/storage/cloud-transfer-jobs.json`,
  `server/storage/transfer-jobs.json`을 포함한다.
- `server/storage/shares.json`은 운영 계약에서 runtime/local로 취급되지만 현재
  trackable 상태다.

필요한 방향:

- `server/storage/shares.json`이 runtime store인지 fixture인지 결정한다.
- runtime이면 untrack하고 ignore rule을 추가한다.
- fixture이면 왜 trackable인지 문서화한다.

## 이미 강한 부분

- auth middleware에서 query JWT fallback이 제거됐다.
- request URL redaction이 민감 query 값을 가린다.
- `ApiError`가 `code`, `details`, validation, retry-after, request id, redacted
  message를 보존한다.
- `pathPolicy`에 realpath-aware symlink escape check가 있다.
- package doctor와 registry migration check가 있다.
- package delete는 scoped approval, target hash detection, nonce consumption,
  테스트를 갖춘다.
- A-owned cloud transfer는 legacy browser multipart upload와 분리됐다.
- share download는 Range를 지원하고 expired/missing/directory target을 structured
  error로 거절한다.
- raw file ticket과 media lease가 JWT auth와 분리되어 있고 테스트가 있다.
- Desktop과 Spotlight는 app registry contract와 대체로 맞는다.
- `npm run verify`와 CI verification이 syntax, server tests, package doctor,
  frontend build를 포함한다.

## 검증 스냅샷

리뷰 중 실행한 명령:

```bash
npm run verify
npm run verify:docker-config
```

결과:

- `npm run verify`: 통과.
- server tests: `108 / 108` 통과.
- package doctor: `fails=0`, `warns=0`.
- client build: 통과.
- build warning: Monaco/Three 계열 대형 chunk 경고가 남아 있다. correctness failure는
  아니지만 performance concern이다.
- `npm run verify:docker-config`: 통과.
- 리뷰에 사용한 local Node version: `v20.20.1`.

추가 메모:

- Dockerfile은 Node 20을 사용한다.
- GitHub workflow는 Node 22를 사용한다. 로컬 검증은 Node 20에서 통과했으므로
  CI/runtime version alignment는 별도 결정이 필요하다.

## 권장 다음 작업 패킷

core addon-only 선언 전 권장 순서:

1. file delete, empty trash, file overwrite, Docker stop/restart/remove, package
   install/update/rollback, terminal risky command execution에
   `operationApprovalService` approval을 적용한다.
2. sandbox raw `grantId` query URL을 raw ticket/lease 또는 authenticated fetch로
   교체한다.
3. mock Secure Folder와 high-impact File Station workflow의 native browser prompt를
   제거한다.
4. Transfer UI overwrite approval과 local transfer atomic store write를 마무리한다.
5. backup job source/destination path에 realpath-aware validation을 적용한다.
6. `server/storage/shares.json` runtime-state 정책을 결정한다.
7. File Station, Package Center, Transfer UI, login/session expiry 경로에 frontend
   real-use smoke coverage를 추가한다.

## 해답: 운영 전환 결정안

이 리뷰에 대한 답은 무제한 core freeze가 아니다. 2026-04-26 completion pass
이후 올바른 답은 VPN/내부망 개인 beta 운영과 addon-first 개발을 허용하되,
core 변경은 bugfix/security/reliability/performance/verification/platform
contract maintenance로 제한하는 것이다.

## HSR 구현 상태 - 2026-04-26 후속 패스

Status: `[COMPLETE]` AGENTS.md HSR 실행 결과 반영.

완료 또는 실질 반영:

- `HSR-1` 일부:
  - `fs.delete`, `fs.empty-trash`, `fs.write.overwrite`는 backend preflight,
    scoped approval nonce, target hash/evidence, consume-once execution, audit를
    요구한다.
  - Docker `stop`, `restart`, `remove`는 backend preflight/approve/execute approval
    contract를 요구한다.
  - sandbox `host.file.write` overwrite는 더 이상 `approval.approved === true`
    flag만으로 실행되지 않고 `sandbox.file.write.overwrite` backend nonce를 요구한다.
- `HSR-2`:
  - sandbox raw file URL은 더 이상 SDK에서 `grantId` query URL을 직접 만들지 않는다.
  - SDK는 `WebOS.files.rawTicket()`으로 parent shell을 통해 authenticated raw ticket을
    요청하고, `WebOS.files.rawUrl()`은 발급된 ticket URL만 그대로 사용한다.
- `HSR-3` 일부:
  - File Station의 주요 create/rename/delete/empty-trash/revoke/overwrite 확인은
    native `confirm()` / `prompt()` 대신 in-app dialog로 이동했다.
  - frontend-only Secure Folder mock password 흐름은 disabled state로 전환됐다.
- `HSR-4`:
  - Transfer UI가 cloud overwrite-required preflight/approve/create flow를 사용할 수
    있도록 갱신됐다.
  - local/cloud transfer durable-state 테스트와 A-owned cloud transfer focused tests가
    통과한다.
- `HSR-5`:
  - `server/storage/shares.json`, `.trash_info.json`, `.trash/`, transfer/cloud job
    stores, audit log, corrupt inventory snapshots, cloud mock, rclone config가
    runtime/local ignore 정책에 포함됐다.
  - `server/storage/shares.json`과 `server/storage/.trash_info.json`은 git index에서
    제거되어 runtime state로 취급된다.
- `HSR-6`:
  - `npm run verify:ui-smoke`가 추가됐다.
  - 현재 smoke gate는 targeted system app native prompt regression, 주요 workflow
    source contract, backend health, frontend shell boot contract를 확인한다.

2026-04-26 최종 완료 패스:

- Package registry install/update, ZIP import/update, rollback, manifest update가
  package lifecycle backend approval nonce contract로 통합됐다.
- Terminal PTY session start는 `terminal.session` backend approval nonce를 요구한다.
  승인되지 않은 session init/input은 backend에서 거절된다.
- Docker Manager, Package Center, Terminal, Backup Job Manager의 targeted system app
  native `confirm()` / `prompt()` UX가 제거됐다.
- Code Editor addon overwrite도 `/api/fs/write/preflight`와 `/api/fs/write/approve`
  backend approval evidence를 사용한다.
- Widget Store template deletion과 core context-menu danger action은 in-app dialog로
  이동했다.
- `verify:ui-smoke`는 dependency-free release smoke gate로 승격됐다. Playwright 같은
  browser click-through runner는 향후 hardening enhancement이며 현재 HSR blocker는
  아니다.

검증 결과:

- `npm run verify`: 통과.
- `npm run verify:docker-config`: 통과.
- `npm run verify:ui-smoke`: 통과. 임시 backend/frontend dev server를 띄워 확인했다.
- `git diff --check`: 통과.
- native prompt/legacy terminal scan: `client/src` 기준 통과.
- focused HSR tests:
  - `server/tests/fs-approval-contract.test.js`
  - `server/tests/docker-service.test.js`
  - `server/tests/package-delete-approval-contract.test.js`
  - `server/tests/package-lifecycle-approval-contract.test.js`
  - `server/tests/terminal-approval-contract.test.js`
  - `server/tests/file-grant-revoke.test.js`
  - `server/tests/sandbox-sdk-contract.test.js`
  - `server/tests/ticket-url-contract.test.js`
  - `server/tests/cloud-upload-validation.test.js`
  - `server/tests/transfer-jobs.integration.test.js`
  - `server/tests/client-transfer-sandbox-normalization.test.js`
  - `server/tests/share-download-policy.test.js`

운영 전환 판단:

- VPN/내부망 개인 운영: 가능. 단, owner/admin 단독 사용과 운영 백업을 전제로 한다.
- 애드온 개발: 가능. 단, 새로운 Host 권한이나 파일 쓰기 계약을 우회하지 않는다.
- addon-only/core-freeze mode: 조건부 가능. core 작업은 bugfix/security/reliability/
  performance/verification/platform contract maintenance로 제한한다.
- 직접 공인 인터넷 노출: hardened 배포 검증과 frontend real-use smoke gate 전에는
  금지한다.

### 1. Addon-only mode gate

addon-only mode의 조건은 모든 high-impact Host operation이 backend approval
contract를 쓰는 것이다. 2026-04-26 최종 완료 패스 기준으로 이 gate는 조건부
충족됐다. VPN/internal 운영이라고 해서 core 계약을 낮추지는 않는다.

닫힌 gate:

1. `operationApprovalService`가 file delete, empty trash, overwrite, package
   install/update/rollback/delete, Docker stop/restart/remove, terminal command/session
   execution에 적용된다.
2. sandbox raw file URL이 장기 `grantId` query string을 쓰지 않는다.
3. File Station의 mock security behavior와 native `confirm()` / `prompt()` 기반
   high-impact flow가 제거된다.
4. Transfer UI overwrite approval, local transfer atomic persistence, backup path
   realpath validation이 닫힌다.
5. runtime state 파일 정책이 git 추적 정책과 일치한다.
6. File Station, Package Center, Transfer UI, login/session expiry에 dependency-free
   frontend smoke 검증이 있다. Browser click-through automation은 향후 hardening
   항목이다.

### 2. 열린 질문에 대한 결정

1. Risky host operation 기준

   모든 risky host operation은 backend preflight, scoped approval, execute,
   audit 흐름을 사용한다. UI 확인만으로 실행되는 destructive/high-impact operation은
   남기지 않는다.

2. Terminal 정책

   Terminal은 privileged admin shell로 유지한다. 대신 PTY 입력을 받기 전에 backend가
   terminal session approval을 요구하고, session start/end, user, client, working
   directory, approval evidence를 audit에 남긴다.

   임의 shell line을 완벽히 파싱해서 안전 경계로 삼지는 않는다. 대신 Agent, quick
   action, saved command, package script처럼 Web OS가 명령 문자열을 직접 실행하거나
   주입하는 경로는 per-command approval을 요구한다. Interactive shell은 "승인된
   raw admin session"으로 명확히 표시한다.

3. File Station delete 정책

   Trash-first delete도 실제 Host 파일 상태를 바꾸므로 approval 대상이다. 단일 파일의
   trash move는 medium-risk approval로 처리할 수 있지만, recursive delete,
   multi-select delete, permanent delete, empty trash는 typed confirmation을 요구한다.

   execute 직전에는 source path를 다시 realpath/lstat-aware allowed-root 정책으로
   검증하고, audit에는 trash id 또는 recoverability evidence를 남긴다.

4. Package install/update/rollback 정책

   Package install/update도 preflight blocker가 없더라도 nonce approval을 요구한다.
   설치와 업데이트는 실행 코드, manifest permission, runtime, file association,
   package data boundary를 바꿀 수 있으므로 package delete와 같은 lifecycle approval
   family에 속한다.

   approval은 `package.install`, `package.update`, `package.rollback`,
   `package.delete`처럼 action을 분리하고, source id, package id, manifest hash,
   version, backup id 또는 rollback target hash에 묶는다.

5. Share store 정책

   `server/storage/shares.json`은 runtime-only state로 본다. 실제 share token, expiry,
   password policy, download count는 fixture가 아니라 운영 상태다.

   따라서 파일은 git 추적 대상에서 제외하고 `.gitignore`에 추가한다. 문서나 테스트에
   필요한 기본 형태는 redacted preset, schema, 또는 test fixture로 따로 둔다.

### 3. 구현 패킷

core addon-only 선언 전 작업은 아래 순서로 완료됐다. 이 목록은 재오픈 기준과
회귀 확인용 기록이다.

1. HSR-1 Risky Operation Approval Unification

   Scope:

   - `server/routes/fs.js`
   - `server/routes/docker.js`
   - `server/routes/packages.js`
   - `server/services/terminal.js`
   - 관련 File Station, Docker Manager, Package Center, Terminal UI

   DoD:

   - destructive/high-impact execute endpoint가 approval nonce 없이 실행되지 않는다.
   - preflight response가 target, impact, recoverability, typed confirmation,
     expiresAt, operationId를 반환한다.
   - execute는 target hash/state를 재검증하고 approval nonce를 consume-once로 소비한다.
   - audit에는 preflight, approve, execute success/failure가 남는다.

2. HSR-2 Sandbox Raw URL Cleanup

   Scope:

   - `server/routes/sandbox.js`
   - `server/static/webos-sandbox-sdk.js`
   - sandbox file API callers

   DoD:

   - raw file access가 장기 `grantId` query URL에 의존하지 않는다.
   - 필요한 경우 authenticated `POST`로 짧은 raw ticket을 발급한다.
   - ticket/grant/token은 request log, job summary, UI error에서 redacted된다.

3. HSR-3 File Station Trust Cleanup

   Scope:

   - `client/src/apps/system/file-explorer/FileExplorer.svelte`
   - File Station API helper
   - addon save/overwrite callers

   DoD:

   - high-impact flow에서 native `confirm()` / `prompt()`를 쓰지 않는다.
   - Secure Folder mock password behavior를 제거하거나 명시적 미구현 상태로 낮춘다.
   - delete, overwrite, extract overwrite, restore는 backend approval evidence를 사용한다.

4. HSR-4 Transfer And Backup Durability Close-out

   Scope:

   - `client/src/apps/system/transfer/*`
   - `server/services/transferJobService.js`
   - `server/routes/system.js`
   - backup/transfer tests

   DoD:

   - Transfer UI가 cloud overwrite-required 상태를 막힌 상태로 남기지 않고 approval
     flow로 완료할 수 있다.
   - local transfer job store는 tmp sibling write 후 rename으로 atomic persistence를
     사용한다.
   - backup job source/destination path가 realpath/lstat-aware policy로 검증된다.

5. HSR-5 Runtime State Policy Cleanup

   Scope:

   - `.gitignore`
   - `server/storage/shares.json`
   - runtime stability notes

   DoD:

   - concrete share runtime state는 git에 남지 않는다.
   - 필요한 기본값은 preset/schema/test fixture로 분리된다.
   - runtime/local 파일 목록이 `AGENTS.md`와 operations 문서에 일치한다.

6. HSR-6 Frontend Real-use Smoke Gate

   Scope:

   - `client/package.json`
   - smoke test scripts
   - CI/local verification docs

   DoD:

   - login/session expiry, File Station destructive preflight, Package Center approval,
     Transfer UI cloud job status, sandbox app load timeout을 smoke로 확인한다.
   - `npm run verify` 또는 별도 `npm run verify:ui-smoke`에서 재현 가능하다.

### 4. 완료 기준

core freeze 또는 addon-only 선언은 아래 조건을 만족할 때만 한다. 2026-04-26
최종 완료 패스에서는 아래 조건이 통과했다.

- `npm run verify` 통과.
- `npm run verify:docker-config` 통과.
- package doctor `fails=0`, `warns=0`.
- frontend build 통과.
- approval 관련 focused server tests 통과.
- dependency-free frontend smoke gate 통과.
- operations 문서가 code-verified behavior와 일치한다.
- 미완성 위험은 문서의 "known risk"로 남지 않고 코드, 명시적 disabled state, 또는
  별도 future hardening 항목으로 분리된다.

### 5. 이후 운영 모드

gate가 닫힌 뒤 My Web OS의 권장 운영 모드는 다음이다.

- VPN/내부망 owner-only beta.
- 공인 인터넷 직접 노출 금지.
- Docker/Terminal/File delete/Package lifecycle 작업은 backend approval UI와 audit
  evidence를 통해 admin이 의도적으로 수행.
- 대용량 cloud/backup job은 A-owned durable job 경로만 신뢰하고, browser upload는
  별도 legacy/direct workflow로 취급.
- 중요한 파일 작업 전에는 외부 백업 또는 Web OS backup evidence를 확인.
- runtime state 파일은 로컬 운영 상태로 보고 커밋하지 않는다.
