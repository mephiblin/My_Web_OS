# Security, Limits, And Approval Rules

Status: `[ACTIVE]`

이 문서는 addon/package 개발자가 반드시 이해해야 하는 보안 경계다.

## 1. 두 가지 신뢰 모델

### Sandbox UI addon

```text
sandbox-html iframe
  -> parent frame bridge
  -> backend permission check
  -> scoped operation
```

특징:

- 브라우저 iframe sandbox 안에서 실행된다.
- Host filesystem을 직접 만지지 못한다.
- SDK와 backend guard를 통해서만 기능을 요청한다.
- 위험 작업 approval은 parent frame이 담당한다.

### Native process package

```text
managed process: process-node/process-python/binary
  -> local OS process
  -> Runtime Manager lifecycle/log/health
```

특징:

- 신뢰한 로컬 패키지 모델이다.
- OS 레벨 완전 격리가 아니다.
- Package Center가 위험 권한과 실행 정보를 명확히 보여줘야 한다.
- Docker/컨테이너 격리는 V1 범위가 아니다.

## 2. Sandbox iframe 제한

현재 sandbox UI는 제한된 iframe에서 실행된다고 가정한다.

사용하지 말 것:

- parent DOM 직접 접근
- same-origin storage 의존
- cookies
- `localStorage`, `sessionStorage`
- popups
- top navigation
- 임의 download
- 임의 `/api/*` 직접 호출

사용할 것:

- `/api/sandbox/sdk.js`
- `window.WebOS.ready()`
- `WebOS.app.data.*`
- `WebOS.files.*`
- `WebOS.service.request()`

## 3. Host file access

Host file 접근 조건:

1. manifest permission 선언
2. File Station 또는 trusted parent flow가 만든 grant
3. backend path validation
4. app/user/grant match
5. overwrite 등 위험 작업은 별도 approval

읽기:

```js
await WebOS.files.read({ path, grantId });
```

쓰기:

```js
await WebOS.files.write({ path, grantId, content, overwrite: true });
```

Sandbox addon은 임의 host path에 새 파일을 직접 만들 수 있다고 가정하면 안 된다. 새 host 파일은 File Station template 같은 trusted UI에서 만들고 grant로 전달받는다.

## 4. Overwrite approval

Overwrite는 parent-owned approval이다.

정상 흐름:

```text
addon calls WebOS.files.write({ overwrite: true })
  -> backend returns approval-required preflight
  -> parent shows typed confirmation UI
  -> user types confirmation
  -> parent creates approval
  -> parent retries write with scoped approval evidence
  -> backend validates target hash and consumes nonce once
```

금지:

```js
await WebOS.files.approveWrite();
fetch('/api/sandbox/my-addon/file/write/approve');
fetch('/api/sandbox/my-addon/file/write', { body: JSON.stringify({ approved: true }) });
```

## 5. Service bridge 보안

`WebOS.service.request()`는 hybrid UI가 자기 service에 요청하는 유일한 표준 경로다.

허용:

```js
await WebOS.service.request({ method: 'GET', path: '/health' });
```

거부:

```js
await WebOS.service.request({ path: 'http://127.0.0.1:22/' });
await WebOS.service.request({ path: '//localhost/admin' });
await WebOS.service.request({ path: '/../secret' });
await WebOS.service.request({ path: '/%2e%2e/secret' });
```

Backend proxy 규칙:

- target은 항상 `127.0.0.1:<WEBOS_SERVICE_PORT>`다.
- service port는 runtime configured range 안이어야 한다.
- absolute URL, protocol-relative URL, backslash, traversal, invalid encoding은 거부된다.
- hop-by-hop/sensitive headers는 허용하지 않는다.
- request body size 제한이 있다.
- timeout은 runtime config의 `serviceProxyTimeoutMs`를 따른다.

## 6. allowedRoots 모델

V1은 global `allowedRoots` 모델이다.

- `WEBOS_ALLOWED_ROOTS_JSON`이 service env로 전달된다.
- 패키지는 설치 전 `host.allowedRoots.read/write` 의도를 manifest에 표시한다.
- Package Center가 이 위험을 보여준다.
- OS 레벨로 “이 process는 이 폴더만 접근 가능”을 강제하지 않는다.

따라서 신뢰하지 않는 외부 패키지를 native process로 실행하면 안 된다. 외부 마켓플레이스 수준 신뢰 모델은 Docker/per-folder grant 같은 V2 격리가 필요하다.

## 7. network permission

외부 API 호출, 다운로드, metadata fetch, youtube download 같은 기능은 `network.outbound`를 선언해야 한다.

이 권한은 현재 네트워크를 OS 레벨로 막는 기능이라기보다 설치 전 위험 표시와 감사/정책 계약이다.

## 8. App data boundary

App-owned data는 안전한 기본 저장소다.

```text
WEBOS_APP_DATA_DIR
```

권장:

- 설정 파일
- job queue metadata
- scan cache
- thumbnails/index database
- package-local state

주의:

- 사용자 media library 원본을 app data에 복사하지 말 것.
- 대용량 파일은 allowedRoots나 user-selected grant를 통해 다룰 것.

## 9. Package lifecycle approval

설치/업데이트/rollback/delete/manifest update는 Package Center lifecycle approval을 거친다.

패키지 개발자는 다음 정보를 preflight에서 잘 드러나게 manifest를 작성해야 한다.

- runtime type/command/entry
- permissions
- network/allowedRoots 의도
- healthcheck
- backup/rollback 영향
- service autoStart/restartPolicy

## 10. 보안 체크리스트

릴리즈 전 확인:

- 불필요한 `host.*`, `runtime.process`, `network.outbound` 권한이 없는가?
- sandbox UI가 임의 `/api/*` route를 직접 호출하지 않는가?
- service가 `127.0.0.1`에만 listen하는가?
- service path API가 명시 JSON 오류를 반환하는가?
- app data와 사용자 원본 파일을 구분하는가?
- update 전 backup/rollback 경로가 Package Center에 표시되는가?
- stopped service 상태를 UI가 recoverable error로 보여주는가?
