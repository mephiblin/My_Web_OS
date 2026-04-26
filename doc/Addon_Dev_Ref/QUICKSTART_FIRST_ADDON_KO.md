# 첫 애드온 Quickstart

상태: `[ACTIVE]`

이 문서는 빈 폴더에서 시작해서 launcher에서 실행되는 가장 작은 애드온을
만드는 절차다. 파일 연동, 배포, 권한 승인은 뒤 문서를 보고 붙인다.

## 1. 폴더 만들기

```bash
mkdir -p server/storage/inventory/apps/hello-addon
```

## 2. manifest.json 작성

`server/storage/inventory/apps/hello-addon/manifest.json`:

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

일반 UI 애드온은 `type: "app"`과 `runtime.type: "sandbox-html"`을 기본값으로
쓴다. `service`, `hybrid`, `process-node`, `process-python`, `binary`는
ordinary UI addon 계약이 아니며 별도 lifecycle/approval 설계가 필요하다.

## 3. index.html 작성

`server/storage/inventory/apps/hello-addon/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hello Addon</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: system-ui, sans-serif;
      background: #111827;
      color: #e5e7eb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    header, footer {
      padding: 12px 16px;
      background: #0f172a;
      border-bottom: 1px solid #243244;
    }
    main {
      display: grid;
      gap: 12px;
      align-content: start;
      padding: 16px;
    }
    button {
      width: fit-content;
      border: 1px solid #38bdf8;
      background: #075985;
      color: white;
      border-radius: 6px;
      padding: 8px 10px;
      cursor: pointer;
    }
    pre {
      white-space: pre-wrap;
      background: #020617;
      border: 1px solid #243244;
      border-radius: 6px;
      padding: 12px;
    }
    .error {
      color: #fecaca;
    }
  </style>
</head>
<body>
  <header>
    <strong>Hello Addon</strong>
  </header>
  <main>
    <button id="notifyButton" type="button">Send Notification</button>
    <button id="saveButton" type="button">Save App Data</button>
    <pre id="output">Starting...</pre>
  </main>
  <footer id="status">Waiting for WebOS context...</footer>

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
      outputEl.textContent = typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
    }

    async function main() {
      const context = await window.WebOS.ready();
      const app = context?.app || {};
      setStatus(`Ready: ${app.id || 'unknown app'}`);
      show({
        appId: app.id,
        permissions: app.permissions || [],
        launchData: app.launchData || null
      });

      notifyButton.addEventListener('click', async () => {
        await window.WebOS.ui.notification({
          title: app.title || 'Hello Addon',
          message: 'Hello from sandbox addon.',
          type: 'success'
        });
      });

      saveButton.addEventListener('click', async () => {
        await window.WebOS.app.data.write({
          path: 'settings.json',
          content: JSON.stringify({ savedAt: new Date().toISOString() }, null, 2)
        });
        const files = await window.WebOS.app.data.list({ path: '' });
        const saved = await window.WebOS.app.data.read({ path: 'settings.json' });
        show({ files, saved });
      });
    }

    main().catch((err) => {
      setStatus(err?.message || 'Addon failed to start.', true);
      show({
        code: err?.code || 'ADDON_START_FAILED',
        message: err?.message || String(err)
      });
    });
  </script>
</body>
</html>
```

## 4. 검증

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/hello-addon/manifest.json
git diff --check
```

## 5. 실행

1. Web OS를 실행한다.
2. browser를 새로고침해서 app registry cache를 갱신한다.
3. launcher에서 `Hello Addon`을 연다.
4. `Ready: hello-addon`이 보이고 버튼 동작이 성공하면 최소 실행 계약은 통과다.

서버가 이미 켜져 있다면 inventory 파일을 추가해도 보통 서버 재시작은 필요하지
않다. 다만 client app registry는 한 번 로드되면 cache되므로 browser reload가
가장 확실하다.

## 6. 다음 단계

- File Station에서 파일을 열어야 하면 `CORE_INTEGRATION_MAP.md`를 본다.
- 권한, manifest, extension point는 `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`를 본다.
- ZIP import, registry, update, rollback은 `PACKAGE_LIFECYCLE_AND_DISTRIBUTION.md`를 본다.
- host 파일 overwrite와 승인 UX는 `SECURITY_LIMITS_AND_APPROVALS.md`를 본다.
