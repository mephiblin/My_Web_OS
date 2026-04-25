# Station Real-Use Validation - 2026-04-25

Status: `[COMPLETED]` (R5 실사용 검증 스냅샷)

## Scope

- 대상: Station 계열(`photo/music/video/document-station`) 공통 셸의 대용량 루트 스캔 제한, 절단(truncation), 메타데이터 배치/캐시 동작
- 기준 구현:
  - `client/src/apps/system/station/StationShell.svelte`
  - `server/services/mediaService.js`

## Execution

명령:

```bash
node tools/station-real-use-snapshot.js
```

실행 시각(UTC): `2026-04-25T07:57:26.239Z`

대상 루트: `/home/inri` (실데이터)

## Snapshot Result

```json
{
  "scan": {
    "durationMs": 66,
    "scannedDirs": 120,
    "scannedFiles": 426,
    "skippedDirs": 716,
    "truncated": true,
    "reason": "Directory scan limit reached (120).",
    "collectedFiles": 426
  },
  "metadataCandidates": 40,
  "metadata": {
    "cold": {
      "cached": 0,
      "requested": 40,
      "fetched": 5,
      "failed": 35,
      "lastBatchMs": 17
    },
    "warm": {
      "cached": 40,
      "requested": 0,
      "fetched": 0,
      "failed": 0,
      "lastBatchMs": 0
    }
  }
}
```

## Interpretation

- 스캔 상한 동작 확인:
  - `MAX_SCAN_DIRS=120`에서 절단 발생 및 사유 문자열 생성 확인.
- 대용량 루트에서 절단/스킵 지표 확인:
  - `skippedDirs=716`, `truncated=true`.
- 메타데이터 배치/캐시 동작 확인:
  - cold 배치에서 요청/성공/실패 집계(`requested/fetched/failed`) 생성.
  - warm 배치에서 `cached=40`, 추가 요청 0 확인.

## Notes

- 본 문서는 headless 실측 스냅샷이다.
- UI 수동 체감 점검(실제 화면 조작 기반)은 운영자 세션에서 동일 루트로 별도 확인 가능하며,
  이 스냅샷의 수치(`truncated`, `reason`, `metadata batch`)를 기준으로 대조한다.
