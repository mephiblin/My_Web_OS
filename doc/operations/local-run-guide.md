# Local Run Guide

Web OS는 백엔드와 프론트엔드 두 프로세스를 함께 실행해야 정상 동작한다.

## Backend
- 위치: 프로젝트 루트
- 실행:
```bash
npm install
npm run apps:registry:migrate
node server/index.js
```
- 기본 포트: `3000`

운영 메모:

- 백엔드를 재시작하면 열려 있던 Terminal PTY/local shell 세션은 종료된다.
- 프론트 터미널 창은 재연결 시 새 shell을 요청하지만, 기존 shell의 작업 상태는 복구되지 않는다.
- `server/storage/index.json`과 `server/storage/media-library/`는 로컬 런타임 산출물이므로 Git 추적 대상이 아니다.

`apps:registry:migrate`는 legacy `server/storage/apps.json`을
`server/storage/inventory/system/apps.json`로 1회 이관하는 명령이다.
legacy가 없으면 built-in seed로 `apps.json`을 생성한다.
이미 `inventory/system/apps.json`이 있으면 자동으로 skip 된다.
검증 게이트에서는 `--dry-run --fail-on-removal`로 현재 registry에서
사라질 앱 id가 있는지 확인한다.

## Frontend
- 위치: `client/`
- 실행:
```bash
cd client
npm install
npm run dev
```
- 기본 포트: `5173`

## Docker Compose (Portability)
- 위치: 프로젝트 루트
- 실행:
```bash
docker compose up -d --build
```
- 서비스:
  - frontend: `5173`
  - backend: `3000`

스토리지/바인딩 전략:
- 영속 inventory/state: named volume `webos_storage` -> `/app/server/storage`
- Host 작업 경로 바인딩:
  - `./data` -> `/workspace/data`
  - `./media` -> `/workspace/media`
- 기본 allowed roots는 compose 환경변수(`ALLOWED_ROOTS`)로 `/workspace/data`, `/workspace/media`를 사용.

컨테이너 로그:
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

실기동 검증(DoD):
```bash
docker compose config
docker compose up -d --build
docker compose ps
```

기본 상태 확인:
- `backend`, `frontend`가 `Up` 상태이고 `health`가 `healthy`여야 한다.
- `frontend`는 `backend`가 healthy 된 뒤에 시작된다(`depends_on.condition: service_healthy`).

HTTP 스모크 체크:
```bash
node -e "fetch('http://127.0.0.1:3000/health').then(r=>{console.log('backend',r.status);process.exit(r.status===200?0:1)}).catch(()=>process.exit(1))"
node -e "fetch('http://127.0.0.1:5173').then(r=>{console.log('frontend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

로그 스냅샷(증거):
```bash
docker compose logs --tail=80 backend
docker compose logs --tail=80 frontend
```

중지/정리:
```bash
docker compose down
```

## Docker Compose (Hardened Remote Access Profile)

reverse proxy + TLS + backend 비직노출 구성은 `docker-compose.hardened.yml`를 사용한다.

```bash
npm run hardening:env
docker compose --env-file .env.hardened -f docker-compose.hardened.yml config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml up -d --build
docker compose --env-file .env.hardened -f docker-compose.hardened.yml ps
```

기본 접속:

- `https://localhost:8443`

기본 로그 확인:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml logs --tail=80 backend
docker compose --env-file .env.hardened -f docker-compose.hardened.yml logs --tail=80 proxy
```

중지:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml down
```

세부 하드닝 지침:

- `doc/operations/remote-access-hardening-guide.md`

운영 백업/복구 리허설:

```bash
npm run rehearsal:backup-restore
```

### ACME 공인 TLS 전환

공인 도메인 운영은 오버레이 compose를 추가해 실행한다.

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml up -d --build
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml logs --tail=120 proxy
```

중지:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml down
```

## Access
- 브라우저: `http://localhost:5173`
- 로그인: `.env`의 `ADMIN_USERNAME`, `ADMIN_PASSWORD`

## Quick Health Check
```powershell
netstat -ano | findstr ":3000"
netstat -ano | findstr ":5173"
```
`LISTENING`이면 정상.

HTTP 기준 스모크:

```bash
node -e "fetch('http://127.0.0.1:3000/health').then(r=>{console.log('backend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
node -e "fetch('http://127.0.0.1:5173').then(r=>{console.log('frontend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

## Stop
- 포그라운드: `Ctrl + C`
- 백그라운드:
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "server/index.js|vite" } | Select-Object ProcessId,Name,CommandLine
Stop-Process -Id <PID> -Force
```
