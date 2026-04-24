# Core-System / App-Addon 분리 정비안

## 목적

현재 구조는 `논리 분리`는 진행됐지만 `물리 분리`와 `레거시 제거`가 완전하지 않습니다.  
이 문서는 코어 시스템을 안정적으로 유지하면서, 코어 외 기능을 앱-애드온 모델로 정리하는 전체 해결방안을 정의합니다.

## 현재 이슈 요약

1. 앱 모델은 `system / standard / package`로 분류되지만, 실제 폴더/런타임 분리가 혼재됨
2. Desktop 실행은 registry 기반으로 전환됐으나, 빌트인 컴포넌트 매핑 의존이 남아 있음
3. 앱 레지스트리 로딩에 legacy fallback(`server/storage/apps.json`)이 남아 있음
4. 코어 외 앱도 `client/src/apps/*`에 함께 존재하여 addon 경계가 약함
5. “done” 상태 대비 아키텍처 완결성이 일부 부족함 (운영/문서 기준 불일치)

## 목표 상태

`Core(신뢰/권한)`와 `Addon(확장/교체 가능)`를 명확히 분리합니다.

- Core System
  - Host 권한 필요 기능: File Station, Terminal, Settings, Control Panel, Resource Monitor, Log Viewer, Docker Manager, Package Center
  - 코드 기준: `client/src/apps/system/*`, `server/routes/*`, `server/services/*`
- App Addon
  - 일반 사용자 앱/도구(예: player, doc-viewer, model-viewer, editor, widget-store 등)
  - 코드 기준:
    - 개발형 내장 addon: `client/src/apps/addons/*`
    - 패키지형 addon: `server/storage/inventory/apps/<appId>/` + manifest
- Launch 단일 규칙
  - Desktop은 `launch.mode`만 보고 실행 (`component` 또는 `sandbox`)
  - shell은 실행 라우팅만 담당, 앱 세부 로직 금지

## 해결 전략 (단계별)

## 실행 상태 (2026-04-24)

- Phase 1: 완료
- Phase 2: 완료
- Phase 3: 완료 (`readBuiltinRegistry` legacy fallback 제거, `tools/migrate-apps-registry.js` 추가)
- Phase 4: 완료 (built-in registry manifest-like 필드 정규화, `tools/package-doctor.js` builtin registry 검증 확장)
- Phase 5: 완료 (`AGENTS.md`/`doc/operations/completed-backlog-log.md`/본 문서 상태 동기화)

### Phase 1. 분류/소유권 확정

1. 앱 분류표 확정 (`system`, `standard`, `package`) 및 소유권 선언
2. `BUILTIN_SYSTEM_APP_IDS`를 기준으로 “권한형 시스템 앱” 고정
3. 코어 외 빌트인 앱은 우선 `standard`로 고정 후 addon 이관 대상 지정

산출물:

- `doc/reference/app-ownership-matrix.md` (신규)
- 앱별 owner, model, launch mode, 데이터 경계 표

### Phase 2. 폴더 물리 분리

1. `client/src/apps/system/`와 `client/src/apps/addons/`로 디렉토리 분리
2. import 경로 및 app registry metadata 동기화
3. 코어 shell(`Desktop.svelte`, `Window.svelte`)은 분기 증가 없이 registry 해석만 유지

산출물:

- 시스템 앱 이동 커밋
- addon 앱 이동 커밋
- 회귀 없는 빌드/런치 검증

### Phase 3. 레거시 레지스트리 제거

1. `packageRegistryService.readBuiltinRegistry()`에서 legacy fallback 제거
2. 앱 레지스트리 단일 source를 `inventory/system/apps.json`로 고정
3. 마이그레이션 스크립트 1회 제공 (legacy -> inventory/system)

산출물:

- `tools/migrate-apps-registry.js` (신규)
- 운영 가이드 업데이트 (`doc/operations/local-run-guide.md`)

### Phase 4. Addon 런타임 표준화

1. `standard` 앱 신규 등록 시 manifest-like 필드 강제
2. 가능하면 sandbox/package 모델로 순차 전환
3. addon은 Host 직접 접근 금지, WebOS API/permission 경유 원칙 적용

산출물:

- validator 강화 (`tools/package-doctor.js` 확장)
- addon 개발 가이드 섹션 추가 (`doc/reference/app-development-model.md`)

### Phase 5. 운영 정합성 정리

1. `AGENTS.md`의 backlog done 상태와 실제 체크리스트를 연결
2. “구현 완료”와 “아키텍처 완료”를 분리 기록
3. 미완 룰은 `doc/operations/completed-backlog-log.md`에 후속 항목으로 명시

현재 판단:

- Phase 5는 문서 동기화 자체는 완료.
- 그러나 File Station Open With, file grant, addon overwrite 승인, package addon 파일 API parity가 모두 완료되기 전까지는 “아키텍처 정합 완료”로 간주하지 않음.

## 파일 경계 원칙

- `client/src/core/*`: 오케스트레이션만, 앱 로직 금지
- `client/src/apps/system/*`: Host/운영 권한형 UI
- `client/src/apps/addons/*`: 일반 앱 UI
- `server/routes/*`: 계약/검증/응답 매핑
- `server/services/*`: 상태 전이/비즈니스 로직
- `server/storage/inventory/apps/*`: 패키지형 addon 자산
- `server/storage/inventory/data/<appId>`: addon 앱 데이터

## 검증 기준 (DoD)

아래를 모두 만족하면 “분리 완료”로 판단합니다.

1. 코어 외 앱이 `client/src/apps/addons/*` 또는 `inventory/apps/*`에만 존재
2. `Desktop.svelte`가 앱별 조건문 없이 `launch` 해석만 수행
3. legacy 앱 레지스트리 fallback 제거
4. 앱 실행/권한/데이터 경계가 문서와 코드에서 동일
5. `npm run build` 통과 + 주요 런치 회귀 테스트 통과

## 리스크 및 대응

- 경로 이동으로 인한 import 붕괴
  - 대응: 이동 단위 커밋, 빌드/런치 스모크 테스트 동시 수행
- 레지스트리 단일화 시 기존 사용자 데이터 불일치
  - 대응: 1회 마이그레이션 + 백업 파일 생성
- 시스템 앱 오분류로 인한 권한 경계 약화
  - 대응: system app allowlist 유지 + 리뷰 체크리스트 강제

## 권장 실행 순서 (실무)

1. 분류표 문서화
2. 폴더 분리 PR
3. 레거시 fallback 제거 PR
4. validator/문서 보강 PR
5. AGENTS/운영 로그 정합성 PR

작은 PR 단위로 나누고, 각 PR마다 “경계 유지 여부”를 리뷰 필수 항목으로 둡니다.
