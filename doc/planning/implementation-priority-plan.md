# Implementation Priority Plan (Planning Set)

기준일: 2026-04-25

이 문서는 `doc/planning`의 주요 플랜 문서를 실제 구현 순서로 정렬하고, 각 순서의 이유를 짧게 설명한다.

## 1) 문서별 구현 우선순위

1. **P0 - 제품/경계 고정**
   - `product-brief-home-server-remote-computer.md`
   - `project-identity-boundaries.md`
   - 이유: 무엇을 만들지/무엇을 만들지 않을지, Host 경계를 먼저 고정하지 않으면 이후 구현이 흔들린다.

2. **P1 - 운영 안정성/핵심 워크플로**
   - `feature-scope-priorities.md`
   - `app-install-file-workflow-direction.md`
   - 이유: 파일/패키지/승인/감사/복구 흐름이 코어 신뢰성의 중심이며, UI 확장보다 먼저 닫혀야 한다.

3. **P2 - 실행 순서/릴리즈 단위**
   - `roadmap-home-server-remote-computer.md`
   - 이유: R0~R8 순서를 기준으로 작업 체인을 자르고 완료 기준(DoD)을 관리한다.

4. **P3 - 현재 구현 재고/검증 대상**
   - `feature-inventory-home-server-remote-computer.md`
   - 이유: 이미 구현된 것과 남은 것을 분리해 회귀/중복개발을 줄인다.

5. **P4 - UX/개인화 고도화**
   - `ui-ux-customization-agent.md`
   - 이유: 코어 경계/신뢰성 이후에 들어가야 유지보수 비용이 낮다.

## 2) 구현 실행 우선순위 (Roadmap 연동)

1. **Core Freeze Gate**
   - R5 실사용 검증 증적(대용량 root), R8 실도메인 ACME 발급 증적 확보
   - 목표: Web OS 코어를 “완료선”에 올리고, 신규 코어 기능 확장을 중단

2. **App Ecosystem 집중 (R4~R6 확장)**
   - Memo/Todo/Bookmark/Calculator/Clipboard + Dev tool 앱 품질 고도화
   - 목표: 사용자 체감 가치를 코어가 아닌 앱 레이어에서 확장

3. **Station 실사용 완성 (R5)**
   - 라이브러리/검색/실패복구/대용량 성능 튜닝 증적 강화
   - 목표: Home Server 정체성 확보

4. **Automation 완성 (R7)**
   - 승인 카드/결과 딥링크/반복작업 감사 추적 강화
   - 목표: 운영 작업 자동화의 안전성 확보

5. **배포 하드닝 유지보수 (R8 운영)**
   - ACME/백업복구 리허설 주기 운영, 문서와 실제 절차 동기화
   - 목표: 실사용 안정성 유지

## 3) 운영 원칙

- 코어(Web OS 시스템)는 `bugfix/security/perf`만 허용하는 feature-freeze 상태로 관리한다.
- 신규 사용자 가치는 패키지/애드온 앱에서 우선 구현한다.
- 문서-코드-검증 결과가 다르면, 검증된 코드 동작 기준으로 문서를 즉시 갱신한다.
