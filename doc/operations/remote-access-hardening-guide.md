# Remote Access Hardening Guide (R8 Starter)

> Status: `[ACTIVE]` pre-real-use hardening baseline guide.

이 문서는 Web OS를 신뢰 가능한 개인 서버에서 원격 접속용으로 올리기 전 최소 하드닝 절차를 다룬다.

## 1) 범위와 전제

- 대상: 개인 소유 PC/홈서버/홈랩.
- 비대상: 공개 멀티테넌트 서비스, 엔터프라이즈 RBAC.
- 목적: reverse proxy + TLS + bootstrap + allowed roots 최소권한을 갖춘 배포 프로필을 제공.

## 2) 하드닝 프로필 구성

추가된 파일:

- `docker-compose.hardened.yml`
- `docker-compose.hardened-acme.yml`
- `docker/Dockerfile.proxy`
- `docker/Caddyfile.hardened`
- `docker/Caddyfile.acme`
- `.env.hardened.example`
- `tools/generate-hardened-env.js`
- `tools/rehearse-storage-backup-restore.sh`

구성 요약:

- `proxy`(Caddy): TLS 종료 + static frontend 서빙 + `/api`, `/socket.io`를 backend로 reverse proxy.
- `backend`(Express): 외부 포트 미노출, 내부 네트워크에서만 수신.
- `TRUST_PROXY_HOPS=1` 기준으로 실제 클라이언트 IP 전달 처리.

## 3) 부트스트랩 (Admin/JWT/Origin)

1. 하드닝 env 생성:

```bash
npm run hardening:env
```

2. 생성된 `.env.hardened`를 열어서 최소 아래를 검토:

- `WEBOS_PUBLIC_ORIGIN`
- `WEBOS_TLS_HOST`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `ALLOWED_ROOTS`
- `INITIAL_PATH`

3. `ALLOWED_ROOTS`는 JSON 배열이며, container 기준 경로여야 한다.
   - 권장: `["/workspace/data","/workspace/media"]`
   - 금지: `["/"]`, `["/workspace"]` 같이 과도하게 넓은 범위
4. `WEBOS_TLS_HOST`는 인증서 CN/SAN에 들어갈 host다.
   - 로컬 검증: `localhost`
   - 공인 도메인 배포: 실제 FQDN

## 4) 실행 절차 (TLS Reverse Proxy)

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml config
docker compose --env-file .env.hardened -f docker-compose.hardened.yml up -d --build
docker compose --env-file .env.hardened -f docker-compose.hardened.yml ps
```

기본 포트:

- HTTP redirect: `8080`
- HTTPS: `8443`

기본 URL:

- `https://localhost:8443` (`tls internal` 인증서 사용)

## 4-A) 공인 도메인 + ACME 전환 절차

`tls internal`에서 공인 인증서로 전환할 때는 ACME 오버레이 compose를 사용한다.

필수 조건:

- 공인 도메인 A/AAAA 레코드가 서버 IP를 가리켜야 함.
- 외부에서 `80`, `443` 포트 접근 가능해야 함(방화벽/포트포워딩 포함).
- `.env.hardened`에서 아래 값 설정:
  - `WEBOS_PUBLIC_ORIGIN=https://<your-domain>`
  - `WEBOS_TLS_HOST=<your-domain>`
  - `WEBOS_HTTP_PORT=80`
  - `WEBOS_HTTPS_PORT=443`
  - `WEBOS_ACME_EMAIL=<admin-email>`

구성 검증:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml config
```

ACME 모드 기동:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml up -d --build
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml logs --tail=120 proxy
```

초기 발급 검증 포인트:

- proxy 로그에 certificate obtain success가 출력되는지 확인.
- 외부 네트워크에서 `https://<your-domain>/health`가 `200`인지 확인.

실패 시 1차 점검:

- DNS 전파 지연
- `80/443` inbound 차단
- `WEBOS_TLS_HOST` 오타
- ACME rate limit

## 5) 스모크 검증

```bash
node -e "fetch('http://127.0.0.1:8080').then(r=>{console.log('http',r.status,r.headers.get('location')||'');process.exit((r.status===301||r.status===302)?0:1)}).catch(()=>process.exit(1))"
curl -k -s -o /tmp/webos-health.json -w "%{http_code}\n" https://localhost:8443/health
curl -k -s -o /tmp/webos-login-check.json -w "%{http_code}\n" https://localhost:8443/api/auth/verify
```

- `/health`는 `200`이 정상이다.
- `/api/auth/verify`는 토큰 없이 호출하면 `401`이 정상이다.

로그:

```bash
docker compose --env-file .env.hardened -f docker-compose.hardened.yml logs --tail=80 backend
docker compose --env-file .env.hardened -f docker-compose.hardened.yml logs --tail=80 proxy
```

## 6) 관리자 비밀번호 교체 (운영 중 회전)

1. 현재 계정으로 로그인해서 토큰 발급.
2. `PUT /api/settings`로 `ADMIN_PASSWORD` 업데이트.
3. `restartRequired: true`가 반환되면 컨테이너 재시작.

예시(개념):

```bash
curl -k -X POST https://localhost:8443/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<current-password>"}'
```

> 운영에서는 최초 부트스트랩 직후 임시 비밀번호를 즉시 교체한다.

## 7) Allowed Roots 하드닝 체크리스트

- [ ] 업무 경로만 명시 (`/workspace/data`, `/workspace/media` 등)
- [ ] 루트(`/`) 또는 홈 전체(`/home/...`) 직접 허용 금지
- [ ] `INITIAL_PATH`가 `ALLOWED_ROOTS` 중 하나의 하위인지 확인
- [ ] 공유/업로드/삭제 테스트를 허용된 루트 안에서만 실행

## 8) 백업/복구 기본 원칙

- 영속 상태는 `webos_storage` volume에 존재.
- 운영 전/업데이트 전 volume 백업을 먼저 만든다.
- 복구 리허설(테스트 환경 복원)을 최소 1회 수행한다.

리허설 자동화:

```bash
npm run rehearsal:backup-restore
```

스크립트는 아래를 자동 수행한다:

1. hardened stack 기동
2. volume marker 생성
3. `storage/rehearsal-backups/*.tar.gz` 백업 생성
4. marker 변경(드리프트 시뮬레이션)
5. 백업 복구
6. marker 복구 검증 후 stack 정리

실행 기록은 `doc/operations/backup-restore-rehearsal-YYYY-MM-DD.md` 형태로 남긴다.
현재 최신 기록: `doc/operations/backup-restore-rehearsal-2026-04-25.md`.

## 9) 외부 노출 전 금지/권장

금지:

- TLS 없이 포트 직노출
- default/약한 `ADMIN_PASSWORD`, `JWT_SECRET` 사용
- 과도하게 넓은 `ALLOWED_ROOTS` 허용

권장:

- 방화벽에서 trusted source만 허용
- 관리자 비밀번호 정기 교체
- audit/log 확인 루틴 운영
- 외부 DNS/공인 TLS 도입 시 `docker-compose.hardened-acme.yml` 오버레이로 ACME 발급 경로를 사용

## 10) Remote Access Threat Model (Minimum)

신뢰 경계:

- 인터넷 -> reverse proxy(443)
- reverse proxy -> backend 내부망(3000 expose only)
- backend -> allowed roots(`ALLOWED_ROOTS`) + storage volume

최소 위협/대응:

- Credential brute force:
  - rate-limit 유지, 강한 admin 비밀번호, 주기적 교체
- Token 탈취:
  - HTTPS 강제, HSTS, 비신뢰 네트워크에서 평문 접속 금지
- 과도한 Host 파일 접근:
  - `ALLOWED_ROOTS` 최소화, 루트/홈 전체 허용 금지
- 원격 명령 오남용:
  - 승인/audit/recovery 흐름 유지, 로그 주기적 검토
- 백업 미검증:
  - 리허설 자동화 스크립트를 운영 주기(예: 월 1회)로 실행
