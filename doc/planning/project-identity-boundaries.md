# Project Identity And Boundaries

## Identity
My Web OS는 기존 OS를 대체하는 커널/가상머신이 아니라, 로컬 PC를 웹에서 운영하기 위한 개인 워크스페이스 계층이다.

핵심 목표:
- 로컬 PC 기능을 웹 데스크톱으로 명확하게 노출
- 운영 가시성(헬스, 로그, 이벤트, 복구)을 기본값으로 제공
- Package Center를 단순 스토어가 아닌 운영 콘솔로 발전

## System Boundaries

### Host Layer
- 실제 파일 시스템, 터미널, 시스템 상태, Docker, 서비스 제어 담당
- 강한 권한을 갖기 때문에 명시적 오류 코드와 복구 흐름이 필요

### Web Desktop Layer
- 사용자 상호작용 표면(창, 태스크바, 검색, 알림, 개인화) 담당
- `Desktop.svelte`는 오케스트레이션만, 앱 로직은 앱/스토어/서비스로 분리

### Sandbox / Package Layer
- 설치 앱, 앱 데이터, 런타임 상태, 라이프사이클 관리 담당
- app-owned data root와 manifest 권한 경계를 유지
- 승인 없는 Host 접근 확장은 금지

## Reliability Rules
- UI보다 경계/오류/복구/백업/롤백 모델을 우선 구현
- 위험 동작(삭제, overwrite, rollback, command 실행)은 사용자 승인 필요
- 상태/경로/manifest/runtime 검증은 백엔드에서 수행
