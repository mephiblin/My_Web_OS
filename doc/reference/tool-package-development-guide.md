# Tool Package Development Guide

Status: `[ACTIVE]`

This guide defines the V1 package model for Plex, Immich, downloader, and
local-service class tools.

## Package Classes

Small sandbox addon:

- `type: "app"`
- `runtime.type: "sandbox-html"`
- runs only in the browser sandbox
- uses app data, notifications, and grant-based file handoff

Service package:

- `type: "service"`
- `runtime.type: "process-node"`, `process-python`, or `binary`
- does not appear as a desktop launcher app
- is operated from Package Center with start, stop, restart, logs, events, and health

Hybrid tool package:

- `type: "hybrid"`
- managed service runtime plus sandbox UI
- appears in the launcher through `ui.entry`
- runs trusted local process code through Runtime Manager

## Hybrid Manifest

```json
{
  "id": "media-tool",
  "title": "Media Tool",
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
    "path": "/health"
  },
  "permissions": [
    "runtime.process",
    "service.bridge",
    "host.allowedRoots.read",
    "app.data.read",
    "app.data.write"
  ]
}
```

## Runtime Environment

Managed services receive:

```text
WEBOS_APP_ID
WEBOS_PACKAGE_DIR
WEBOS_APP_DATA_DIR
WEBOS_ALLOWED_ROOTS_JSON
WEBOS_SERVICE_PORT
WEBOS_RUNTIME_MODE=managed-process
```

Services should bind HTTP APIs to:

```text
127.0.0.1:${WEBOS_SERVICE_PORT}
```

## Sandbox UI Bridge

Hybrid UIs call their paired service through:

```js
await window.WebOS.service.request({
  method: 'GET',
  path: '/library/status'
});
```

The bridge requires `service.bridge`, only targets the same package service,
and proxies to `127.0.0.1`.

## Trust Boundary

Native process packages are trusted local tools, not browser-only untrusted
addons. V1 uses global configured `allowedRoots` for local storage access.
Docker isolation and per-package folder grants are future layers.

Package Center must show runtime, permissions, allowed roots access, health,
logs, backup, and rollback before operators treat these packages as safe.

