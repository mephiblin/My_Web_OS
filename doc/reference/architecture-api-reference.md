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
- 패키지 레지스트리 통합: `packageRegistryService.js`

## High-value APIs
- Auth: `/api/auth/login`, `/api/auth/verify`
- File Station: `/api/fs/*`
- System State: `/api/system/state/:key`
- Package Center: `/api/packages/*`
- Sandbox: `/api/sandbox/:appId/*`
- Services: `/api/services/*`
- Logs: `/api/logs/*`
- Docker: `/api/docker/*`

## Notes
- 인증은 JWT 기반(`Authorization: Bearer <token>`)
- 파일 경로 보호는 `pathGuard`와 `ALLOWED_ROOTS` 정책을 따른다.
- 삭제 동작은 기본적으로 휴지통 이동을 우선한다.
