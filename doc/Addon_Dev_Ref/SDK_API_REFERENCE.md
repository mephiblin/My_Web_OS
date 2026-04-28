# SDK API Reference

Status: `[ACTIVE]`

Sandbox UI 애드온은 `/api/sandbox/sdk.js`를 로드하고 `window.WebOS`를 사용한다.

```html
<script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
```

직접 임의의 `/api/*` route를 호출하지 말고 SDK를 사용한다. SDK는 parent frame을 통해 권한 확인과 backend proxy를 수행한다.

## 1. Lifecycle

### `WebOS.ready(timeoutMs?)`

Parent frame에서 sandbox context를 받을 때까지 기다린다.

```js
const context = await window.WebOS.ready();
```

기본 timeout은 7000ms다.

오류:

- `WEBOS_SDK_READY_TIMEOUT`

### `WebOS.getContext()`

`ready()` 이후 현재 context를 반환한다.

```js
const context = window.WebOS.getContext();
```

대표 shape:

```js
{
  app: {
    id: 'my-addon',
    title: 'My Addon',
    permissions: ['app.data.read'],
    runtime: 'sandbox',
    runtimeType: 'sandbox-html',
    launchData: {},
    sdkUrl: '/api/sandbox/sdk.js'
  },
  capabilities: [],
  apiPolicy: {}
}
```

주의: launch data는 `context.app.launchData`다.

### `WebOS.getCapabilities()`

현재 platform capability metadata 배열을 반환한다.

```js
const capabilities = window.WebOS.getCapabilities();
```

### `WebOS.getApiPolicy()`

현재 SDK/API policy 정보를 반환한다.

```js
const policy = window.WebOS.getApiPolicy();
```

## 2. Notifications

Permission: `ui.notification`

```js
await window.WebOS.ui.notification({
  title: 'Done',
  message: 'Task completed.'
});
```

문자열도 허용된다.

```js
await window.WebOS.ui.notification('Saved.');
```

## 3. Window open

Permission: `window.open`

```js
await window.WebOS.window.open('files', {
  path: 'C:/Users/me/Pictures'
});
```

열 대상 app id와 launch data를 넘긴다.

## 4. System info

Permission: `system.info`

```js
const info = await window.WebOS.system.info();
```

시스템 요약 정보는 환경마다 다를 수 있으므로 UI에서는 optional field로 처리한다.

## 5. App-owned data

App-owned data는 패키지 전용 데이터 영역이다. Host filesystem 임의 경로가 아니다.

Permissions:

- `app.data.list`
- `app.data.read`
- `app.data.write`

### List

```js
const files = await window.WebOS.app.data.list({ path: '' });
```

### Read

```js
const content = await window.WebOS.app.data.read({ path: 'settings.json' });
```

### Write

```js
await window.WebOS.app.data.write({
  path: 'settings.json',
  content: JSON.stringify({ theme: 'dark' }, null, 2)
});
```

Alias도 지원한다.

```js
await window.WebOS.appData.write({ path: 'note.txt', content: 'hello' });
```

## 6. Shared calendar API

Core Calendar 시스템 앱과 동기화되는 공용 일정 API다.
정식 v1 계약(필드/SDK/오류/권한)은 `CALENDAR_STANDARD_V1.md`를 기준으로 한다.
source/provider 확장은 `CALENDAR_STANDARD_V2.md`를 기준으로 한다.

Permissions:

- `calendar.read`
- `calendar.write`

### List events

```js
const result = await window.WebOS.calendar.list({
  from: '2026-04-01T00:00:00.000Z',
  to: '2026-04-30T23:59:59.999Z'
});
```

### Get month events

```js
const result = await window.WebOS.calendar.month({
  year: 2026,
  month: 4
});
```

### Create event

```js
const created = await window.WebOS.calendar.create({
  title: 'Deploy window',
  startAt: '2026-04-28T10:00:00.000Z',
  endAt: '2026-04-28T11:00:00.000Z',
  allDay: false,
  color: '#34d399',
  note: 'Smoke check after deploy'
});
```

### Update/Delete event

```js
await window.WebOS.calendar.update('event-id', {
  title: 'Deploy window (updated)',
  endAt: '2026-04-28T11:30:00.000Z'
});

await window.WebOS.calendar.remove('event-id');
```

## 7. Host file grant API

Host file 접근은 File Station 또는 trusted parent flow가 만든 grant가 필요하다.

Permissions:

- `host.file.read`
- `host.file.write`

### Read

```js
const { path, grantId } = context.app.launchData.file;
const content = await window.WebOS.files.read({ path, grantId });
```

### Raw ticket

이미지/PDF/video 같은 asset URL이 필요하면 raw ticket을 요청한다.

```js
const ticket = await window.WebOS.files.rawTicket({
  path,
  grantId,
  profile: 'preview',
  ttlMs: 60000
});

const url = window.WebOS.files.rawUrl({ url: ticket.url });
image.src = url;
```

금지:

```js
// 금지: path/grantId로 직접 raw URL 조립
const url = `/api/fs/raw?path=${path}&grantId=${grantId}`;
```

### Write

```js
await window.WebOS.files.write({
  path,
  grantId,
  content: 'new content',
  overwrite: true
});
```

Overwrite가 필요하면 parent frame이 승인 UI를 표시하고 backend approval을 처리한다. Addon은 직접 approval을 만들 수 없다.

금지:

```js
await window.WebOS.files.approveWrite();
```

항상 다음 오류를 낸다.

```text
WEBOS_APPROVAL_PARENT_ONLY
```

## 8. Hybrid service bridge

Permission: `service.bridge`

Hybrid UI는 자기 패키지의 managed service를 호출할 수 있다.

```js
const status = await window.WebOS.service.request({
  method: 'GET',
  path: '/library/status'
});
```

POST body 예시:

```js
const result = await window.WebOS.service.request({
  method: 'POST',
  path: '/jobs',
  headers: {
    'content-type': 'application/json'
  },
  body: {
    action: 'scan'
  }
});
```

Bridge 규칙:

- 자기 app id의 service만 호출한다.
- backend는 `127.0.0.1:<WEBOS_SERVICE_PORT>`로만 proxy한다.
- absolute URL은 거부된다.
- `..`, backslash, control character, invalid encoding은 거부된다.
- hop-by-hop/sensitive headers는 거부 또는 제거된다.
- GET/DELETE에는 body를 보내지 않는다.
- service가 stopped/starting이면 명시적 오류를 반환한다.

대표 오류:

| Code | 의미 |
| --- | --- |
| `APP_PERMISSION_DENIED` | `service.bridge` 누락 |
| `RUNTIME_SERVICE_UNAVAILABLE` | service가 실행 중이 아님 |
| `RUNTIME_SERVICE_PORT_MISSING` | service port 미할당 |
| `RUNTIME_SERVICE_PORT_INVALID` | service port가 runtime range 밖 |
| `SANDBOX_SERVICE_PATH_INVALID` | path가 부적절함 |
| `SANDBOX_SERVICE_METHOD_INVALID` | 허용되지 않은 method |
| `SANDBOX_SERVICE_BODY_TOO_LARGE` | body 제한 초과 |
| `SANDBOX_SERVICE_TIMEOUT` | proxy timeout |

## 9. Relaunch data

Singleton app이 이미 열린 상태에서 새 파일로 다시 실행되면 parent가 launch-data message를 보낼 수 있다.

```js
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const payload = event.data || {};
  if (payload.type === 'webos:launch-data') {
    const launchData = payload.launchData || {};
    // reload current document/file state
  }
});
```

## 10. Permission failure handling

모든 SDK API는 Promise rejection으로 명시 오류를 낸다.

```js
try {
  await window.WebOS.ui.notification('Saved');
} catch (err) {
  console.error(err.code, err.message);
}
```

UI는 `err.code`와 `err.message`를 사용자에게 recoverable 상태로 보여주는 것이 좋다.
