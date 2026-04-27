# Packaging, Installation, And Testing

Status: `[ACTIVE]`

이 문서는 개발자가 패키지를 만들고 검증하는 실전 체크리스트다.

## 1. 독립 패키지 루트

일반 sandbox app:

```text
hello-addon/
  manifest.json
  index.html
  assets/
  vendor/
```

Hybrid tool package:

```text
media-tool/
  manifest.json
  ui/index.html
  service/index.js
  assets/
```

## 2. ZIP 만들기

패키지 루트 안의 파일들이 ZIP 루트에 들어가게 만든다.

```text
manifest.json
ui/index.html
service/index.js
```

나쁜 예:

```text
media-tool.zip
  dist/
    media-tool/
      manifest.json
```

Package Center가 단일 package root를 찾을 수 없으면 import가 실패할 수 있다.

## 3. 직접 inventory 테스트

repo 안에서 개발 중이면 빠르게 아래 경로에 둘 수 있다.

```text
server/storage/inventory/apps/<app-id>/
```

주의:

- 이 방식은 Package Center install/update approval을 우회한다.
- backup/rollback 테스트는 ZIP import나 registry install로 해야 한다.
- browser app registry cache 때문에 새 앱 추가 후 reload가 필요할 수 있다.

## 4. Doctor

단일 manifest 검사:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
```

전체 built-in registry 검사:

```bash
npm run verify:packages
```

Doctor가 확인하는 대표 항목:

- app type/runtime type 유효성
- unsupported runtime fallback 차단
- hybrid/service managed runtime 요구
- `runtime.process`, `service.bridge` 누락
- permission catalog drift
- file association shape

## 5. Syntax/build checks

서버 route/service를 수정했다면:

```bash
node --check server/routes/packages.js
node --check server/routes/sandbox.js
node --check server/services/runtimeManager.js
node --check server/services/runtimeProfiles.js
```

클라이언트 UI를 수정했다면:

```bash
npm --prefix client run build
```

## 6. Sandbox app smoke

- Package Center 또는 direct inventory로 설치
- launcher에 앱 표시 확인
- 앱 열기
- `WebOS.ready()` 성공
- 필요한 SDK API 호출 성공
- permission denied가 있으면 manifest 수정
- ZIP import로도 동일하게 동작 확인

## 7. Hybrid tool smoke

- Package Center template 또는 ZIP import로 설치
- preflight에서 Tool Package review 확인
- service start
- logs/events 확인
- `/health` healthcheck healthy 확인
- UI open
- `WebOS.service.request({ path: '/library/status' })` 성공
- service stop
- UI에서 recoverable service unavailable 표시
- service restart
- rollback backup 생성/복원 확인

## 8. Manual test matrix

| 항목 | Sandbox app | Hybrid tool |
| --- | --- | --- |
| manifest doctor | 필요 | 필요 |
| Package Center preflight | 권장 | 필수 |
| launcher open | 필요 | UI가 있으면 필요 |
| SDK ready | 필요 | 필요 |
| app data read/write | 권한 사용 시 | 권한 사용 시 |
| service start/stop | 해당 없음 | 필수 |
| service bridge | 해당 없음 | 필수 |
| healthcheck | 해당 없음 | 필수 권장 |
| backup/rollback | update 테스트 시 | update 테스트 시 필수 |

## 9. 흔한 오류

| Code/Symptom | 원인 | 해결 |
| --- | --- | --- |
| `APP_PERMISSION_DENIED` | manifest permission 누락 | permission 추가 |
| `RUNTIME_PROFILE_INVALID` | runtime/type/entry 계약 위반 | manifest runtime 확인 |
| `RUNTIME_COMMAND_NOT_ALLOWED` | binary/command allowlist 밖 | runtime config 또는 command 변경 |
| `RUNTIME_ENTRY_NOT_FOUND` | service entry 파일 없음 | ZIP 구조/entry 경로 수정 |
| `RUNTIME_SERVICE_UNAVAILABLE` | service stopped/degraded | Package Center에서 start/restart |
| `SANDBOX_SERVICE_PATH_INVALID` | service bridge path 부적합 | `/health` 같은 상대 path 사용 |
| launcher 미표시 | `service` type이거나 UI entry 누락 | `app`/`hybrid`와 entry 확인 |

## 10. 배포 전 최종 체크리스트

- ZIP에 `manifest.json`이 있다.
- entry 파일이 실제로 존재한다.
- 불필요한 source/build cache가 없다.
- secrets가 없다.
- manifest permissions가 최소 권한이다.
- Package Center preflight가 위험을 정확히 보여준다.
- update/rollback이 깨지지 않는다.
- docs/README에 사용법과 위험 권한 설명이 있다.
