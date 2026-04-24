# Feature Scope And Priorities

## Priority Order
1. Reliability and boundary hardening
2. Package Center installed operations
3. Local workstation core (File Station/Terminal/Monitor/Logs/Docker)
4. UI customization foundation
5. Agent/LLM with approval-first model
6. Media/Home-lab expansion
7. Docker portability

## Package Center Direction
- Installed 탭 운영 밀도 강화가 Store UI보다 우선
- 런타임/라이프사이클/헬스/로그/이벤트/백업/롤백이 핵심
- install/update preflight에서 권한, 품질게이트, 의존성, 호환성, 백업 검토 제공

## Local Workstation Direction
- File Station: allowed roots, trash, share, upload/transfer 상태 우선
- Terminal: 세션 안정성 + 위험 명령 승인 모델
- System/Logs: 운영 대시보드 성격 강화
- Docker: 로그/포트/볼륨/헬스 우선 후 Compose 확장

## Implementation Order
`API/service contract -> store/helper -> minimal UI -> verification -> docs update`
