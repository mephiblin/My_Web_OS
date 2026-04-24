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
- Start Menu / Taskbar settings / Window defaults / Agent chat panel 기반 (워킹트리 반영)

### P1
- Code Editor <-> Package Center 파일 편집 연동 (워킹트리 반영)
- Package creation wizard (워킹트리 반영)
- Manifest editor UI + preflight/save (워킹트리 반영)
- Theme presets / desktop layout persistence / Agent status 확장 / Wrapped UI skeleton (워킹트리 반영)

### P2
- Context menu customization (워킹트리 반영)
- App-specific window backgrounds (워킹트리 반영)
- Docker logs/ports/volumes/Compose 확장 (워킹트리 반영)
- Media playlist/background audio (워킹트리 반영)
- Document Viewer controls/search (워킹트리 반영)
- Model Viewer advanced inspection (워킹트리 반영)

### P3
- WebDAV/cloud write + mount status (워킹트리 반영)
- Backup job manager (워킹트리 반영)
- Service/runtime/package dashboard (워킹트리 반영)
- Download/transfer manager (워킹트리 반영)
- Docker packaging/portability (워킹트리 반영)

### P4
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

## Reference Commits
- `a105038`
- `91f8f06`
- `4ab10d8`
- `34f154c`
- `a9e136e`
