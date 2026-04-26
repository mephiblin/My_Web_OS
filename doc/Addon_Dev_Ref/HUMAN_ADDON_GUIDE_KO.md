# 인간 개발자를 위한 애드온 개발 가이드

상태: `[ACTIVE]`

이 문서는 My Web OS에서 애드온을 만들 때 필요한 실전 기준을 정리한다.
목표는 “core를 건드리지 않고도 설치, 실행, 파일 연동, 검증이 되는 애드온”을
만드는 것이다.

## 1. 기본 개념

My Web OS의 일반 애드온은 브라우저 iframe 안에서 실행되는 package app이다.

기본 형태:

```text
Package app
  -> manifest.json으로 권한과 실행 파일 선언
  -> sandbox-html runtime으로 iframe 실행
  -> /api/sandbox/sdk.js로 Web OS 기능 사용
  -> Package Center가 설치/업데이트/삭제/백업/롤백 관리
```

즉, 애드온은 독립 앱이고 Web OS core는 운영체제처럼 실행 환경과 권한을
제공한다.

## 2. 어디에 파일을 만들까

일반적인 개발 위치:

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
  assets/
  vendor/
```

기존 built-in addon을 package-first로 관리하는 경우:

```text
client/src/apps/addons/<addon>/
  components/
  services/
  package/
    manifest.json
    index.html

server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
```

주의:

- `Desktop.svelte`, `Window.svelte`, `Spotlight.svelte`에 애드온 기능을 넣지 않는다.
- core 파일은 여러 애드온이 공통으로 쓸 새 기능이 필요할 때만 수정한다.
- 애드온별 파서, 렌더러, 툴바, 설정 화면은 애드온 내부에 둔다.

## 3. 필수 파일

### manifest.json

최소 예시:

```json
{
  "id": "hello-addon",
  "title": "Hello Addon",
  "version": "1.0.0",
  "type": "app",
  "runtime": {
    "type": "sandbox-html",
    "entry": "index.html"
  },
  "permissions": ["ui.notification", "app.data.read", "app.data.write"]
}
```

중요한 필드:

- `id`: 앱 고유 ID
- `title`: 사용자에게 보이는 이름
- `version`: 패키지 버전
- `type`: 보통 `app`
- `runtime.type`: 일반 애드온은 `sandbox-html`
- `runtime.entry`: 실행 HTML
- `permissions`: 필요한 권한만 최소 선언

### index.html

반드시 SDK를 포함한다.

```html
<script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
```

그리고 SDK 준비를 기다린다.

```js
await window.WebOS.ready();
```

## 4. 권한 설계

권한은 적게 줄수록 좋다.

자주 쓰는 권한:

```text
ui.notification    알림 표시
window.open        다른 Web OS 앱 열기
system.info        시스템 개요 조회
app.data.read      애드온 전용 데이터 읽기
app.data.write     애드온 전용 데이터 쓰기
host.file.read     File Station grant로 host 파일 읽기
host.file.write    File Station grant로 host 파일 쓰기
```

주의:

- host 파일은 grant 없이 접근할 수 없다.
- grant는 보통 File Station에서 파일을 열거나 preview handoff를 할 때 발급된다.
- `host.file.write`는 실제 PC/서버 파일을 바꾸므로 꼭 필요한 경우에만 쓴다.

## 5. UI 구성 기준

애드온은 랜딩 페이지가 아니라 도구처럼 보여야 한다.

권장 구조:

```text
상단 toolbar
작업 영역
하단 status/error
```

필수 UI 상태:

- 로딩 중
- 준비됨
- 권한 없음
- 파일 grant 없음
- 작업 성공
- 작업 실패

피해야 할 것:

- 빈 화면
- 무한 로딩
- 브라우저 기본 `confirm()` / `prompt()`
- 위험 작업을 조용히 실행하는 버튼
- core 앱처럼 보이지만 실제로는 권한이 부족한 UI

## 6. WebOS SDK 사용법

### 시작

```js
await window.WebOS.ready();
const context = window.WebOS.getContext();
```

### 알림

```js
await window.WebOS.ui.notification({
  title: 'My Addon',
  message: '저장했습니다.',
  type: 'success'
});
```

### 애드온 전용 데이터

```js
await window.WebOS.app.data.write({
  path: 'settings.json',
  content: JSON.stringify({ theme: 'dark' }, null, 2)
});

const result = await window.WebOS.app.data.read({
  path: 'settings.json'
});
```

### File Station에서 열린 파일 읽기

```js
await window.WebOS.ready();

const context = window.WebOS.getContext();
const file = context?.launchData?.fileContext?.file;
const permission = context?.launchData?.fileContext?.permissionContext;

if (!file?.path || !permission?.grantId) {
  throw new Error('File Station에서 파일을 열어주세요.');
}

const result = await window.WebOS.files.read({
  path: file.path,
  grantId: permission.grantId
});
```

### 미리보기 raw URL

```js
const ticket = await window.WebOS.files.rawTicket({
  path: file.path,
  grantId: permission.grantId,
  profile: 'preview'
});

const url = window.WebOS.files.rawUrl(ticket);
```

주의:

- `rawUrl({ path, grantId })` 방식은 금지다.
- 반드시 `rawTicket()`을 먼저 받고, 그 결과를 `rawUrl(ticket)`에 넣는다.

### host 파일 쓰기

```js
await window.WebOS.files.write({
  path: file.path,
  grantId: permission.grantId,
  content: nextContent,
  overwrite: true
});
```

덮어쓰기가 필요하면 Web OS 부모 프레임이 승인 dialog를 띄운다.
애드온은 직접 승인 nonce를 만들거나 approve API를 호출하면 안 된다.

## 7. 파일 연결

애드온을 File Station에서 열 수 있게 하려면 `fileAssociations`를 쓴다.

```json
{
  "fileAssociations": [
    {
      "extensions": ["md", "txt"],
      "actions": ["open", "edit", "preview"],
      "defaultAction": "open"
    }
  ]
}
```

오른쪽 클릭 메뉴나 새 파일 템플릿을 추가하려면 `contributes`를 쓴다.

```json
{
  "contributes": {
    "fileContextMenu": [
      {
        "label": "Open in My Addon",
        "action": "open",
        "extensions": ["md", "txt"]
      }
    ],
    "fileCreateTemplates": [
      {
        "label": "Markdown File",
        "name": "Untitled.md",
        "extension": "md",
        "content": "# Untitled\n\n",
        "action": "edit",
        "openAfterCreate": true
      }
    ]
  }
}
```

## 8. 설치 방법

### 로컬 개발

`server/storage/inventory/apps/<app-id>/`에 직접 파일을 둔다.

검증:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
```

### ZIP import

zip 루트에 아래 파일이 있어야 한다.

```text
manifest.json
index.html
assets/
vendor/
```

Package Center에서 ZIP import로 설치한다.

### Git registry

배포용으로는 Git 저장소에 store index와 zip artifact를 둔다.

```text
webos-store.json
releases/<addon>.zip
```

자세한 형식은 `doc/reference/community-registry-and-presets.md`를 본다.

## 9. 필수 검증

개발 중:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
npm run verify:ui-smoke
git diff --check
```

공유/배포 전:

```bash
npm run verify
```

수동 확인:

1. launcher에서 애드온 실행
2. File Station에서 관련 파일 열기
3. grant 없는 상태에서 명확한 오류 표시
4. 파일 읽기 성공
5. 파일 쓰기 성공
6. 덮어쓰기 때 Web OS 승인 dialog 표시
7. 창 닫기/다시 열기
8. Package Center에서 삭제/재설치 또는 업데이트

## 10. 한계점

현재 한계:

- sandbox app은 kernel/VM 수준 격리가 아니다.
- host 파일 접근은 File Station grant가 있을 때만 가능하다.
- 덮어쓰기 승인은 Web OS 부모 프레임이 담당한다.
- `backgroundServices.autoStart`는 아직 자동 실행이 아니라 metadata 요청이다.
- `settingsPanels`는 검증/표시 metadata이며 완전한 settings launch UI는 이후 단계다.
- backend restart 시 pending approval은 만료/실패할 수 있다.
- 실제 장기 전송/백업 안정성은 실사용 데이터가 중요하다.

## 11. 금지 패턴

절대 쓰지 말 것:

```js
await window.WebOS.files.approveWrite();
window.WebOS.files.rawUrl({ path, grantId });
fetch('/api/sandbox/my-addon/file/write/approve');
```

금지 payload:

```json
{
  "approval": {
    "approved": true
  }
}
```

이런 패턴은 self-approval 또는 raw grant URL 회귀로 간주한다.

## 12. 애드온 개발 판단 기준

core를 수정해도 되는 경우:

- 여러 애드온이 공통으로 쓸 새 SDK API가 필요함
- 새 manifest extension point가 필요함
- File Station handoff 계약이 부족함
- package lifecycle 기능이 부족함
- security/approval boundary를 고쳐야 함

core를 수정하면 안 되는 경우:

- 특정 애드온의 버튼/툴바
- 특정 포맷 parser
- 특정 viewer/editor renderer
- 특정 애드온 설정 UI
- 특정 애드온만 쓰는 상태 저장 방식

기본 원칙:

```text
앱 기능은 애드온 안에.
권한/승인/설치/실행 계약은 Web OS core에.
```

