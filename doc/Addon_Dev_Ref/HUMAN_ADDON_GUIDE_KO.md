# 사람을 위한 애드온/툴 패키지 개발 가이드

Status: `[ACTIVE]`

이 문서는 “어떤 형태로 만들어야 하는가”를 판단하는 가이드다. 구현 세부는 quickstart와 SDK/manifest 문서를 따른다.

## 1. 먼저 분류한다

만들려는 것이 무엇인지 먼저 정한다.

| 만들 것 | 권장 package type |
| --- | --- |
| 간단한 화면/도구 | `app` |
| 파일 뷰어/에디터 | `app` + fileAssociations |
| 데스크톱 위젯 | `widget` |
| UI 없는 백그라운드 작업 | `service` |
| Plex/Immich/downloader류 | `hybrid` |
| 패키지 개발 도구 | `developer` |

## 2. 작은 UI 애드온의 기본 구조

```text
my-addon/
  manifest.json
  index.html
  assets/
```

Manifest:

```json
{
  "id": "my-addon",
  "title": "My Addon",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": []
}
```

이 모델은 가장 안전하고 배포하기 쉽다.

## 3. 깊게 관여하는 툴의 기본 구조

```text
media-tool/
  manifest.json
  ui/index.html
  service/index.js
```

Manifest 핵심:

```json
{
  "type": "hybrid",
  "runtime": {
    "type": "process-node",
    "entry": "service/index.js"
  },
  "ui": {
    "type": "sandbox-html",
    "entry": "ui/index.html"
  },
  "permissions": ["runtime.process", "service.bridge"]
}
```

이 모델은 기능적으로 Plex/Immich/downloader류 개발을 가능하게 하지만, V1에서는 신뢰한 로컬 패키지용이다.

## 4. 권한 기준

권한은 “사용 가능 기능”이면서 동시에 “설치 전 사용자에게 보여줄 위험 선언”이다.

- UI 알림만 필요하면 `ui.notification`
- app 내부 설정 저장이면 `app.data.*`
- File Station에서 받은 파일 읽기면 `host.file.read`
- File Station에서 받은 파일 저장이면 `host.file.write`
- 로컬 프로세스가 필요하면 `runtime.process`
- UI가 service를 호출하면 `service.bridge`
- 외부 다운로드/API면 `network.outbound`
- media/download/library root를 다루면 `host.allowedRoots.read/write`

## 5. Host 파일을 다루는 법

작은 viewer/editor는 직접 폴더를 훑지 않는다. File Station이 파일 grant를 넘겨주고, addon은 SDK로 읽고 쓴다.

```js
const file = context.app.launchData.file;
const content = await WebOS.files.read({ path: file.path, grantId: file.grantId });
```

라이브러리 스캔처럼 폴더 전체를 다뤄야 하면 hybrid service로 만든다.

## 6. Service API 설계

Hybrid service는 HTTP API를 작게 시작한다.

권장 최소 endpoint:

```text
GET /health
GET /library/status
POST /jobs
GET /jobs
POST /jobs/:id/cancel
```

응답은 JSON을 권장한다.

```json
{
  "ok": true,
  "status": "idle"
}
```

오류도 JSON으로 명확히 반환한다.

```json
{
  "error": true,
  "code": "SCAN_ROOT_NOT_ALLOWED",
  "message": "The selected root is not configured in allowedRoots."
}
```

## 7. App data와 allowedRoots를 나눈다

`WEBOS_APP_DATA_DIR`:

- 설정
- DB/cache
- thumbnail index
- job state

`WEBOS_ALLOWED_ROOTS_JSON`:

- 사용자가 platform 설정에서 허용한 host roots
- media library root 후보
- download target 후보

원본 media/download 파일을 app data에 무작정 복사하지 않는다.

## 8. Package Center 친화적으로 만든다

좋은 package는 Package Center에서 스스로 설명된다.

Manifest에 넣을 것:

- `description`
- 정확한 `permissions`
- `service` lifecycle
- `healthcheck`
- `repository`/`author` 가능하면 포함
- file association이 있으면 명확히 선언

README에 넣을 것:

- 어떤 권한이 왜 필요한지
- 어떤 폴더를 읽거나 쓰는지
- service start 후 어떤 endpoint가 있는지
- backup/rollback 시 주의할 app data migration

## 9. 개발 종료 기준

작은 addon:

- ZIP import 가능
- launcher open 가능
- SDK ready 가능
- 필요한 SDK API 동작
- Package Center preflight에 권한 표시

Hybrid tool:

- ZIP import 가능
- Tool Package review 표시
- service start/stop/restart 가능
- logs/events 확인 가능
- `/health` healthy
- UI에서 `WebOS.service.request()` 성공
- service가 env를 읽음
- stop 상태를 UI가 recoverable error로 표시
- update 전 backup, rollback 후 재시작 확인

## 10. 선택 기준 한 줄 요약

- 화면만 있으면 `app + sandbox-html`
- 파일 하나를 열면 `app + file grant`
- 폴더/라이브러리/백그라운드 작업이면 `hybrid`
- 신뢰하지 않는 외부 native code를 안전하게 실행해야 하면 V1 범위를 넘는다.
