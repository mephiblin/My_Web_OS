# My Web OS - Developer README

이 문서는 개발자/에이전트(Codex) 작업 기준 문서다.
일반 사용자용 안내는 `USER_README.md`를 본다.

## 1) Project Positioning

My Web OS는 개인 PC/홈서버를 브라우저에서 운영하기 위한 Web OS 계층이다.

- 커널 OS 대체물 아님
- 공개 멀티테넌트 서비스 아님
- Host 권한 동작은 승인/감사/복구 가능성이 우선

핵심 모델:

```text
Home Server = files, media, backup, services, Docker, logs
Remote Computer = terminal, app launch, file editing, system state
Web OS = permissions, approval, audit, lifecycle, recovery
Package Center = install/create/run/update/backup/rollback
```

## 2) Canonical Docs Matrix

우선순위:

1. `AGENTS.md` + roadmap/product brief
2. active planning/reference docs
3. dated operations snapshot
4. archive/legacy docs

문서 상태 인덱스는 `doc/README.md`를 사용한다.

핵심 문서:

- `AGENTS.md` (작업 규약/로드맵/검증 기준)
- `doc/planning/product-brief-home-server-remote-computer.md`
- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/planning/feature-inventory-home-server-remote-computer.md`
- `doc/reference/architecture-api-reference.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/operations/completed-backlog-log.md`
- `doc/operations/local-run-guide.md`
- `doc/operations/remote-access-hardening-guide.md`

사용자 문서:

- `USER_README.md`

## 3) Development Workflow

기본 순서:

1. `contract/API`
2. `service/helper/store`
3. `minimal UI`
4. `verification`
5. `docs sync`

원칙:

- 경계(approval/audit/recovery) 먼저, UI 폴리시 나중
- route는 얇게, 서비스에 상태 전이 집중
- 위험 동작(delete/overwrite/rollback/exec)은 절대 silent 금지
- `Desktop.svelte`, `Window.svelte`에 앱별 기능 로직 직접 추가 금지
- dirty worktree의 unrelated 변경은 절대 되돌리지 않기

## 4) Layer Ownership

### Host

- `server/routes/fs.js`
- `server/routes/system.js`
- `server/routes/settings.js`
- `server/routes/docker.js`
- `server/routes/logs.js`
- `server/routes/cloud.js`
- `server/routes/transfer.js`
- `server/services/*`

### Web Desktop

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`
- `client/src/core/components/*`
- `client/src/core/stores/*`

### App Install / File Workflow

- `client/src/apps/system/file-explorer/*`
- `client/src/apps/system/transfer/*`
- `client/src/apps/addons/*`
- `server/services/fileGrantService.js`
- `server/services/cloudService.js`

### Sandbox / Package

- `client/src/apps/system/package-center/*`
- `server/routes/packages.js`
- `server/routes/runtime.js`
- `server/routes/sandbox.js`
- `server/services/packageRegistryService.js`
- `server/services/packageLifecycleService.js`
- `server/services/runtimeManager.js`

## 5) Verification Commands

Backend syntax:

```bash
node --check server/routes/packages.js
node --check server/routes/runtime.js
node --check server/routes/fs.js
node --check server/routes/cloud.js
node --check server/routes/ai.js
node --check server/services/packageLifecycleService.js
node --check server/services/runtimeManager.js
node --check server/services/cloudService.js
node --check server/services/aiActionService.js
```

Tests/build:

```bash
npm test
cd client && npm run build
```

Registry/package checks:

```bash
npm run apps:registry:migrate
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

Compose smoke:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
docker compose down
```

## 6) Runtime File Tracking

커밋 전 확인:

- `server/index.js`가 import하는 route/service 누락 여부
  - 특히 `server/routes/ai.js`, `server/services/aiActionService.js`
- generated storage churn (`server/storage/index.json`) 포함 의도 여부
- `git status --short` 기준으로 의도한 파일만 stage 되었는지

## 7) Roadmap Execution Rule

`AGENTS.md`의 backlog를 기준으로 첫 미완 항목부터 수행한다.

- 기본은 한 아이템씩
- 체인 요청이 있을 때만 연속 수행
- 각 아이템 종료 시 변경/검증/남은 리스크/다음 아이템을 보고

## 8) Doc Lifecycle Rule

- active 문서: 현재 구현 판단 기준
- snapshot 문서: 특정 날짜 시점 기록
- completed 문서: 완료 증적
- legacy 문서: 1회성 이관/하위호환 대응
- archived 문서: 신규 작업 기준 아님

아카이브 문서는 `doc/archive/README.md`와 그 하위 경로에서 관리한다.
