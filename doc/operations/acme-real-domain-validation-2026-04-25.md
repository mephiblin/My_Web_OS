# ACME Real-Domain Validation - 2026-04-25

Status: `[SNAPSHOT]` (R8 실도메인 최종 검증 전 단계)

## Goal

R8 목표의 최종 증적:

1. 실제 FQDN + 외부 80/443에서 ACME 발급 성공 로그
2. 외부망 `https://<domain>/health` 200 확인

## Preflight Executed

1. Compose ACME overlay config

```bash
npm run hardening:acme:config
```

- 결과: 통과

2. ACME Caddyfile validation (환경변수 주입 포함)

```bash
set -a && source .env.hardened && set +a
docker run --rm \
  -e WEBOS_ACME_EMAIL -e WEBOS_TLS_HOST -e WEBOS_ACME_CA \
  -v "$PWD/docker/Caddyfile.acme:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.0 \
  caddy validate --config /etc/caddy/Caddyfile
```

- 결과: `Valid configuration`

## Current Blocker

- 현재 `.env.hardened`는 아래와 같이 로컬 기본값 상태:
  - `WEBOS_TLS_HOST=localhost`
  - `WEBOS_PUBLIC_ORIGIN=https://localhost:8443`
- 따라서 공인 도메인 ACME 발급/외부 80·443 검증 조건이 아직 충족되지 않음.

### 왜 지금 못 하는가

- 운영자가 사용할 **실제 도메인(FQDN)** 이 아직 없음.
- 도메인이 없으면 DNS A/AAAA를 공인 IP에 연결할 수 없고,
  ACME는 소유권 검증(HTTP-01/TLS-ALPN-01)을 통과할 수 없음.
- 결과적으로 현재 단계에서는 로컬/사전검증까지만 가능하고
  "실도메인 인증서 발급 성공" 증적은 만들 수 없음.

## Required To Close R8 Final Proof

1. 공인 DNS A/AAAA 레코드가 배포 대상 공인 IP를 가리켜야 함.
2. 외부망에서 80/443 inbound가 실제로 열려 있어야 함.
3. `.env.hardened`를 실제 값으로 교체:
   - `WEBOS_TLS_HOST=<real-fqdn>`
   - `WEBOS_PUBLIC_ORIGIN=https://<real-fqdn>`
   - `WEBOS_ACME_EMAIL=<operator-email>`
4. ACME overlay 기동 후 proxy 로그에서 certificate obtain 성공 라인 확보.
5. 외부망에서 `https://<real-fqdn>/health` 200 응답 캡처.

## 실행 체크리스트 (도메인 확보 후)

1. 도메인 준비
   - 사용할 FQDN 확정 (예: `webos.example.com`)
   - DNS A/AAAA를 배포 공인 IP로 연결
2. 네트워크 준비
   - 라우터/방화벽에서 외부 80, 443 inbound 오픈
3. 환경값 교체 (`.env.hardened`)
   - `WEBOS_TLS_HOST=<real-fqdn>`
   - `WEBOS_PUBLIC_ORIGIN=https://<real-fqdn>`
   - `WEBOS_ACME_EMAIL=<operator-email>`
4. 구성 검증/기동
   - `npm run hardening:acme:config`
   - `npm run hardening:acme:up`
5. 증적 수집
   - `docker compose ... logs --tail=200 proxy`에서 ACME 발급 성공 라인 저장
   - 외부망에서 `https://<real-fqdn>/health` 200 캡처 저장
