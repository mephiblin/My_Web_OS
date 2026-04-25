# My Web OS

> 이 문서는 일반 사용자/운영자 기준 안내서입니다. 개발/에이전트 작업 기준은 `README.md`를 참고하세요.

My Web OS는 로컬 PC를 브라우저에서 운영하기 위한 Web OS 계층입니다. 커널,
가상머신, OS 대체물이 아니라 로컬 파일, 터미널, 시스템 상태, Docker, 패키지
앱을 웹 데스크톱 안에서 다루는 운영 환경입니다.

> [!WARNING]
> 이 프로젝트는 개발 중입니다. 로컬 파일, 터미널, Docker 상태, 패키지 데이터를
> 직접 다룰 수 있으므로 신뢰 가능한 개발 환경에서만 실행하세요. `ALLOWED_ROOTS`는
> 필요한 경로로 좁게 설정해야 합니다. 사용 중 발생하는 데이터 손실, 장비 문제,
> 기타 직간접 손해에 대해 프로젝트 작성자는 책임지지 않습니다.

## 제품 모델

```text
File Station = 파일 의도와 선택
Apps = 집중된 작업 흐름
Web OS = 권한, 승인, 감사, 수명주기, 복구
Package Center = 설치, 업데이트, 제거, 런타임 상태, 백업, 롤백
```

핵심 경계:

- 파일 접근은 명시적이고, 권한 기반이며, 감사 가능하고, 복구 가능해야 합니다.
- Package Center는 단순 스토어가 아니라 설치 앱 운영 콘솔입니다.
- System app은 privileged app입니다. addon/package는 Host 경계를 조용히 우회하면 안 됩니다.
- overwrite, delete, rollback, command execution 같은 위험 동작은 승인/감사/복구 흐름을 가져야 합니다.

## 현재 상태

현재 검증된 working-tree 상태는 [`AGENTS.md`](AGENTS.md)에 있고, 완료 이력은
[`doc/operations/completed-backlog-log.md`](doc/operations/completed-backlog-log.md)에
누적합니다.

구현 확인됨:

- Media Player playlist, repeat, shuffle, background audio.
- Document Viewer PDF page, zoom, search, metadata controls.
- Model Viewer wireframe, axes, material info, screenshot.
- WebDAV/cloud write, upload, mount status, async cloud upload job, retry/cancel UI.
- Transfer Manager retry, finished history clear, status summary, filtered UI.
- Package backup job queued/running/completed/failed/canceled 상태, Package Center 운영 UI, retention policy, schedule metadata.
- Docker Compose healthcheck, backend/frontend reachability, storage volume/Host binding guide, container log check path.
- Lazy-loaded app launch registry. Monaco Code Editor와 Three.js Model Viewer는 초기 desktop bundle에서 분리되어 첫 실행 시 로드됩니다.
- `/api/ai/assist` 기반 AI assist route와 Docker host-inspection intent/audit gate.

남은 리스크:

- Cloud upload progress는 local stream-to-`rclone` 진행률이며 provider-side commit confirmation은 아닙니다.
- Monaco와 Three.js의 큰 deferred vendor chunk는 남아 있습니다. 초기 desktop payload에서는 제거된 상태입니다.
- 직접 multi-file `node --test` 호출에서 package backup integration test isolation/timing flakiness가 있었습니다. 루트 `npm test`는 serial 실행으로 통과합니다.

다음 활성 backlog는 [`AGENTS.md`](AGENTS.md)의
`A11. Test Isolation And Regression Coverage`입니다.

## 기능 영역

### Web Desktop

- Svelte 5 기반 desktop shell: window, taskbar, start menu, spotlight search, context menu, widget, persisted layout.
- built-in system app과 trusted addon을 `client/src/apps/system/*`, `client/src/apps/addons/*`로 분리.
- 무거운 앱은 app launch registry에서 첫 실행 시 lazy-load.

### File Station / Local Files

- allowed-root browsing, create/read/update/delete, upload, trash, share link, indexed search, Open With flow.
- built-in addon과 package app을 위한 file association 및 launch-context 모델.
- read/readwrite single-file grant 방향과 overwrite approval policy.
- wallpaper/media reference를 위한 Media Library import flow.

### Terminal / System / Logs / Docker

- Socket.io와 `node-pty` 기반 real terminal session.
- backend service route 기반 system resource 및 operation summary.
- Log Viewer와 audit/event log 저장.
- Docker Manager image, log, port, volume, health, Compose portability validation.

### Package Center / Sandbox Runtime

- registry source management, remote package install, import/export, preflight, manifest editing, quality check, package doctor.
- installed app runtime, lifecycle, health, permission, file association, app data boundary, backup, retention, rollback direction.
- `/api/sandbox/:appId/*` 기반 sandbox HTML runtime.
- manifest permission으로 보호되는 sandbox SDK와 app-owned data API.

### Cloud / Transfer Operations

- `rclone` 기반 cloud listing, mount status, write/upload path, async upload job tracking.
- Transfer Manager active/completed/failed/canceled job 표시, retry, cleanup operation.
- Download Station + Photo/Music/Document/Video Station 기본 워크플로(라이브러리 검색/그룹핑/최근 항목/실패 상태 표시).

### Agent / Automation

- Agent UI와 `/api/ai/assist` backend route.
- Host/Docker inspection은 사용자 intent와 audit logging으로 제한.
- 권장 흐름은 explanation -> summary -> approval -> execution -> result reporting입니다.

## 기술 스택

Frontend:

- Svelte 5, Vite
- Monaco Editor
- Xterm.js
- Chart.js / svelte-chartjs
- Three.js
- Lucide Svelte

Backend:

- Node.js, Express 5
- Socket.io
- node-pty
- systeminformation
- chokidar
- JWT / bcryptjs
- multer
- fs-extra
- rclone service integration

Storage:

- `server/storage/*` 아래 JSON/log 중심 file-based storage.
- built-in app registry source of truth:
  `server/storage/inventory/system/apps.json`.
- package app path:
  `server/storage/inventory/apps/<app-id>/`.

## 빠른 실행

요구 사항:

- Node.js 18 이상, Node.js 20+ 권장.
- cloud 기능 사용 시 `rclone`.
- media metadata/thumbnail workflow 사용 시 `ffmpeg`.
- storage health check 사용 시 `smartmontools`.
- Docker portability profile 사용 시 Docker와 Docker Compose.

루트 `.env` 예시:

```env
PORT=3000
JWT_SECRET=replace_me
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace_me
NODE_ENV=development
ALLOWED_ROOTS=["/home/user/Documents","/path/to/data"]
INITIAL_PATH=/home/user
INDEX_DEPTH=5
```

Backend:

```bash
npm install
npm run apps:registry:migrate
node server/index.js
```

Frontend:

```bash
cd client
npm install
npm run dev
```

접속:

```text
http://localhost:5173
```

로그인은 `.env`의 `ADMIN_USERNAME`, `ADMIN_PASSWORD`를 사용합니다.

## Docker Portability Profile

Docker Compose는 production hardening이 아니라 반복 가능한 local validation 용도입니다.

```bash
docker compose config
docker compose up -d --build
docker compose ps
```

기본 포트:

- Backend: `3000`
- Frontend: `5173`

Storage / Host binding:

- `webos_storage` named volume -> `/app/server/storage`
- `./data` -> `/workspace/data`
- `./media` -> `/workspace/media`
- Compose의 `ALLOWED_ROOTS`는 `/workspace/data`, `/workspace/media` 같은 container path를 기준으로 설정합니다.

Smoke check:

```bash
node -e "fetch('http://127.0.0.1:3000/health').then(r=>{console.log('backend',r.status);process.exit(r.status===200?0:1)}).catch(()=>process.exit(1))"
node -e "fetch('http://127.0.0.1:5173').then(r=>{console.log('frontend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Logs / shutdown:

```bash
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
docker compose down
```

상세 가이드:
[`doc/operations/local-run-guide.md`](doc/operations/local-run-guide.md).

## Remote Access Hardening (R8 Starter)

`docker-compose.hardened.yml`은 reverse proxy + TLS 종료 + backend 비직노출 구성을 제공하는 하드닝 프로필입니다.

부트스트랩:

```bash
npm run hardening:env
```

`hardening:env`는 랜덤 `JWT_SECRET`/`ADMIN_PASSWORD`를 포함한 `.env.hardened` 템플릿을 생성합니다.

실행:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml up -d --build
docker compose --env-file .env.hardened -f docker-compose.hardened.yml ps
```

공인 도메인 ACME 전환:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml up -d --build
```

운영 백업/복구 리허설:

```bash
npm run rehearsal:backup-restore
```

기본 접속:

- `https://localhost:8443` (`Caddy tls internal` 기본)

세부 절차(관리자 비밀번호 회전, allowed roots 최소권한, 백업/복구, 외부 노출 do/don't):

- [`doc/operations/remote-access-hardening-guide.md`](doc/operations/remote-access-hardening-guide.md)

## Package App 기본 구조

Sandbox/package app 위치:

```text
server/storage/inventory/apps/<app-id>/
```

최소 manifest 예시:

```json
{
  "id": "hello-sandbox",
  "title": "Hello Sandbox",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": ["app.data.list", "app.data.read", "app.data.write"],
  "fileAssociations": [
    {
      "extensions": ["txt", "md"],
      "actions": ["open", "edit"],
      "defaultAction": "open"
    }
  ]
}
```

검증:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

상세 문서:
[`doc/reference/package-ecosystem-guide.md`](doc/reference/package-ecosystem-guide.md).

## 검증 명령

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

Server tests:

```bash
npm test
```

Frontend build:

```bash
cd client
npm run build
```

Registry/package checks:

```bash
npm run apps:registry:migrate
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

## 문서 지도

Planning:

- [`doc/planning/product-brief-home-server-remote-computer.md`](doc/planning/product-brief-home-server-remote-computer.md)
- [`doc/planning/feature-inventory-home-server-remote-computer.md`](doc/planning/feature-inventory-home-server-remote-computer.md)
- [`doc/planning/roadmap-home-server-remote-computer.md`](doc/planning/roadmap-home-server-remote-computer.md)
- [`doc/planning/project-identity-boundaries.md`](doc/planning/project-identity-boundaries.md)
- [`doc/planning/feature-scope-priorities.md`](doc/planning/feature-scope-priorities.md)
- [`doc/planning/app-install-file-workflow-direction.md`](doc/planning/app-install-file-workflow-direction.md)
- [`doc/planning/ui-ux-customization-agent.md`](doc/planning/ui-ux-customization-agent.md)

Operations:

- [`doc/operations/local-run-guide.md`](doc/operations/local-run-guide.md)
- [`doc/operations/remote-access-hardening-guide.md`](doc/operations/remote-access-hardening-guide.md)
- [`doc/operations/backup-restore-rehearsal-2026-04-25.md`](doc/operations/backup-restore-rehearsal-2026-04-25.md)
- [`doc/operations/completed-backlog-log.md`](doc/operations/completed-backlog-log.md)
- [`doc/operations/next-tasks-2026-04-25.md`](doc/operations/next-tasks-2026-04-25.md)
- [`doc/operations/package-troubleshooting.md`](doc/operations/package-troubleshooting.md)

Reference:

- [`doc/reference/architecture-api-reference.md`](doc/reference/architecture-api-reference.md)
- [`doc/reference/app-development-model.md`](doc/reference/app-development-model.md)
- [`doc/reference/package-ecosystem-guide.md`](doc/reference/package-ecosystem-guide.md)
- [`doc/reference/app-ownership-matrix.md`](doc/reference/app-ownership-matrix.md)

Policies / migrations:

- [`doc/policies/file-station-places-policy.md`](doc/policies/file-station-places-policy.md)
- [`doc/migrations/media-library-path-migration.md`](doc/migrations/media-library-path-migration.md)

## 문서 작업 필요 항목

- 실도메인 환경에서 ACME 발급 성공 로그/스크린샷을 `doc/operations`에 추가해야 합니다.
- R5 Station 실사용(대용량 allowed root) 수동 검증 증적을 `doc/operations`에 추가해야 합니다.
- generated storage 파일(`server/storage/index.json`)의 커밋 제외 정책은 계속 유지하고, 예외 포함 시 근거를 로그에 남겨야 합니다.
