# Manifest, Permissions, And Extension Points

Status: `[ACTIVE]`

이 문서는 My Web OS package manifest의 독립 개발 계약이다.

## 1. 최소 sandbox app manifest

```json
{
  "id": "my-addon",
  "title": "My Addon",
  "description": "Small sandbox addon.",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": []
}
```

필수 필드:

| Field | 설명 |
| --- | --- |
| `id` | 안정적인 package/app id. 소문자, 숫자, dash 권장 |
| `title` | 사용자에게 보이는 이름 |
| `version` | semver-like 버전 문자열 |
| `type` | `app`, `widget`, `service`, `hybrid`, `developer` |
| `runtime.type` | 실행 방식 |
| `runtime.entry` | runtime entry 파일. 패키지 루트 기준 상대 경로 |
| `permissions` | 사용할 capability 목록 |

## 2. Package types

| Type | 의미 | Launcher |
| --- | --- | --- |
| `app` | 일반 windowed sandbox app | 표시 |
| `widget` | desktop widget package | Package Center widget 영역 대상, Launcher 숨김 |
| `service` | UI 없는 background package | 숨김 |
| `hybrid` | sandbox UI + managed service | `ui.entry`가 있으면 표시 |
| `developer` | 개발/테스트 도구 | 구현 정책에 따름 |

## 3. Runtime types

| Runtime | 용도 | 격리 수준 |
| --- | --- | --- |
| `sandbox-html` | HTML/CSS/JS UI addon | iframe sandbox |
| `process-node` | Node.js managed service | 신뢰한 native process |
| `process-python` | Python managed service | 신뢰한 native process |
| `binary` | allowlisted binary service | 신뢰한 native process |

일반 UI 애드온은 `type: "app"` + `runtime.type: "sandbox-html"`을 사용한다.

Plex/Immich/downloader급 툴은 `type: "hybrid"`를 사용한다.

앱과 위젯은 같은 package manifest와 sandbox SDK를 쓴다. 개발자는 다음 중 하나를 선택한다.

- 창으로 열리는 앱: `type: "app"`
- 바탕화면에 붙는 위젯: `type: "widget"`
- 둘 다 제공하는 패키지: `type: "app"` + `contributes.widgets`

## 4. Hybrid manifest contract

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
    "path": "/health",
    "intervalMs": 10000,
    "timeoutMs": 2000
  },
  "permissions": [
    "runtime.process",
    "service.bridge",
    "app.data.read",
    "app.data.write"
  ]
}
```

Hybrid 규칙:

- `runtime.entry`는 service entry다.
- `ui.entry`는 launcher에서 열리는 sandbox UI entry다.
- `ui.type`은 `sandbox-html`이어야 한다.
- `runtime.type`은 `process-node`, `process-python`, `binary` 중 하나여야 한다.
- UI가 service를 호출하려면 `service.bridge`가 필요하다.
- managed process 실행에는 `runtime.process`가 필요하다.

## 5. Service package manifest

UI가 없는 background package:

```json
{
  "id": "index-worker",
  "title": "Index Worker",
  "version": "0.1.0",
  "type": "service",
  "runtime": {
    "type": "process-node",
    "entry": "service/index.js"
  },
  "service": {
    "autoStart": true,
    "restartPolicy": "on-failure",
    "maxRetries": 3,
    "restartDelayMs": 1000,
    "http": { "enabled": true }
  },
  "healthcheck": {
    "type": "http",
    "path": "/health"
  },
  "permissions": ["runtime.process", "app.data.read", "app.data.write"]
}
```

## 6. Permissions

| Permission | 용도 | 위험 |
| --- | --- | --- |
| `ui.notification` | notification/toast 표시 | 낮음 |
| `window.open` | 다른 Web OS app 열기 | 낮음/중간 |
| `system.info` | 시스템 요약 조회 | 중간 |
| `calendar.read` | 코어 Calendar 공용 일정 읽기 | 낮음 |
| `calendar.write` | 코어 Calendar 공용 일정 생성/수정/삭제 | 중간 |
| `app.data.list` | app-owned data 목록 | 낮음 |
| `app.data.read` | app-owned data 읽기 | 낮음 |
| `app.data.write` | app-owned data 쓰기 | 낮음/중간 |
| `host.file.read` | File Station grant 기반 host file 읽기 | 높음 |
| `host.file.write` | grant 기반 host file 쓰기/overwrite | 높음 |
| `runtime.process` | managed native process 실행 | 높음 |
| `service.bridge` | sandbox UI가 자기 service 호출 | 중간/높음 |
| `host.allowedRoots.read` | configured allowedRoots 정보/대상 읽기 의도 | 높음 |
| `host.allowedRoots.write` | allowedRoots 대상 쓰기 의도 | 높음 |
| `network.outbound` | 외부 네트워크/API/download | 중간/높음 |

권한 원칙:

- 필요한 것만 선언한다.
- `runtime.process`, `host.*`, `network.outbound`는 설치 전 설명이 필요하다.
- `host.allowedRoots.*`는 V1에서 OS 강제 격리가 아니라 신뢰/표시/감사 계약이다.
- 파일 하나를 열고 저장하는 UI 애드온은 `host.file.read/write` grant 흐름을 사용한다.
- 로컬 라이브러리를 스캔하는 서비스는 `host.allowedRoots.read`를 선언한다.

## 7. Optional metadata

```json
{
  "author": "Your Name",
  "repository": "https://example.com/repo",
  "icon": "Package",
  "singleton": true,
  "window": {
    "width": 960,
    "height": 720,
    "minWidth": 480,
    "minHeight": 320
  }
}
```

## 8. File associations

파일 뷰어/에디터는 file association을 선언할 수 있다.

```json
{
  "fileAssociations": [
    {
      "id": "markdown-open",
      "label": "Open Markdown",
      "extensions": ["md", "markdown"],
      "mimeTypes": ["text/markdown"],
      "action": "open"
    }
  ],
  "permissions": ["host.file.read"]
}
```

File Station은 앱을 launch하면서 `context.app.launchData`에 path/grant 정보를 넣는다. Addon은 직접 host path를 신뢰하지 말고 SDK의 file API를 사용한다.

## 8.1 Desktop widgets

위젯은 별도 배포 단위가 아니라 Package Center가 설치/삭제/권한을 관리하는 package surface다.

위젯 전용 패키지:

```json
{
  "id": "desktop-calendar",
  "title": "Desktop Calendar",
  "version": "0.1.0",
  "type": "widget",
  "runtime": {
    "type": "sandbox-html",
    "entry": "widget.html"
  },
  "permissions": ["calendar.read"]
}
```

`type: "widget"`은 `runtime.entry`를 기본 위젯 entry로 자동 노출한다.

앱과 위젯을 같이 제공하는 패키지:

```json
{
  "id": "calendar-suite",
  "title": "Calendar Suite",
  "version": "0.1.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": ["calendar.read", "calendar.write"],
  "contributes": {
    "widgets": [
      {
        "id": "glass-calendar",
        "label": "Glass Calendar",
        "entry": "widget.html",
        "defaultSize": { "w": 900, "h": 520 },
        "minSize": { "w": 320, "h": 220 }
      }
    ]
  }
}
```

위젯 entry도 `/api/sandbox/sdk.js`를 로드하고 `window.WebOS.ready()`를 기다린다. 권한은 일반 sandbox app과 동일하게 manifest의 `permissions`를 따른다.

설치된 package가 `contributes.widgets`를 선언하면 Widget Store가 해당 위젯을 자동으로 진열한다. 사용자는 애드온 앱을 열지 않아도 Widget Store의 package/addon 위젯 목록에서 발견하고 데스크톱에 추가할 수 있어야 한다.

## 9. Healthcheck

Managed service는 healthcheck를 선언할 수 있다.

```json
{
  "healthcheck": {
    "type": "http",
    "path": "/health",
    "intervalMs": 10000,
    "timeoutMs": 2000
  }
}
```

규칙:

- HTTP healthcheck path는 `/`로 시작하는 상대 path여야 한다.
- absolute URL은 허용하지 않는다.
- `..`, backslash, control character는 사용하지 않는다.
- Runtime Manager가 `127.0.0.1:<WEBOS_SERVICE_PORT>`로 붙인다.

## 10. Compatibility/dependencies

선택적으로 dependencies/compatibility를 선언할 수 있다.

```json
{
  "dependencies": [
    { "id": "helper-package", "version": ">=1.0.0", "optional": false }
  ],
  "compatibility": {
    "minServerVersion": "1.0.0",
    "requiredRuntimeTypes": ["process-node"]
  }
}
```

Package Center preflight가 dependency/compatibility 경고 또는 실패를 표시한다.
