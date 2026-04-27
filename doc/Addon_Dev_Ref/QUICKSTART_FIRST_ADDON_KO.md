# 첫 Sandbox UI 애드온 Quickstart

Status: `[ACTIVE]`

이 문서는 가장 작은 `sandbox-html` 애드온을 만든다. 목표는 launcher에 표시되고, WebOS SDK를 통해 알림과 app-owned data를 사용하는 것이다.

## 1. 패키지 폴더 만들기

독립 개발 기준 패키지 루트:

```text
hello-addon/
  manifest.json
  index.html
```

repo 안에서 직접 테스트한다면 위치는 다음과 같다.

```text
server/storage/inventory/apps/hello-addon/
  manifest.json
  index.html
```

## 2. manifest.json

```json
{
  "id": "hello-addon",
  "title": "Hello Addon",
  "description": "Small sandbox addon used as a development smoke test.",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": [
    "ui.notification",
    "app.data.list",
    "app.data.read",
    "app.data.write"
  ]
}
```

핵심:

- `type: "app"`: launcher에 표시되는 일반 앱
- `runtime.type: "sandbox-html"`: iframe sandbox에서 실행
- `runtime.entry`: 패키지 루트 기준 상대 HTML 경로
- `permissions`: SDK로 사용할 기능을 명시

## 3. index.html

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hello Addon</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 16px; background: #0f172a; color: #e5e7eb; }
    main { display: grid; gap: 12px; align-content: start; }
    button { width: fit-content; border: 1px solid #38bdf8; background: #075985; color: white; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    pre { white-space: pre-wrap; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 12px; }
    .error { color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <h1>Hello Addon</h1>
    <button id="notifyButton" type="button">Send Notification</button>
    <button id="saveButton" type="button">Save App Data</button>
    <pre id="output">Starting...</pre>
    <div id="status">Waiting for WebOS context...</div>
  </main>

  <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
  <script>
    const statusEl = document.getElementById('status');
    const outputEl = document.getElementById('output');
    const notifyButton = document.getElementById('notifyButton');
    const saveButton = document.getElementById('saveButton');

    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.className = isError ? 'error' : '';
    }

    function show(value) {
      outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    async function main() {
      const context = await window.WebOS.ready();
      show(context);
      setStatus(`Ready: ${context.app.id}`);

      notifyButton.addEventListener('click', async () => {
        await window.WebOS.ui.notification({
          title: 'Hello Addon',
          message: 'Notification from sandbox addon.'
        });
      });

      saveButton.addEventListener('click', async () => {
        await window.WebOS.app.data.write({
          path: 'hello.json',
          content: JSON.stringify({ savedAt: new Date().toISOString() }, null, 2)
        });
        const saved = await window.WebOS.app.data.read({ path: 'hello.json' });
        show(saved);
      });
    }

    main().catch((err) => {
      setStatus(err.message || String(err), true);
      show({ code: err.code || 'ERROR', message: err.message || String(err) });
    });
  </script>
</body>
</html>
```

## 4. ZIP 설치

```text
hello-addon.zip
  manifest.json
  index.html
```

Package Center에서 ZIP import를 실행하면 preflight가 manifest, permissions, backup/rollback 영향을 확인한다.

## 5. 개발 smoke checklist

- launcher에 앱이 표시된다.
- 앱을 열면 `WebOS.ready()`가 성공한다.
- notification 버튼이 동작한다.
- app data write/read가 동작한다.
- browser console에 permission denied가 없다.
- ZIP import 후에도 동일하게 동작한다.

## 6. 흔한 실패

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| `APP_PERMISSION_DENIED` | manifest permissions 누락 | 사용하는 SDK 권한 추가 |
| `WEBOS_SDK_READY_TIMEOUT` | sandbox context를 못 받음 | `/api/sandbox/sdk.js` 로드, iframe launch 확인 |
| app data write 실패 | `app.data.write` 누락 | permission 추가 |
| launcher에 안 보임 | `type`/`runtime.entry`/파일 누락 | manifest와 entry 파일 확인 |
