# Core Integration Map

Status: `[ACTIVE]`

이 문서는 addon/package가 My Web OS host와 만나는 지점을 정리한다. 프로젝트 소스 없이도 어떤 entry, API, SDK, launch data를 기대해야 하는지 알 수 있게 하는 지도다.

## 1. Package discovery

설치된 inventory package는 package root의 `manifest.json`으로 식별된다.

```text
<package-root>/manifest.json
```

repo 안 direct inventory 개발 경로:

```text
server/storage/inventory/apps/<app-id>/manifest.json
```

Package Center ZIP/registry 설치 후에도 논리적으로는 같은 package root 구조가 된다.

## 2. Launcher rules

Launcher에 표시되는 조건:

- `type: "app"`이고 `runtime.type: "sandbox-html"`, `runtime.entry`가 존재
- `type: "hybrid"`이고 `ui.entry`가 존재

Launcher에서 숨겨지는 조건:

- `type: "service"`
- entry 파일 없음
- manifest invalid

Hybrid launch metadata는 UI entry를 가리켜야 한다.

```text
runtime.entry -> service/index.js
ui.entry      -> ui/index.html
launcher      -> /api/sandbox/<app-id>/ui/index.html
```

## 3. Sandbox asset serving

Sandbox app asset은 sandbox route를 통해 제공된다.

```text
/api/sandbox/<app-id>/<entry>
/api/sandbox/sdk.js
```

Package asset은 entry HTML 기준 상대 경로로 로드한다.

```html
<link rel="stylesheet" href="./assets/app.css">
<script src="./assets/app.js"></script>
```

`manifest.json`을 정적 asset처럼 읽는 것에 의존하지 말 것.

## 4. Sandbox context

모든 sandbox UI는 SDK ready를 기다린다.

```js
const context = await window.WebOS.ready();
```

중요 필드:

```js
context.app.id
context.app.title
context.app.permissions
context.app.launchData
context.capabilities
context.apiPolicy
```

## 5. File Station launch data

파일 연결로 열린 앱은 `context.app.launchData`에서 파일 정보를 받는다. 정확한 shape는 release마다 확장될 수 있으므로 defensive하게 읽는다.

권장 처리:

```js
const context = await window.WebOS.ready();
const launchData = context.app.launchData || {};
const file = launchData.file || launchData.files?.[0] || null;

if (file?.path && file?.grantId) {
  const content = await window.WebOS.files.read({
    path: file.path,
    grantId: file.grantId
  });
}
```

파일 하나만 전제하지 말고 다중 파일 launch 가능성을 열어둔다.

## 6. App-owned data

App data는 package-owned storage다. Host user file과 다르다.

SDK:

```js
await WebOS.app.data.write({ path: 'settings.json', content: '{}' });
await WebOS.app.data.read({ path: 'settings.json' });
await WebOS.app.data.list({ path: '' });
```

Managed service env:

```text
WEBOS_APP_DATA_DIR
```

서비스는 cache/db/job metadata를 여기에 저장한다.

## 7. Service bridge path

Hybrid UI는 SDK로 자기 서비스에 요청한다.

```js
await WebOS.service.request({ method: 'GET', path: '/health' });
```

실제 backend proxy:

```text
POST /api/sandbox/:appId/service/request
  -> 127.0.0.1:<WEBOS_SERVICE_PORT><path>
```

Addon 개발자는 backend route를 직접 호출하지 말고 SDK를 사용한다.

## 8. Runtime Manager contract

Managed process runtime은 Package Center/Runtime Manager가 관리한다.

기본 작업:

- start
- stop
- restart
- logs
- events
- health
- recover

Service env:

```text
WEBOS_APP_ID
WEBOS_PACKAGE_DIR
WEBOS_APP_DATA_DIR
WEBOS_ALLOWED_ROOTS_JSON
WEBOS_SERVICE_PORT
WEBOS_RUNTIME_MODE=managed-process
```

HTTP service는 `127.0.0.1:${WEBOS_SERVICE_PORT}`에 listen한다.

## 9. Runtime config defaults

플랫폼 기본값:

```json
{
  "runtime": {
    "servicePortStart": 38000,
    "servicePortEnd": 38999,
    "serviceProxyTimeoutMs": 15000
  }
}
```

패키지는 이 range를 직접 확장할 수 없다.

## 10. Package Center contract

Package Center가 담당하는 것:

- template scaffold
- ZIP import
- registry install/update
- manifest preflight/update
- lifecycle approval
- backup snapshot
- rollback
- runtime lifecycle controls
- logs/events/health 표시

패키지 개발자가 담당하는 것:

- 정확한 manifest 작성
- 최소 permission 선언
- service API 안정성
- healthcheck 제공
- app data migration
- 오류를 `{ code, message }` 형태로 명확히 반환

## 11. 언제 sandbox addon으로 충분한가

다음이면 `app + sandbox-html`이면 충분하다.

- 단일 파일 viewer/editor
- markdown/csv/json preview
- 작은 설정 UI
- 외부 native process가 필요 없는 도구
- host file은 File Station grant로 받은 것만 읽거나 저장

## 12. 언제 hybrid가 필요한가

다음이면 `hybrid`가 적합하다.

- media library scan/index
- thumbnail generation
- long-running download queue
- ffmpeg wrapper
- local database/cache service
- background worker
- UI가 service 상태를 보고 조작해야 함

## 13. 언제 core/platform 변경인가

Addon 문서만으로 해결할 수 없는 경우:

- 새 SDK capability가 필요함
- 새 Host API가 필요함
- Package Center preflight/approval 계약 변경 필요
- Runtime Manager lifecycle 동작 변경 필요
- OS-level isolation, Docker, per-folder grant 필요
- system app 자체 기능 변경 필요

이 경우는 addon 개발이 아니라 platform development다.
