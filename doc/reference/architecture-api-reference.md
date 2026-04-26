# Architecture And API Reference

이 문서는 개발자가 현재 코드 구조를 빠르게 파악하기 위한 축약 레퍼런스다.

## One-line Summary
Svelte 기반 웹 데스크톱과 Express/Socket.io 백엔드를 통해 파일, 터미널, 시스템, 패키지, 샌드박스 앱을 통합 제공한다.

## Core Layout
- Frontend: `client/src/apps`, `client/src/core`, `client/src/utils/api.js`
- Backend: `server/routes`, `server/services`, `server/utils`, `server/config`
- Storage: `server/storage/*` (JSON/log 중심 파일 기반 영속화)

## Key Runtime Flows
- 앱 목록: `/api/system/apps` + `Desktop.svelte` 컴포넌트 매핑
- 윈도우 상태: `windowStore` <-> `/api/system/state/windows`
- 샌드박스 렌더링: `SandboxAppFrame.svelte` + `/api/sandbox/:appId/*`
  - SDK ready handshake는 반복 announce + parent timeout으로 무한 로딩을 방지한다.
- 패키지 레지스트리 통합: `packageRegistryService.js`
- 터미널: `Terminal.svelte` + Socket.io + `server/services/terminal.js`
  - backend restart 시 기존 PTY는 종료되고 reconnect/new window에서 새 shell을 만든다.

## High-value APIs
- Auth: `/api/auth/login`, `/api/auth/verify`
- File Station: `/api/fs/*`
- System State: `/api/system/state/:key`
- System Overview: `/api/system/overview`
  - concurrent refresh coalescing + short TTL cache 사용.
- Network IPs: `/api/system/network-ips`
  - external IP lookup timeout + longer TTL cache 사용.
- Package Center: `/api/packages/*`
- Sandbox: `/api/sandbox/:appId/*`
- Services: `/api/services/*`
- Logs: `/api/logs/*`
- Docker: `/api/docker/*`
- Cloud: `/api/cloud/remotes`, `/api/cloud/list`, `/api/cloud/read`, `/api/cloud/raw-ticket`,
  `/api/cloud/raw`, `/api/cloud/upload`, `/api/cloud/upload-jobs/:id`, `/api/cloud/upload-jobs/:id/cancel`
  - File Station uses `cloud://<remote>/<path>` for mounted rclone/WebDAV remotes.
  - Cloud raw tickets use scope `cloud.raw` and allow document/media/model viewers to stream remote files
    without tying playback/preview to the File Station view lifetime.
  - `/api/cloud/raw` supports authenticated direct reads and unauthenticated ticket redemption with byte ranges.
  - Browser-origin direct upload remains `/api/cloud/upload`.
  - A-owned durable transfer uses `/api/cloud/transfer/preflight`, `/api/cloud/transfer/approve`,
    `/api/cloud/transfer`, `/api/cloud/transfer-jobs`,
    `/api/cloud/transfer-jobs/:id/retry`, `/api/cloud/transfer-jobs/:id/cancel`,
    `DELETE /api/cloud/transfer-jobs?statuses=...`.
- Transfer: `/api/transfer/jobs`, `/api/transfer/jobs/download`, `/api/transfer/jobs/copy`,
  `/api/transfer/jobs/:id/retry`, `/api/transfer/jobs/:id/cancel`, `DELETE /api/transfer/jobs?statuses=...`
- Package backup/lifecycle:
  - `/api/packages/:id/lifecycle`
  - `/api/packages/:id/backup-policy` (GET/PUT)
  - `/api/packages/:id/backup` (manual snapshot)
  - `/api/packages/:id/backup-jobs` (GET/POST)
  - `/api/packages/:id/backup-jobs/:jobId/cancel`
  - `/api/packages/:id/rollback/preflight`
- Media: `/api/media/info`, `/api/media/playlist`, `/api/media/station-info`
- AI assist/audit: `/api/ai/assist`, `/api/ai/audit`

## Notes
- 인증은 JWT 기반(`Authorization: Bearer <token>`)
- 파일 경로 보호는 `pathGuard`와 `ALLOWED_ROOTS` 정책을 따른다.
- 삭제 동작은 기본적으로 휴지통 이동을 우선한다.
- 위험 동작은 `code`/`message`를 포함한 명시적 오류 계약을 유지한다.
- 샌드박스 `postMessage` bridge는 clone-safe payload 경로를 사용한다.
- 샌드박스 bridge 실패는 `SANDBOX_BRIDGE_READY_TIMEOUT`처럼 명시적으로 표시되어야 하며, silent infinite loading을 만들지 않는다.
- 시스템 polling성 API는 UI 반응성을 해치지 않도록 캐시/동시요청 합치기 정책을 우선 적용한다.
- 테스트 실행은 기본적으로 `npm test`(serial) 경로를 사용한다.
