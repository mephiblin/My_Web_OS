# Next Tasks - 2026-04-25

> Status: `[SNAPSHOT]` (2026-04-25 기준). 현재 우선순위 충돌 시 `AGENTS.md` roadmap을 우선한다.

`AGENTS.md` active roadmap 기준으로 다음 작업을 정리한다.

## R0 / A11 상태

완료됨(워킹트리 기준):

- cloud upload leaf filename validation regression test
- backup-policy nonexistent app behavior regression test
- backup job queued-to-running cancel race regression test
- transfer `error -> failed` status normalization regression test
- sandbox `postMessage` payload clone safety regression test
- `server/routes/ai.js`, `server/services/aiActionService.js` syntax/dependency 확인

검증 메모:

- `npm test`는 `--test-concurrency=1` 경로에서 통과.
- 직접 multi-file `node --test fileA fileB ...`는 shared file-store write 경합으로 간헐 실패 가능.
  - 관측일: 2026-04-25
  - 권장: 루트 `npm test` 또는 `node --test --test-concurrency=1 ...`

## 다음 우선순위 (R5 중심 + R8 실도메인 검증)

1. R5 Station 실사용 검증 마감:
   - 대용량 allowed root(실데이터)에서 scan limits/truncation/manual UX 체감 체크 기록,
   - metadata cache hit/failure/batch latency 수동 검증 스냅샷 문서화.
2. R8 실도메인 ACME 최종 검증:
   - 실제 FQDN + 외부 80/443 환경에서 `docker-compose.hardened-acme.yml` 발급 성공 로그 확보,
   - 외부망에서 `https://<domain>/health` 200 증거 확보.
3. 앱 생태계 페이즈 전환 준비:
   - 코어는 bugfix/security/perf만 유지,
   - 신규 사용자 가치 개발은 package/addon 앱 백로그(R4~R6 확장)로 집중.

## 운영 정책 결정 필요

- `server/storage/index.json` 포함 generated storage 파일은 기본적으로 커밋 제외.
- 예외: 테스트 fixture 증거 또는 의도된 시드 변경일 때만 포함.
