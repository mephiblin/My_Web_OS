# 서비스 런타임 계층 상세 기획서 (`next.md`)

## 1. 문서 목적

이 문서는 현재 `web_os` 프로젝트에 부족한 **서비스 런타임 계층(Service Runtime Layer)** 을 설계·구현하기 위한 실행 기준서다.  
핵심은 다음 4가지를 명확히 하는 것이다.

1. 어떻게 구현할 것인가 (아키텍처/단계)
2. 무엇을 해야 하는가 (작업 항목/우선순위)
3. 기대되는 결과는 무엇인가 (기능/운영 효과)
4. 작업이 실제로 어느 폴더/파일에서 일어나는가 (파일 맵)

---

## 2. 현재 상태와 갭 분석

### 2.1 이미 구현된 것 (기반)
- 패키지 설치/삭제/가져오기/내보내기/레지스트리 소스 관리
  - `server/routes/packages.js`
- 샌드박스 앱 정적 실행 + 권한 기반 데이터 API
  - `server/routes/sandbox.js`
  - `client/src/core/components/SandboxAppFrame.svelte`
- 내부 백엔드 서비스 생명주기 관리(시작/중지/재시작)
  - `server/services/serviceManager.js`
  - `server/routes/services.js`

### 2.2 아직 없는 것 (핵심 갭)
- 대규모 앱(예: 장시간 백그라운드 서비스, 별도 프로세스 필요 앱)을 위한 **실행 엔진**
- 앱 단위 프로세스 관리(시작/중지/재시작/상태/헬스체크/자동복구)
- 서비스 로그/메트릭 수집 및 운영 UI
- 런타임 타입별 실행 프로필(예: `sandbox-html`, `process-node`, `process-python`, `binary`)
- 설치 후 실행준비(install hook, dependency check) 표준화

정리하면: 현재는 **패키지 관리 + 샌드박스 UI 런타임**은 있지만,  
요구한 **서비스 런타임 계층**은 아직 본격적으로 구현되지 않았다.

---

## 3. 목표와 비목표

### 3.1 목표
- Docker 의존 없이도 앱 단위 서비스 실행을 관리하는 런타임 계층 제공
- 패키지 매니저에서 서비스형 앱까지 설치→실행→중지→제거 라이프사이클 통합
- 보안/권한/자원 제한이 있는 운영 가능한 로컬 앱 생태계 기반 구축

### 3.2 비목표 (초기 단계에서 제외)
- Kubernetes 수준 오케스트레이션
- 멀티노드 분산 스케줄링
- 루트 권한이 필요한 전역 시스템 수정 자동화
- 완전한 컨테이너 격리 보장 (초기에는 프로세스 격리 + 정책 게이트 중심)

---

## 4. 기대되는 결과

### 4.1 사용자 관점
- 패키지 센터에서 서비스형 앱을 설치 후 즉시 실행/중지/재시작 가능
- 앱이 창(UI)만 있는 형태인지, 백그라운드 서비스가 있는 형태인지 명확히 구분됨
- 설치된 앱의 상태(실행중/중지/오류), 로그, 헬스 상태를 한 화면에서 확인 가능

### 4.2 운영 관점
- 장애 시 자동 재시작 정책으로 가용성 향상
- 앱별 실행 이력/오류 로그 추적 가능
- 설치/실행/삭제 흐름이 표준화되어 유지보수 비용 절감

### 4.3 개발 관점
- manifest에 런타임 정보를 선언하면 엔진이 동일 규칙으로 실행
- 신규 런타임 타입 추가가 모듈 단위로 가능
- 앱 제작자에게 요구되는 규약이 명확해짐

---

## 5. 목표 아키텍처

## 5.1 계층 구조
1. **Package Layer**
- 패키지 메타데이터/파일 관리
- 설치, 제거, import/export

2. **Runtime Definition Layer**
- manifest 기반 실행 규칙 해석
- 실행 프로필/권한/자원 제한 정책 계산

3. **Service Runtime Layer (신규 핵심)**
- 앱 인스턴스 생성/시작/중지/재시작
- 헬스체크/오토리커버리/로그 수집
- 런타임 상태 저장 및 API 제공

4. **UI Control Layer**
- Package Center의 설치됨 탭에서 서비스 제어
- 런타임 상태/로그 표시

## 5.2 런타임 타입 (초기 권장)
- `sandbox-html`: 기존 iframe 샌드박스
- `process-node`: `node <entry>` 실행
- `process-python`: `python <entry>` 실행
- `binary`: 로컬 바이너리 실행(allowlist 기반)

---

## 6. 구현 전략 (How)

## Phase 0. 설계 고정
### 해야 할 일
- manifest 런타임 스펙 확정
- 실행 상태 모델 정의(`stopped`, `starting`, `running`, `degraded`, `error`)
- 런타임 API 스펙 확정

### 기대 결과
- 구현 중 스펙 변경 비용 최소화
- 프론트/백엔드 동시 개발 가능

---

## Phase 1. 서비스 런타임 코어
### 해야 할 일
- `RuntimeManager`(앱 인스턴스 관리) 구현
- `ProcessSupervisor`(spawn/stop/restart, exit 감시) 구현
- 인스턴스 상태 영속화(JSON) 구현

### 기대 결과
- 백엔드 단독으로 서비스형 앱 라이프사이클 관리 가능

---

## Phase 2. manifest 확장 + 패키지 연동
### 해야 할 일
- manifest에 `runtime`, `service`, `healthcheck`, `resources` 필드 수용
- 패키지 설치 시 런타임 검증(필수 필드, 엔트리 존재, 실행 가능성)
- `/api/packages`와 런타임 상태 연결

### 기대 결과
- 설치 단계에서 실패를 사전 차단
- 패키지/런타임 데이터 일관성 확보

---

## Phase 3. 런타임 API
### 해야 할 일
- `GET /api/runtime/apps`
- `GET /api/runtime/apps/:id`
- `POST /api/runtime/apps/:id/start`
- `POST /api/runtime/apps/:id/stop`
- `POST /api/runtime/apps/:id/restart`
- `GET /api/runtime/apps/:id/logs`

### 기대 결과
- UI와 CLI에서 동일 제어 인터페이스 사용 가능

---

## Phase 4. Package Center UI 통합
### 해야 할 일
- 설치됨 목록에 런타임 상태 배지 표시
- 액션 분기:
  - UI 앱: `열기`
  - 서비스 앱: `시작/중지/재시작/로그`
  - 하이브리드 앱: `열기 + 서비스 제어`
- 오류 원인 표시(권한/의존성/실행 실패)

### 기대 결과
- 사용자 관점에서 “앱”과 “서비스”가 한 화면에서 관리됨

---

## Phase 5. 보안/운영 강화
### 해야 할 일
- 실행 커맨드 allowlist
- 환경변수 주입 정책(민감정보 마스킹)
- 네트워크/파일 접근 범위 정책
- 로그 보관/회전, 자동 재시작 정책, 크래시 루프 차단

### 기대 결과
- 프로덕션에 가까운 안정성/안전성 확보

---

## 7. 해야 하는 작업 상세 (체크리스트)

## 7.1 백엔드 코어
- [ ] 런타임 상태 모델 정의
- [ ] 프로세스 supervisor 모듈 구현
- [ ] 런타임 manager 구현
- [ ] 시작/중지/재시작 정책 구현
- [ ] 헬스체크 훅 구현
- [ ] 로그 버퍼/파일 저장 구현

## 7.2 패키지/manifest
- [ ] manifest 스키마 확장
- [ ] 설치 시 스키마 검증
- [ ] 런타임 프로필 유효성 검사
- [ ] 앱 유형(app/service/hybrid) 분기 로직 추가

## 7.3 API
- [ ] 런타임 라우터 신규 작성
- [ ] 기존 `/api/packages` 응답에 런타임 상태 연결
- [ ] 권한 체크(관리자 인증 + 앱 권한) 적용

## 7.4 프론트
- [ ] Package Center 설치됨 탭 UX 확장
- [ ] 상태 배지/오류 패널/로그 뷰 추가
- [ ] 장시간 작업(시작/중지) 로딩/타임아웃 UX 구현

## 7.5 운영/품질
- [ ] 테스트 시나리오(정상/오류/재시작 루프) 작성
- [ ] 장애 복구 시나리오 작성
- [ ] README/운영 문서 업데이트

---

## 8. 작업 폴더/파일 맵 (Where)

아래는 실제로 수정/추가될 가능성이 높은 파일들이다.

## 8.1 서버: 신규 파일(예정)
- `server/services/runtimeManager.js`
- `server/services/processSupervisor.js`
- `server/services/runtimeStateStore.js`
- `server/services/runtimeProfiles.js`
- `server/routes/runtime.js`
- `server/utils/runtimePaths.js` (선택)

## 8.2 서버: 기존 파일 수정
- `server/index.js`
  - 런타임 매니저 등록/초기화/종료 훅 연결
- `server/routes/packages.js`
  - manifest 런타임 필드 파싱/검증
  - 설치 결과와 런타임 상태 연결
- `server/services/packageRegistryService.js`
  - 앱 메타에 runtime/service 정보 병합
- `server/config/defaults.json`
  - 런타임 기본값(재시작 정책, 로그 제한 등) 추가
- `server/config/serverConfig.js`
  - 런타임 관련 설정 로딩
- `server/utils/inventoryPaths.js`
  - 런타임 상태/로그 저장 경로 정의

## 8.3 저장소/인벤토리 구조
- `server/storage/inventory/system/runtime-instances.json` (예정)
- `server/storage/inventory/system/runtime-policies.json` (선택)
- `server/storage/inventory/system/runtime-logs/` (예정)

## 8.4 클라이언트: 기존 파일 수정
- `client/src/apps/package-center/PackageCenter.svelte`
  - 설치됨 탭 서비스 제어 UI
  - 상태/로그 표시
- `client/src/utils/api.js`
  - 런타임 API 호출 유틸 정리
- `client/src/core/components/SandboxAppFrame.svelte`
  - 하이브리드 앱 실행/브리지 연계 보완 (필요 시)

## 8.5 클라이언트: 신규 파일(선택)
- `client/src/apps/runtime-console/RuntimeConsole.svelte`
  - 앱별 로그/상태 상세 뷰
- `client/src/apps/package-center/runtimeApi.js`
  - 런타임 API 전용 호출 모듈

---

## 9. manifest 확장안 (초안)

```json
{
  "id": "immich-like",
  "title": "Immich Like Service",
  "type": "hybrid",
  "runtime": "process-node",
  "entry": {
    "app": "ui/index.html",
    "service": "service/server.js"
  },
  "service": {
    "autostart": false,
    "restart": {
      "policy": "on-failure",
      "maxRetries": 5,
      "backoffMs": 2000
    },
    "healthcheck": {
      "type": "http",
      "url": "http://127.0.0.1:18181/health",
      "intervalMs": 10000,
      "timeoutMs": 3000
    }
  },
  "permissions": ["app.data.read", "app.data.write", "system.info"]
}
```

---

## 10. API 설계안 (초안)

## 10.1 조회
- `GET /api/runtime/apps`
  - 전체 앱 런타임 상태 목록
- `GET /api/runtime/apps/:id`
  - 단일 앱 상세 상태, 최근 에러, 리소스 요약

## 10.2 제어
- `POST /api/runtime/apps/:id/start`
- `POST /api/runtime/apps/:id/stop`
- `POST /api/runtime/apps/:id/restart`

## 10.3 로그/진단
- `GET /api/runtime/apps/:id/logs?cursor=...`
- `GET /api/runtime/apps/:id/events`

---

## 11. 보안/안정성 기준

### 11.1 보안
- 실행 커맨드 화이트리스트(런타임 타입별)
- 앱 루트 밖 경로 실행 금지
- 민감 환경변수 기본 차단
- 외부 레지스트리 소스 검증 강화(allowlist + 해시)

### 11.2 안정성
- 크래시 루프 방지(`maxRetries`, cooldown)
- 종료 시 graceful stop + timeout kill
- 로그 파일 최대 크기/개수 제한
- 서버 재시작 시 상태 복구

---

## 12. 완료 기준 (Definition of Done)

다음 조건을 충족하면 “서비스 런타임 계층 1차 완료”로 본다.

1. 패키지 설치 후 서비스형 앱을 `start/stop/restart` 가능
2. 설치됨 탭에서 실행 상태가 실시간(또는 polling) 반영
3. 앱별 최근 로그 확인 가능
4. 앱 crash 시 정책 기반 자동 재시작 동작
5. 서버 재기동 후 런타임 상태 복구
6. 권한/경로 위반 시 명확한 에러 코드 반환

---

## 13. 단계별 산출물

## Milestone A (코어)
- RuntimeManager/ProcessSupervisor
- runtime 상태 저장소
- 기본 API start/stop/restart

## Milestone B (통합)
- 패키지 manifest 런타임 확장
- Package Center 설치됨 제어 UI
- 로그 조회 API + 최소 UI

## Milestone C (강화)
- 헬스체크/오토리커버리
- 보안 정책(allowlist/자원 제한)
- 운영 문서/에러 코드 표준화

---

## 14. 최종 결론

이번 작업의 본질은 “패키지 관리”를 “실행 가능한 서비스 플랫폼”으로 끌어올리는 것이다.  
즉, 현재의 `Package Center + Sandbox` 기반 위에 **Service Runtime Layer** 를 추가하여:

- 대규모 앱도 Docker 없이 운영 가능하게 만들고
- 사용자에게는 앱스토어형 UX를 유지하면서
- 백엔드에는 운영 가능한 프로세스 관리 표준을 제공하는 것이 목표다.

이 문서를 기준으로 구현을 시작하면,  
1차는 안정적인 서비스 실행/제어, 2차는 보안·운영 고도화까지 연결된다.

---

## 15. 문서 단독 착수 가능성 분석

### 15.1 결론
**조건부로 바로 착수 가능하다.**  
정확히는 `Milestone A(코어)`는 문서만으로 구현 시작이 가능하고,  
`Milestone B~C`는 일부 정책값 고정이 필요하다.

### 15.2 바로 가능한 범위 (문서만으로 구현 가능)
- `RuntimeManager`, `ProcessSupervisor`, `runtimeStateStore` 파일 생성
- 런타임 기본 API (`start/stop/restart/status/logs`) 골격 구현
- 서버 부트스트랩(`server/index.js`)에 런타임 매니저 연결
- `Package Center` 설치됨 탭에 런타임 상태 배지 기본 표기

### 15.3 착수 전 고정이 필요한 항목 (미결정값)
- `manifest.runtime` 허용값 최종 목록
- `type=app/service/hybrid`의 동작 규칙
- `service.autostart` 기본값(`false` 권장)
- 재시작 정책 기본값(`on-failure`, `maxRetries`, `backoffMs`)
- 로그 보존 정책(파일당 최대 크기, 보존 파일 수)
- 헬스체크 기본 주기 및 timeout

### 15.4 권장 기본값 (새 세션에서 즉시 사용 가능)
- `runtime`: `sandbox-html | process-node | process-python | binary`
- `autostart`: `false`
- `restart.policy`: `on-failure`
- `restart.maxRetries`: `5`
- `restart.backoffMs`: `2000`
- `healthcheck.intervalMs`: `10000`
- `healthcheck.timeoutMs`: `3000`
- 로그 파일 제한: `10MB x 5개`

---

## 16. 새 세션 인수인계 문맥 (Context Pack)

### 16.1 프로젝트 목적 요약
- 목표: Docker 없이 패키지형 앱의 설치/실행/중지/제거를 통합 관리
- 현재 강점: 패키지 센터 + 레지스트리 설치 + 샌드박스 런타임 기반은 존재
- 현재 부족: 서비스형 앱의 백그라운드 실행 런타임 계층

### 16.2 현재 구현 상태 핵심
- 패키지/레지스트리 API: `server/routes/packages.js`
- 샌드박스 데이터 권한 API: `server/routes/sandbox.js`
- 내부 서비스 생명주기 관리: `server/services/serviceManager.js`, `server/routes/services.js`
- 패키지 센터 UI: `client/src/apps/package-center/PackageCenter.svelte`

### 16.3 기술적 제약/주의사항
- 파일 기반 영속화 구조 (`server/storage/inventory/system/*.json`)
- 인증은 JWT 기반 관리자 중심
- 보안 하드닝(allowlist/검증)은 아직 진행 중
- 현재 워크트리는 dirty 상태일 수 있으므로 기존 변경을 덮어쓰지 말 것

### 16.4 작업 기준 경로
- 루트: `/home/inri/문서/web_os`
- 서버 핵심: `/home/inri/문서/web_os/server`
- 클라이언트 핵심: `/home/inri/문서/web_os/client`
- 문서 기준: `/home/inri/문서/web_os/next.md`

---

## 17. 새 세션 시작 절차 (실행 순서)

### 17.1 1단계: 컨텍스트 로드
1. `next.md` 전체 확인
2. `server/index.js`, `server/routes/packages.js`, `server/services/packageRegistryService.js` 확인
3. `client/src/apps/package-center/PackageCenter.svelte` 확인

### 17.2 2단계: 미결정값 잠금
아래 6개 값 먼저 고정 후 구현 시작:
- 런타임 타입 목록
- autostart 기본값
- 재시작 기본 정책
- 로그 보존 제한
- 헬스체크 기본값
- 앱 타입별 UI 액션 분기

### 17.3 3단계: Milestone A 즉시 구현
1. `server/services/runtimeManager.js` 추가
2. `server/services/processSupervisor.js` 추가
3. `server/services/runtimeStateStore.js` 추가
4. `server/routes/runtime.js` 추가
5. `server/index.js`에 라우터/매니저 연결
6. 최소 동작 검증 후 API 문서 업데이트

### 17.4 4단계: 최소 검증 명령
- 서버 실행: `node server/index.js`
- 클라이언트 실행: `cd client && npm run dev`
- 빌드 검증: `cd client && npm run build`
- API 스모크:
  - `GET /api/runtime/apps`
  - `POST /api/runtime/apps/:id/start`
  - `POST /api/runtime/apps/:id/stop`

---

## 18. 새 세션 시작용 프롬프트 템플릿

아래 문장을 새 세션 첫 메시지로 그대로 사용하면 문맥 손실을 줄일 수 있다.

```text
프로젝트 경로는 /home/inri/문서/web_os 이고, 기준 문서는 next.md 입니다.
목표는 서비스 런타임 계층 Milestone A 구현입니다.
먼저 next.md의 15~17장을 기준으로 미결정값 6개를 잠그고,
server/services/runtimeManager.js, processSupervisor.js, runtimeStateStore.js,
server/routes/runtime.js, server/index.js 연결까지 한 번에 구현하세요.
기존 변경사항을 되돌리지 말고, 구현 후 client build와 runtime API 스모크 결과를 보고하세요.
```

---

## 19. 시작 전 리스크 체크

- 기존 워크트리에 이미 수정된 파일이 다수 존재할 수 있음
- `server/storage/index.json` 같은 자동 생성 파일이 diff에 포함될 수 있음
- 새 런타임 도입 시 기존 `serviceManager`와 역할 충돌이 생길 수 있으므로
  - `serviceManager`: 서버 내부 서비스
  - `runtimeManager`: 앱 인스턴스 런타임
  로 역할을 분리해 유지해야 함

---

## 20. 최종 실행 판단

현재 `next.md`는 **새 세션에서 바로 구현 시작 가능한 수준**이다.  
단, 17.2의 미결정값을 첫 15~30분 내 확정해야 일정 지연이 없다.

---

## 12. 진행 현황 업데이트 (2026-04-21)

### 완료
- [x] 런타임 이벤트 조회 API(`GET /api/runtime/apps/:id/events`) 및 버퍼 보존
- [x] 런타임 로그 파일 보존/회전 정책 반영
- [x] 헬스체크 임계치 기반 상태 전이(`running/degraded/recovered`) 구현
- [x] 런타임 검증/복구 API 추가(`validate`, `recover`)
- [x] 패키지 lifecycle 저장소 구축(채널/히스토리/백업/롤백)
- [x] overwrite 설치(import/registry) 시 사전 백업 + 실패 자동 복구
- [x] 패키지 건강도 리포트 API(`GET /api/packages/:id/health`) 추가

### 진행중
- [ ] Package Center UI에 lifecycle/health/rollback 패널 연결

### 잔여
- [ ] SemVer range 수준 의존성 판정기
- [ ] 채널별 자동 업데이트 정책(승격/지연 배포)
- [ ] 복구 시나리오 E2E 테스트 스위트
