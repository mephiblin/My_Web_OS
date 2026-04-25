# Completed Backlog Log

`AGENTS.md` 기준으로 완료(또는 워킹트리 반영)된 백로그 항목을 이 문서에서 추적한다.

## Status Labels
- `작업됨 (커밋 반영)`: 커밋까지 반영된 항목
- `작업됨 (워킹트리 반영)`: 파일 반영은 되었으나 커밋 전일 수 있는 항목
- `아키텍처 정합 완료`: 구현/운영/문서 기준이 동일하게 정렬된 항목

## Snapshot Summary

### P0
- Package Center installed operation console 개선 (커밋 반영)
- install/update preflight review 도입 (커밋 반영)
- Settings vs Control Panel 역할 분리 (커밋 반영)
- File Station 경계/오류 UX 개선 (커밋 반영)
- `server/tests/*` 공식 실행 커맨드 연결 (커밋 반영)
- P0-1 Built-in registry durability: `inventory/system/apps.json` 누락/파손 시 seed 자동 복구 + migrate seed fallback (워킹트리 반영)
- P0-2 ~ P0-6 상태 보정/파일연결/Open With/grant/overwrite 승인 정책 정합화 (워킹트리 반영)
- Start Menu / Taskbar settings / Window defaults / Agent chat panel 기반 (워킹트리 반영)

### P1
- P1-1 ~ P1-4 Package Center installed contract 가시성 + manifest fileAssociations + sandbox grant file API + Widget Store alignment (워킹트리 반영)
- Code Editor <-> Package Center 파일 편집 연동 (워킹트리 반영)
- Package creation wizard (워킹트리 반영)
- Manifest editor UI + preflight/save (워킹트리 반영)
- Theme presets / desktop layout persistence / Agent status 확장 / Wrapped UI skeleton (워킹트리 반영)

### P2
- P2-1 ~ P2-4 File/Terminal/Ops/Docker 운영 신뢰성 보강 + compose JSON 파싱 안정화 + terminal 세션 재초기화 안정성 보강 (워킹트리 반영)
- Context menu customization (워킹트리 반영)
- App-specific window backgrounds (워킹트리 반영)
- Docker logs/ports/volumes/Compose 확장 (워킹트리 반영)
- Media playlist/background audio (워킹트리 반영)
- Document Viewer controls/search (워킹트리 반영)
- Model Viewer advanced inspection (워킹트리 반영)

### P3
- P3-1 ~ P3-6 Start/Taskbar/Window defaults/Control Panel/theme preset/context menu Open With 흐름 정합화 (워킹트리 반영)
- WebDAV/cloud write + mount status (워킹트리 반영)
- Backup job manager (워킹트리 반영)
- Service/runtime/package dashboard (워킹트리 반영)
- Download/transfer manager (워킹트리 반영)
- Docker packaging/portability (워킹트리 반영)

### P4
- P4-1 ~ P4-5 Agent result/approval cards + small OS action cards + AI proxy(`/api/ai/assist`) + raw output 보존 + Wrapped mode 하드닝 (워킹트리 반영)
- Media Library boundary model (커밋 반영)
- Browse Local Files -> Import to Library UX 통합 (커밋 반영)
- `MEDIA_LIBRARY_*` 오류 코드 계약 정리 (커밋 반영)
- Manifest media scopes + approval/audit 연동 (워킹트리 반영)
- Legacy wallpaper/media path migration 가이드 문서화 (워킹트리 반영)

### P5
- P5-1 App ownership matrix finalize (`doc/reference/app-ownership-matrix.md`) (커밋 반영)
- P5-2 Client app folder split (`client/src/apps/system/*`, `client/src/apps/addons/*`) (커밋 반영)
- P5-3 Legacy registry fallback 제거 + `inventory/system/apps.json` 단일 소스 + `tools/migrate-apps-registry.js` (워킹트리 반영)
- P5-4 Standard app manifest-like 필드 계약 + `package-doctor --builtin-registry` 검증 (워킹트리 반영)
- P5-5 AGENTS/operations/remediation 문서 상태 동기화 (문서 정합 작업; 아키텍처 완결 아님)
- P5-1 ~ P5-6 (현행 Expansion/Portability 백로그) 기능 반영:
  - Media Player playlist/repeat/shuffle/background audio
  - Document Viewer PDF controls/search/metadata
  - Model Viewer wireframe/axes/material info/screenshot
  - WebDAV/cloud write/upload/mount status
  - Backup job manager + richer transfer manager
  - Docker portability assets(Dockerfile/Compose), host path binding, volume strategy, container logs guide

## P5 상태 보정 메모 (2026-04-24)

- P5-2~P5-4는 구조 정비와 레지스트리/검증 계약 정리까지는 완료되었음.
- P5-5는 문서 동기화 작업이며, File Station Open With, 파일 권한(grant), overwrite 승인, package addon 파일 연동까지 완료되었다는 의미가 아님.
- 아키텍처 미완 항목은 `AGENTS.md`의 `P0-2` 이후 백로그로 재배치하여 추적함.

## Autonomous Loop 진행 메모 (2026-04-24, 워킹트리)

- `P0-2` 상태 보정: P5 문서 동기화와 아키텍처 완결 상태를 분리 표기.
- `P0-3` built-in addon fileAssociations 추가 (`apps.json`, registry normalization).
- `P0-4` File Station 더블클릭을 file association 기반으로 정렬하고 `fileContext` + grant 형태로 앱 실행 컨텍스트 전달.
- `P0-5` single-file grant 모델 도입 (`/api/fs/grant`, read/readwrite mode, app/user scope).
- `P0-6` addon overwrite 저장 정책 도입 (`FS_WRITE_OVERWRITE_APPROVAL_REQUIRED`, approval/audit).
- `P1-1` Package Center Installed 화면에 desktop app contract 가시성 추가 (model/owner/runtime/type/dataBoundary/permissions/fileAssociations).
- `P1-2` package manifest `fileAssociations` 계약 및 strict validation 추가 (`server/routes/packages.js`, `tools/package-doctor.js`).
- `P1-3` package sandbox 앱이 grant 기반 host file read/write를 WebOS SDK 경유로 요청할 수 있는 경로 추가.
- `P1-4` Widget Store의 app data boundary/file association 메타데이터를 registry 계약에 반영.

## Autonomous Loop 진행 메모 (2026-04-24, P2-1 ~ P3-6 워킹트리)

- `P2-1` File Station 신뢰성 보강:
  - allowed roots 표시, Transfer Manager 실행/진행중 배지 연결, extension 기반 Open With + 사용자 기본앱 매핑 연동.
- `P2-2` Terminal 신뢰성 보강:
  - 재연결/종료 표시, resize 동기화, 위험 명령어 패턴 사용자 승인(confirm) 게이트 추가.
- `P2-3` Resource Monitor/Log Viewer 통합:
  - `/api/system/ops-summary` 계약 추가, 서비스/런타임/패키지/최근 에러 지표를 양쪽 UI에서 공통 사용.
- `P2-4` Docker 운영 보강:
  - Docker images API 추가, Docker Manager에 이미지 패널/health 상태 뷰 반영.
- `P3-1` Start Menu 개선:
  - pinned/recent/layout 상태의 backend persistence 연결, Pin/Unpin 동작 및 Control Panel 레이아웃 설정 연동.
- `P3-6` Context Menu 커스터마이징:
  - contextMenu state에 `openWithByExtension` 추가, Control Panel에서 확장자별 기본 Open With 앱 설정/삭제 가능.

## Autonomous Loop 진행 메모 (2026-04-25, P5-5 잔여)

- Transfer manager 확장:
  - backend: `/api/transfer/jobs` summary 추가, `POST /api/transfer/jobs/:id/retry`, `DELETE /api/transfer/jobs?statuses=...` 추가.
  - service: failed/canceled retry, finished job clear, status summary 집계, `fileName` 계약 보강.
  - frontend: Transfer UI에 상태 필터/완료 이력 정리/실패 재시도 버튼/바이트 진행량 표시 추가.
  - test: `server/tests/transfer-jobs.integration.test.js` 추가(실패→retry→성공, clear 검증).

## Autonomous Loop 진행 메모 (2026-04-25, R0/A11 안정화)

- A11 regression coverage 보강:
  - `server/tests/cloud-upload-validation.test.js`:
    cloud upload filename leaf validation/async cancel/failure mapping 고정.
  - `server/tests/package-backup-policy.integration.test.js`:
    nonexistent app backup-policy 동작(`404`, `PACKAGE_NOT_FOUND`) 고정.
  - `server/tests/package-backup-jobs.integration.test.js`:
    queued-to-running cancel race에서 일관된 terminal status 보장 검증.
  - `server/tests/client-transfer-sandbox-normalization.test.js`:
    transfer `error -> failed` 정규화, sandbox message clone safety 검증.
- 클라이언트 안전성 보강:
  - `client/src/apps/system/transfer/normalization.js` 추가.
  - `client/src/utils/messagePayload.js` 추가.
  - `SandboxAppFrame.svelte` clone-safe message bridge 반영.
- direct multi-file `node --test` 동작 정리:
  - 2026-04-25 재현: default parallel 실행 시 간헐적 실패(공유 storage write 경합).
  - 운영 표준: `npm test`(`--test-concurrency=1`) 사용.

## Autonomous Loop 진행 메모 (2026-04-25, R1/R3 진행 중)

- R1 Remote Computer 신뢰성:
  - Terminal 위험 명령 승인 결과를 socket 이벤트(`terminal:approval`)로 감사 로그에 남기도록 보강.
  - Terminal 세션 초기화에서 socket auth 토큰 검증을 추가하여 무인증 세션을 거부.
  - File Station에 active file grant 가시성을 추가:
    - backend `GET /api/fs/grants`
    - sidebar에서 allowed roots + active grants 패널 노출.

- R3 Package Center App Workshop:
  - Ecosystem template 확장:
    - `empty-html`, `memo-app`, `widget-basic`, `server-monitor`, `markdown-editor`, `python-experimental`
  - template별 scaffold entry content 반영(HTML 템플릿별 기본 화면 차등).
  - Wizard에서 template 선택 -> 기본 appType/runtime/entry/permissions 자동 반영.
  - Installed 카드에서 `Clone`, `Export` 작업 경로 추가.
  - capability 가시성(`cap:{appType}`) 칩 추가.

## Autonomous Loop 진행 메모 (2026-04-25, R2 운영 콘솔 정리)

- 운영 상태 vocabulary/연결성 보강:
  - `Resource Monitor > Ops` 탭에 `Logs`, `Docker`, `Transfer`, `Package Center` quick action 추가.
  - 서비스/런타임 상태 집계/배지에서 `normalizeOpsStatus`를 기준으로 `failed` 등 canonical status 사용.
- transfer status contract 보강:
  - `DELETE /api/transfer/jobs?statuses=...`에서 legacy alias 정규화 지원:
    - `error -> failed`
    - `cancelled -> canceled`
    - `success|done -> completed`
    - `active|working -> running`
  - transfer integration test에서 alias clear 경로 검증 반영.

## Autonomous Loop 진행 메모 (2026-04-25, R4 개인 앱 생태계 시작)

- Package Center personal starter app 템플릿 확장:
  - `todo-app`
  - `bookmark-manager`
  - `calculator`
  - `clipboard-history`
- 템플릿 scaffold entry 생성기에서 각 앱별 기본 HTML/동작 추가:
  - todo/bookmark/clipboard는 app-owned data(`app.data.read/write`) 기반 저장.
  - calculator는 무상태 계산기 템플릿.
- Package Center Store 영역에 `Personal Starter Apps` quick action 섹션 추가:
  - Memo, Todo, Bookmark Manager, Calculator, Clipboard History
  - 템플릿 미존재 시 비활성화 표시.
- 통합 테스트 추가:
  - `server/tests/package-personal-templates.integration.test.js`
  - 템플릿 목록 포함 여부, memo/todo scaffold, backup 생성, export(zip) 경로 검증.

## Autonomous Loop 진행 메모 (2026-04-25, R4~R7 연속 진행)

- R4 미완 보강:
  - `bookmark-manager` 템플릿에 URL 검증(`http/https`), 중복 URL 방지, JSON import/export 추가.
  - `calculator` 템플릿에 키보드 입력/계산 히스토리 + app-owned data 저장 추가.
  - `clipboard-history` 템플릿을 수동 추가 중심으로 정리(자동 host clipboard 캡처 제거, 최대 100개 유지, 전체 비우기 추가).
- R5 착수 (Download Station):
  - 신규 시스템 앱 `download-station` 추가(시드/인벤토리):
    - `server/config/builtinAppsSeed.js`
    - `server/storage/inventory/system/apps.json`
  - 클라이언트 앱 추가:
    - `client/src/apps/system/download-station/DownloadStation.svelte`
    - transfer API 재사용, 검색/상태 필터/최근 목록/실패 재시도/완료 이력 정리 지원.
  - launch/search 연결:
    - `client/src/core/appLaunchRegistry.js`
    - `client/src/core/Spotlight.svelte`
  - NAS-style station 앱 4종 추가:
    - `photo-station`, `music-station`, `document-station`, `video-station` 시스템 앱 등록(시드/인벤토리)
    - `client/src/apps/system/station/StationShell.svelte` 공통 라이브러리 셸 추가
    - 확장자 필터 + recents + folder grouping + allowed-root 선택 + 대용량 파일 태그(large) + 실패 메시지 노출
    - 각 station wrapper 앱을 launch registry/Spotlight에 연결
- R6 진행:
  - Package Center ecosystem template 확장:
    - `json-formatter`, `api-tester`, `snippet-vault`
  - Package Center Store에 `Developer Tool Starters` 빠른 생성 섹션 추가.
  - dev starter scaffold 고도화:
    - `api-tester`: header 편집 + 응답 저장(app-owned data) 지원
    - `snippet-vault`: 검색 + 태그 + JSON export 지원
- R7 진행:
  - `server/services/aiActionService.js`에서 운영 의도별 action card 강화:
    - Logs / Package Center / Docker / Transfer / Download Station 연결 액션 제안.
  - `client/src/core/stores/agentStore.js`에서 `open_system_app` 실행 타입 지원 및 실패 시 후속 복구 액션 카드(Logs/Package Center) 추가.
  - `client/src/core/components/AgentChatPanel.svelte` 결과 버튼 상태 표시 개선.
  - approval card 상세 정보 보강:
    - impact / target / reversibility / recovery 필드 추가 및 UI 노출.
  - 결과 카드 deep-link 보강:
    - `open_audit` 액션 추가(Logs/Audit 트레일 이동 경로).
  - Wrapped mode 반복 실행 스켈레톤:
    - repeatable task id 생성 및 단계 메타데이터 노출.
  - server audit 연계:
    - `POST /api/ai/audit` 계약 추가,
    - approval requested/resolved, result action started/completed/failed, wrapped task queued 이벤트 기록.

## Autonomous Loop 진행 메모 (2026-04-25, R5~R7 미완 보강 2차)

- R5 Download Station 고도화:
  - 카테고리 필터/집계(`video/audio/image/document/archive/copy/other`) 추가.
  - transfer error code 기반 실패 원인 분류 및 복구 가이드 UI 추가.
  - failed queue를 원인 그룹 단위로 정리.
- R5 StationShell 보강:
  - 디렉터리/파일 스캔 상한(`MAX_SCAN_DIRS`/`MAX_SCAN_ITEMS`) 및 skip 정책(`node_modules`, `.git` 등) 추가.
  - 스캔 통계/절단(truncated) 표시 추가.
  - 파일 kind/size/mtime 메타데이터 표시 추가.
- R6 Developer starter 심화:
  - `json-formatter`: Load File / Save File + host file read/write(`WebOS.files.*`, grantId optional) 지원.
  - `api-tester`: request history 저장/불러오기/재실행(rerun) + 요청 이름(name) 지원.
  - `snippet-vault`: JSON import workflow + import mode(merge/overwrite) 추가.

## Autonomous Loop 진행 메모 (2026-04-25, R5 Station 메타데이터 보강 3차)

- Station 메타데이터 API 계약 추가:
  - `GET /api/media/station-info?path=...`
  - 응답: `kind`, `durationSeconds`, `resolution`, `pages`(PDF)
  - 오류 계약: `MEDIA_STATION_PATH_REQUIRED`, `MEDIA_STATION_PATH_NOT_FOUND`, `MEDIA_STATION_INVALID_PATH`.
- backend service 보강:
  - `server/services/mediaService.js`
  - PDF의 `/Type /Page` 패턴 기반 page count 추출(대용량 파일은 스킵).
  - station summary 메타데이터 helper(`getStationMetadata`) 추가.
- StationShell UI 보강:
  - 정렬 옵션(`recent/name/size`) 추가.
  - visible row 기반 메타데이터 lazy fetch + 캐시 추가.
  - 행 메타 정보에 해상도/재생시간/페이지 수 표시.
  - metadata 로딩 상태 표시.
- R6 연계 보강:
  - `snippet-vault` 템플릿 import 결과 리포트 추가(added/duplicate/skipped/replaced).
  - `api-tester` 템플릿 request collection UX 보강:
    - request 저장 시 `folder`, `tags` 필드 지원
    - folder/tag 필터 기반 history select + rerun 경로 지원
    - collection filter 선택과 history 리스트 연동.
  - `json-formatter` host file grant UX 보강:
    - host read/write 모두 grantId 요구를 명시적으로 안내
    - overwrite/approval/validate-json toggle 추가
    - `FS_FILE_GRANT_*`, `FS_WRITE_*`, `FS_PERMISSION_DENIED` 코드별 사용자 메시지 노출.
- R7 실행 연계 강화:
  - approval card 문구를 `Risk Check:*` 형태로 정규화(삭제/overwrite/rollback/host action).
  - approval resolve 결과 카드에 `open_audit` + 관련 시스템 앱 deep-link(resultActions) 추가.

## Autonomous Loop 진행 메모 (2026-04-25, R8 Hardening Starter)

- reverse proxy/TLS 배포 베이스 추가:
  - `docker-compose.hardened.yml` (backend 비직노출 + proxy 공개)
  - `docker/Dockerfile.proxy` (frontend build + Caddy 정적 서빙)
  - `docker/Caddyfile.hardened` (`/api`, `/socket.io` reverse proxy + TLS internal + 보안 헤더)
- backend 하드닝 설정 연결:
  - `TRUST_PROXY_HOPS` 환경설정 추가 (`server/config/defaults.json`, `server/config/serverConfig.js`, `server/routes/settings.js`)
  - production 환경에서 `helmet` 활성화 + `x-powered-by` 비노출 (`server/index.js`)
  - `serverConfig`가 container runtime env를 `.env`보다 우선 병합하도록 수정(Compose 주입 `JWT_SECRET`/`TRUST_PROXY_HOPS` 정상 반영).
- 운영 부트스트랩/문서:
  - `.env.hardened.example`
  - `tools/generate-hardened-env.js` + `npm run hardening:env`
  - `doc/operations/remote-access-hardening-guide.md`
  - `README.md`, `doc/README.md`, `doc/operations/local-run-guide.md` 연동
  - repeatable task queued 카드에 audit/log deep-link 추가.
  - `open_audit` 실행 시 Log Viewer deep-link payload(`focus/search/level`) 전달.
- R5 Station 후속 튜닝:
  - `StationShell` metadata fetch 동시성 제한(`MAX_METADATA_CONCURRENCY`) 적용.
  - scan 사이클 간 metadata cache(TTL + fingerprint + max entries) 도입.
  - scan 지표 보강: scannedFiles/skippedDirs, metadata cache/fetch/failure/batch latency 표시.
  - scan token + pending-path 추적으로 stale update/중복 fetch 완화.
- 검증:
  - `server/tests/media-service.test.js` 추가(페이지 카운트/경로 오류).
  - `npm test` 통과.
  - `cd client && npm run build` 통과.

## Autonomous Loop 진행 메모 (2026-04-25, R8 ACME/운영 리허설 마감 보강)

- ACME 전환 경로 구현:
  - `docker/Caddyfile.acme` 추가(공인 TLS + `/api`/`/socket.io` reverse proxy 정책 분리).
  - `docker-compose.hardened-acme.yml` 추가(ACME overlay, `WEBOS_ACME_EMAIL`/`WEBOS_ACME_CA` 환경변수).
  - `package.json`에 ACME config/up 명령 추가:
    - `hardening:acme:config`
    - `hardening:acme:up`
- 운영 리허설 자동화:
  - `tools/rehearse-storage-backup-restore.sh` 추가.
  - `npm run rehearsal:backup-restore` 추가.
  - 리허설 결과 문서:
    - `doc/operations/backup-restore-rehearsal-2026-04-25.md`
    - archives:
      - `storage/rehearsal-backups/webos_storage_20260425T062248Z.tar.gz`
      - `storage/rehearsal-backups/webos_storage_20260425T062732Z.tar.gz`
      - `storage/rehearsal-backups/webos_storage_20260425T062931Z.tar.gz`
- 운영 문서 최신화:
  - `doc/operations/remote-access-hardening-guide.md`에 ACME 전환 절차, 실도메인 조건, 위협모델 체크리스트 추가.
  - `doc/operations/local-run-guide.md`에 ACME overlay 실행/중지 절차 추가.
  - `README.md`, `doc/README.md`, `doc/operations/next-tasks-2026-04-25.md` 반영.
- 검증:
  - `caddy validate`로 `docker/Caddyfile.acme` 문법 검증 통과.
  - `docker compose ... -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml config` 통과.
  - `npm run rehearsal:backup-restore` 실기동 통과(백업 생성 -> 복구 -> marker 검증, 백업 파일 사용자 소유권 유지).

## Reference Commits
- `a105038`
- `91f8f06`
- `4ab10d8`
- `34f154c`
- `a9e136e`
