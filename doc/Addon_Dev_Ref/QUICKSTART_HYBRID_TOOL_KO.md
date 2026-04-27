# Hybrid Tool Package Quickstart

Status: `[ACTIVE]`

이 문서는 Plex/Immich/downloader류처럼 sandbox UI와 로컬 백엔드 서비스를 함께 가진 `hybrid` 패키지를 만든다.

V1에서 hybrid package는 신뢰한 로컬 패키지 모델이다. Node/Python/binary 프로세스는 OS 레벨로 완전 격리되지 않는다. 설치 전 Package Center가 위험을 보여주고, 사용자가 신뢰한 패키지만 실행하는 구조다.

## 1. 패키지 구조

```text
media-tool/
  manifest.json
  ui/index.html
  service/index.js
```

Python 서비스라면:

```text
media-tool/
  manifest.json
  ui/index.html
  service/main.py
```

## 2. manifest.json: Node hybrid 예시

```json
{
  "id": "media-tool",
  "title": "Media Tool",
  "description": "Hybrid package with sandbox UI and managed local service.",
  "version": "0.1.0",
  "type": "hybrid",
  "runtime": {
    "type": "process-node",
    "entry": "service/index.js",
    "cwd": ".",
    "args": []
  },
  "ui": {
    "type": "sandbox-html",
    "entry": "ui/index.html"
  },
  "service": {
    "autoStart": false,
    "restartPolicy": "on-failure",
    "maxRetries": 3,
    "restartDelayMs": 1000,
    "http": {
      "enabled": true
    }
  },
  "healthcheck": {
    "type": "http",
    "path": "/health",
    "intervalMs": 10000,
    "timeoutMs": 2000
  },
  "permissions": [
    "runtime.process",
    "service.bridge",
    "app.data.read",
    "app.data.write",
    "host.allowedRoots.read"
  ]
}
```

다운로더처럼 네트워크와 host write 위험이 있다면 명시한다.

```json
"permissions": [
  "runtime.process",
  "service.bridge",
  "network.outbound",
  "host.allowedRoots.read",
  "host.allowedRoots.write",
  "app.data.read",
  "app.data.write"
]
```

## 3. Runtime env

Runtime Manager는 managed service에 다음 환경 변수를 넘긴다.

```text
WEBOS_APP_ID
WEBOS_PACKAGE_DIR
WEBOS_APP_DATA_DIR
WEBOS_ALLOWED_ROOTS_JSON
WEBOS_SERVICE_PORT
WEBOS_RUNTIME_MODE=managed-process
```

서비스는 반드시 `127.0.0.1:${WEBOS_SERVICE_PORT}`에 바인딩하는 것을 권장한다. 외부 네트워크에 listen하지 말 것.

## 4. service/index.js

```js
'use strict';

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const appId = process.env.WEBOS_APP_ID || 'media-tool';
const port = Number(process.env.WEBOS_SERVICE_PORT || 0);
const appDataDir = process.env.WEBOS_APP_DATA_DIR || '';

function readAllowedRoots() {
  try {
    return JSON.parse(process.env.WEBOS_ALLOWED_ROOTS_JSON || '[]');
  } catch (_err) {
    return [];
  }
}

async function writeJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    return writeJson(res, 200, { ok: true, appId });
  }

  if (req.method === 'GET' && req.url === '/library/status') {
    return writeJson(res, 200, {
      appId,
      mode: process.env.WEBOS_RUNTIME_MODE,
      appDataDir,
      allowedRoots: readAllowedRoots()
    });
  }

  if (req.method === 'POST' && req.url === '/app-data/write-demo') {
    await fs.mkdir(appDataDir, { recursive: true });
    const filePath = path.join(appDataDir, 'service-demo.json');
    await fs.writeFile(filePath, JSON.stringify({ savedAt: new Date().toISOString() }, null, 2));
    return writeJson(res, 200, { ok: true, file: filePath });
  }

  return writeJson(res, 404, { error: true, code: 'NOT_FOUND', message: 'Not found' });
}

if (!port) {
  throw new Error('WEBOS_SERVICE_PORT is required.');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    writeJson(res, 500, { error: true, code: 'SERVICE_ERROR', message: err.message || String(err) });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Service ${appId} listening on ${port}`);
});
```

## 5. ui/index.html

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Media Tool</title>
  <style>
    body { margin: 0; padding: 16px; background: #0f172a; color: #e5e7eb; font-family: system-ui, sans-serif; }
    main { display: grid; gap: 12px; }
    button { width: fit-content; border: 1px solid #38bdf8; background: #075985; color: white; border-radius: 6px; padding: 8px 10px; }
    pre { white-space: pre-wrap; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 12px; }
    .error { color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <h1>Media Tool</h1>
    <button id="statusButton" type="button">Load Service Status</button>
    <button id="writeButton" type="button">Write Service App Data</button>
    <pre id="output">Waiting...</pre>
    <div id="status">Starting...</div>
  </main>

  <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
  <script>
    const output = document.getElementById('output');
    const status = document.getElementById('status');

    function show(value) {
      output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    async function requestService(path, method = 'GET') {
      return window.WebOS.service.request({ method, path });
    }

    async function main() {
      const context = await window.WebOS.ready();
      status.textContent = `Ready: ${context.app.id}`;

      document.getElementById('statusButton').addEventListener('click', async () => {
        show(await requestService('/library/status'));
      });

      document.getElementById('writeButton').addEventListener('click', async () => {
        show(await requestService('/app-data/write-demo', 'POST'));
      });
    }

    main().catch((err) => {
      status.textContent = err.message || String(err);
      status.className = 'error';
      show({ code: err.code || 'ERROR', message: err.message || String(err) });
    });
  </script>
</body>
</html>
```

## 6. 설치 후 운영 흐름

Package Center의 installed package console에서 다음을 확인한다.

1. preflight에 Tool Package 섹션이 보인다.
2. `runtime.process`, `service.bridge`, allowedRoots/network 권한이 표시된다.
3. service를 start한다.
4. logs/events에 서비스 시작 로그가 보인다.
5. healthcheck가 `/health`로 healthy가 된다.
6. UI를 열고 `WebOS.service.request({ path: '/library/status' })`가 성공한다.
7. stop 후 UI 요청이 명시적인 service unavailable 오류를 보여준다.
8. restart 후 다시 요청이 성공한다.

## 7. 권한 판단

| 기능 | 필요한 권한 |
| --- | --- |
| managed process 실행 | `runtime.process` |
| UI가 자기 서비스 호출 | `service.bridge` |
| 앱 전용 데이터 읽기/쓰기 | `app.data.read`, `app.data.write` |
| 전역 allowedRoots 정보 읽기 | `host.allowedRoots.read` |
| allowedRoots 쓰기 목적 작업 | `host.allowedRoots.write` |
| 외부 다운로드/API 호출 | `network.outbound` |

주의: V1의 `host.allowedRoots.*`는 OS 레벨 강제 sandbox가 아니라 신뢰 모델과 표시/감사 계약이다. 실제 native process는 현재 사용자 OS 권한 안에서 실행된다.

## 8. ZIP 구조

```text
media-tool.zip
  manifest.json
  ui/index.html
  service/index.js
```

## 9. 실패 처리 기준

서비스는 가능하면 명시적인 JSON 오류를 반환한다.

```json
{
  "error": true,
  "code": "LIBRARY_SCAN_FAILED",
  "message": "Failed to scan media root."
}
```

UI는 `WebOS.service.request()` 실패를 recoverable 상태로 보여줘야 한다.

```js
try {
  const status = await window.WebOS.service.request({ path: '/library/status' });
} catch (err) {
  show({ code: err.code, message: err.message });
}
```
