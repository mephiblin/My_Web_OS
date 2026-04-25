# Backup/Restore Rehearsal - 2026-04-25

> Status: `[COMPLETED]` dated rehearsal evidence (2026-04-25).

R8 운영 리허설 기록.

## 목표

- hardened 배포 프로필에서 `webos_storage` volume 백업/복구 절차가 실제로 동작하는지 검증.
- ACME 전환 구성 파일이 문법/compose 단계에서 유효한지 검증.

## 실행 일시

- 2026-04-25 (KST)

## 실행 커맨드

```bash
npm run hardening:env
docker compose --env-file .env.hardened -f docker-compose.hardened.yml -f docker-compose.hardened-acme.yml config
docker run --rm -v "$PWD/docker/Caddyfile.acme:/etc/caddy/Caddyfile:ro" \
  -e WEBOS_PUBLIC_ORIGIN=https://example.com \
  -e WEBOS_TLS_HOST=example.com \
  -e WEBOS_ACME_EMAIL=admin@example.com \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile
npm run rehearsal:backup-restore
```

## 결과

1. ACME overlay compose config:
   - `docker-compose.hardened.yml + docker-compose.hardened-acme.yml` 병합 결과 유효.
2. ACME Caddyfile syntax:
   - `caddy validate` 결과 `Valid configuration`.
3. 백업/복구 리허설:
   - marker 생성 -> 백업 생성 -> marker 변경 -> 복구 -> marker 복원 검증 성공.
   - 생성 아카이브:
     - `storage/rehearsal-backups/webos_storage_20260425T062248Z.tar.gz`
     - `storage/rehearsal-backups/webos_storage_20260425T062732Z.tar.gz`
     - `storage/rehearsal-backups/webos_storage_20260425T062931Z.tar.gz`
   - SHA256:
     - `056b83e4004a1974d1daa38e7fa6c490d63bad395112441baf6a91e7d67eed6f`
     - `a2dd95d2a18432b144c8882b2f3de5e1cb6969d550f70e3b2906b449f692eb11`
     - `65f6e8276af63e43a7a68e1ffd7a013a406f3c38f466cacad4edb3b86a812df3`
   - 스크립트는 `webos_storage` volume 이름을 compose label 기반으로 자동 탐지하도록 개선.
   - 백업 파일 소유권을 현재 사용자로 정리하는 단계(`chown`) 포함.

## 판정

- 로컬/내부 환경 기준 R8 backup/restore 절차는 실행 가능하고 재현 가능.
- ACME는 구성/문법 준비 완료.
- 단, 공인 인증서 실제 발급 성공은 **실도메인 + 외부 80/443 개방 환경**에서 최종 실증 필요.
