# NexusTerm 개발 계획서

상태: `[DRAFT]`
작성일: `2026-04-26`
참조 이미지:

- `Addon_Dev_Help/NexusTerm/NexusTerm_Ref_Desk.png`
- `Addon_Dev_Help/NexusTerm/NexusTerm_Ref_Mobile.png`

## 1. 결론

NexusTerm은 ordinary sandbox addon이 아니라 새 `system` 앱으로 개발한다.

이유:

- 실제 로컬 terminal/PTY 세션에 연결한다.
- host 폴더 탐색, host 파일 읽기, Markdown/코드 편집, 검색을 제공한다.
- AI를 이용한 vibe coding 흐름은 명령 실행과 파일 변경을 유도할 수 있다.
- 현재 애드온 계약에서 `system/terminal/docker operations`는 high-risk이고,
  `sandbox-html` 앱이 직접 다루면 안 된다.

따라서 구현 방향은 다음과 같다.

```text
NexusTerm = trusted system app
  -> existing terminal approval/PTY contract reuse
  -> File Station FS APIs reuse
  -> Code Editor/Document Viewer rendering/editing logic reuse where practical
  -> AI assist는 제안/패치 중심으로 시작하고 실행은 사용자 승인 필요
```

`Desktop.svelte`와 `Window.svelte`에는 기능을 넣지 않는다. 앱 등록과 lazy
loader만 연결하고, 기능 코드는 `client/src/apps/system/nexus-term/` 아래에 둔다.

## 2. 레퍼런스 이미지 해석

### Desktop

`NexusTerm_Ref_Desk.png`는 IDE-lite 형태의 개발 작업공간이다.

- 좌측 대형 터미널 탭이 주 작업 영역이다.
- 우측 상단은 프로젝트 폴더 Explorer다.
- 우측 하단은 선택 파일의 Preview/Editor 영역이다.
- Markdown 파일은 rendered preview와 raw/source 전환이 필요하다.
- 상단에는 탭, 검색, 설정, layout 전환 같은 global tools가 있다.
- 하단에는 git branch, shell, encoding, file type, status indicator가 있다.

핵심은 “터미널을 중심으로 파일 구조와 문서/코드를 바로 확인하고 수정하는
workspace”다.

### Mobile

`NexusTerm_Ref_Mobile.png`는 모바일에서 같은 기능을 split pane이 아니라
탭/시트 방식으로 재구성한다.

하단 탭:

- `터미널`: 실제 terminal session
- `탐색기`: 폴더 트리와 파일 선택
- `뷰어`: Markdown/코드 preview 또는 editor
- `검색`: 파일명, 명령 기록, 파일 내용 검색
- `더보기`: 세션, 설정, split 보기, AI 도구

모바일 원칙:

- 터미널이 기본 화면이다.
- 키보드가 열리면 터미널 viewport를 보존하고 보조 패널은 숨기거나 sheet로
  내린다.
- 탐색기/뷰어/검색은 한 번에 하나씩 보여준다.
- dangerous action은 작은 화면에서도 typed confirmation과 summary를 생략하지
  않는다.

## 3. 제품 목표

NexusTerm은 AI-assisted vibe coding을 위한 Web OS system app이다.

목표:

- 브라우저 안에서 실제 로컬 shell에 연결한다.
- 현재 프로젝트 폴더를 탐색하고 파일을 빠르게 연다.
- Markdown 문서와 코드 파일을 읽고 편집한다.
- 터미널 출력, 선택 파일, 현재 폴더를 하나의 작업 context로 묶는다.
- AI는 명령/패치/설명 제안에서 시작하고, 자동 실행은 명시 승인 이후 단계로
  제한한다.
- 데스크톱과 모바일 모두 같은 작업 모델을 제공한다.

비목표:

- kernel/VM 수준 격리 제공.
- public internet 노출용 원격 IDE 제공.
- ordinary addon이 shell을 직접 여는 계약 추가.
- AI가 사용자 승인 없이 명령을 실행하거나 파일을 변경하는 기능.
- Docker/neko 같은 외부 service lifecycle을 NexusTerm 1차 범위에 포함.

## 4. 레이어 분류

- [x] Host
- [x] Web Desktop
- [x] System Apps
- [ ] Addon Runtime/UI
- [ ] Sandbox / Package
- [x] Docs / Verification

Risk level: `High`

터미널, host 파일 편집, 검색, AI 제안이 실제 host 상태에 영향을 줄 수 있다.
따라서 system app으로 두고 기존 backend approval/audit 계약을 사용한다.

## 5. 기존 코드 재사용 지점

### Terminal

현재 구조:

- UI: `client/src/apps/system/terminal/Terminal.svelte`
- Backend: `server/services/terminal.js`
- Socket events:
  - `terminal:session-preflight`
  - `terminal:session-approve`
  - `terminal:init`
  - `terminal:input`
  - `terminal:resize`
  - `terminal:output`
  - `terminal:ready`
  - `terminal:exit`

재사용:

- `node-pty` 세션 생성
- `terminal.session` preflight/typed confirmation/approval nonce
- target hash 검증
- audit log
- xterm rendering

필요한 리팩터:

- Terminal UI의 socket/session 로직을 `terminalSessionClient.js` 또는 Svelte store로
  추출한다.
- 기존 Terminal system app은 이 추출 모듈을 계속 사용한다.
- NexusTerm은 같은 contract를 사용하되 workspace layout에 맞게 UI를 감싼다.

### File Station

현재 구조:

- UI/API helper: `client/src/apps/system/file-explorer/api.js`
- Backend routes: `/api/fs/*`

재사용:

- `fetchConfig()`
- `fetchUserDirs()`
- `listDir(path)`
- `readFile(path)`
- `writeFileWithPolicy(path, content, { overwrite, approval })`
- `preflightOverwrite(path)`
- `approveOverwrite(path, preflight, typedConfirmation)`
- `executeOverwrite(path, content, approval)`
- `search`

주의:

- system app이라도 allowed roots/path boundary를 우회하지 않는다.
- overwrite는 기존 FS approval contract를 유지한다.
- delete/rename/create/extract 같은 destructive operations는 MVP 이후로 미룬다.

### Code Editor

현재 구조:

- UI: `client/src/apps/addons/code-editor/components/CodeEditorApp.svelte`
- API helper: `client/src/apps/addons/code-editor/services/fileApi.js`

재사용:

- file read/write approval 흐름
- language detection
- Monaco 기반 코드 편집 경험

주의:

- 코드 에디터는 현재 standard addon/built-in replacement 성격이 섞여 있다.
  NexusTerm은 system app이므로 API 호출과 approval UI ownership을 명확히 system
  app 내부로 가져온다.

### Document Viewer

현재 구조:

- UI: `client/src/apps/addons/document-viewer/components/DocumentViewerApp.svelte`
- text search: `client/src/apps/addons/document-viewer/services/textSearch.js`

재사용:

- Markdown/text preview logic
- search highlighting
- unsupported file 안내 패턴

## 6. 제안 파일 구조

```text
client/src/apps/system/nexus-term/
  NexusTerm.svelte
  components/
    NexusHeader.svelte
    NexusTerminalPane.svelte
    NexusExplorerPane.svelte
    NexusViewerPane.svelte
    NexusEditorPane.svelte
    NexusSearchPane.svelte
    NexusAiPanel.svelte
    NexusStatusBar.svelte
    NexusMobileTabs.svelte
    NexusApprovalDialog.svelte
  services/
    terminalSessionClient.js
    workspaceStore.js
    fileTreeService.js
    fileDocumentService.js
    markdownPreview.js
    codeLanguage.js
    searchService.js
    aiContextBuilder.js
  styles/
    nexusTerm.css

server/tests/
  nexus-term-contract.test.js
```

등록 변경:

```text
server/config/builtinAppsSeed.js
client/src/core/appLaunchRegistry.js
client/src/core/i18n/packs/en.json
client/src/core/i18n/packs/ko.json
```

가능하면 backend route를 새로 만들지 않고 기존 `/api/fs`, socket terminal,
`/api/ai`를 사용한다. 새 route는 “현재 workspace summary”처럼 기존 계약으로
표현하기 어려운 기능이 생길 때만 추가한다.

## 7. MVP 범위

### MVP 0 - 기술 분리

목표:

- 기존 Terminal UI에서 session/socket 로직을 추출한다.
- 기존 Terminal 앱 동작을 깨지 않는다.

완료 조건:

- 기존 `terminal` 앱에서 local shell preflight/approval/start/input/resize가
  그대로 동작한다.
- terminal approval tests가 통과한다.

### MVP 1 - NexusTerm system app 등록

목표:

- launcher에서 `NexusTerm` 앱이 열린다.
- 데스크톱 레이아웃의 기본 shell을 보여준다.
- terminal session approval을 기존 Terminal과 같은 수준으로 요구한다.

포함:

- `nexus-term` builtin app seed 추가
- lazy loader 추가
- 기본 header/status bar
- terminal pane

제외:

- AI
- 파일 편집
- 모바일 최적화

### MVP 2 - 폴더 Explorer

목표:

- allowed roots와 initial path를 표시한다.
- 폴더를 열고 파일을 선택한다.
- terminal cwd와 explorer path를 느슨하게 연결한다.

포함:

- `listDir()` 기반 tree/list view
- refresh
- path breadcrumb
- boundary error 표시

제외:

- rename/delete/move/upload
- arbitrary hidden background indexing

### MVP 3 - Markdown/코드 Viewer

목표:

- 선택 파일을 preview pane에서 읽는다.
- Markdown은 preview/source tab을 제공한다.
- 코드/text는 read-only viewer로 시작한다.

포함:

- `.md`, `.markdown`, `.txt`, `.json`, `.js`, `.ts`, `.svelte`, `.css`,
  `.html`, `.sh`, `.py`, `.yml`, `.yaml`, `.log`
- binary/large file 제한 안내
- raw ticket이 필요한 media preview는 후순위

### MVP 4 - 코드 편집과 저장

목표:

- text/code 파일을 편집하고 저장한다.
- overwrite는 user-entered typed confirmation과 scoped approval을 사용한다.

포함:

- dirty state
- save
- reload
- target changed/approval expired/restart recovery UX
- Monaco 또는 기존 Code Editor component/service 재사용

제외:

- multi-file refactor
- git staging/commit UI
- AI patch auto-apply

### MVP 5 - 모바일 레이아웃

목표:

- 같은 기능을 모바일 탭 중심으로 사용할 수 있다.

포함:

- 하단 탭: Terminal / Explorer / Viewer / Search / More
- keyboard-safe terminal viewport
- explorer/viewer bottom sheet 또는 full-screen panel
- 터치 대상 44px 이상
- landscape split view optional

제외:

- desktop과 동일한 3-pane layout 강제

### MVP 6 - AI Vibe Coding Panel

목표:

- AI가 현재 terminal context, 선택 파일, 현재 폴더를 바탕으로 다음 행동을
  제안한다.

1차 AI 기능:

- terminal output 설명
- 명령어 제안
- 파일 변경 계획 제안
- 선택 파일 요약
- 오류 로그에서 원인 후보 추출

강한 제한:

- AI가 명령을 자동 실행하지 않는다.
- AI가 파일을 자동 저장하지 않는다.
- 명령 실행은 사용자가 terminal에 직접 입력하거나 명시 버튼을 눌러야 한다.
- 위험 명령은 별도 confirmation gate를 둔다.

2차 이후:

- patch preview
- apply patch with approval
- command queue with approval
- git diff summary

## 8. 보안/승인 계약

### Terminal session

기존 계약을 유지한다.

```text
preflight -> user typed confirmation -> approve -> terminal:init with approval
```

필수:

- `operationId`
- `nonce`
- `targetHash`
- consume-once
- audit

NexusTerm 전용 UI가 생겨도 backend approval semantics는 바꾸지 않는다.

### Host file write

기존 FS overwrite approval을 사용한다.

```text
preflightOverwrite(path)
-> user typed confirmation
-> approveOverwrite(path, preflight, typedConfirmation)
-> executeOverwrite(path, content, approval)
```

금지:

```js
typedConfirmation: preflight.approval.typedConfirmation
typedConfirmation: expectedConfirmation
approval: { approved: true }
```

### AI safety

AI는 high-risk operation의 주체가 아니다. AI output은 제안이며, 실행 권한은
사용자와 trusted UI/backend approval contract에 있다.

AI가 생성한 항목은 아래처럼 분류한다.

| 유형 | 1차 처리 |
| --- | --- |
| 설명/요약 | 즉시 표시 가능 |
| 명령 제안 | 사용자가 복사/삽입 후 직접 실행 |
| 파일 패치 제안 | diff preview만 표시 |
| 파일 저장 | FS approval 이후 실행 |
| terminal command auto-run | MVP 제외 |

## 9. UX 설계

### Desktop layout

기본:

```text
Header
  left: app identity, workspace path
  center: tabs/session label
  right: search, layout, AI, settings

Main
  left: Terminal pane
  right top: Explorer pane
  right bottom: Viewer/Editor pane

Status
  branch, shell, cwd, selected file, dirty state, approval state
```

레이아웃 규칙:

- terminal pane이 항상 primary다.
- explorer/viewer는 접을 수 있어야 한다.
- split resize는 저장하되 앱 내부 state로 관리한다.
- wide desktop에서는 reference image처럼 2-column + right split을 기본값으로 둔다.

### Mobile layout

기본:

```text
Top bar: NexusTerm, session state, menu
Content: active tab
Bottom tabs: Terminal / Explorer / Viewer / Search / More
Keyboard-aware terminal viewport
```

모바일 규칙:

- 키보드가 열리면 bottom tabs와 terminal scrollback이 겹치지 않는다.
- Explorer와 Viewer는 full-screen tab으로 전환한다.
- Preview/Edit 전환은 segmented control로 둔다.
- destructive/write approval은 full-screen modal로 표시한다.

## 10. 데이터 모델

Client state:

```js
{
  workspaceRoot,
  currentPath,
  selectedFile,
  openDocuments: [],
  activeDocumentId,
  terminalSession: {
    connected,
    approved,
    cwd,
    shell,
    socketId
  },
  layout: {
    mode: 'desktop' | 'mobile',
    activeMobileTab,
    rightPane,
    splitRatio
  },
  ai: {
    contextEnabled,
    selectedContext,
    pendingSuggestion
  }
}
```

Persistence:

- layout preference: system state or local app state after a reviewed storage
  decision
- recent workspace roots: allowed roots only
- terminal output: memory only in MVP
- AI prompts/responses: memory only in MVP unless audit/privacy policy is added

## 11. AI Context 범위

초기 context:

- selected file path
- selected file content, capped
- active folder listing, capped
- recent terminal output, capped
- explicit user prompt

제외:

- entire home directory
- secrets/env files by default
- raw terminal history persistence
- hidden files unless user explicitly includes them

Context builder는 민감 파일 이름을 감지하면 포함 전 사용자 확인을 요구한다.

## 12. 테스트/검증 계획

좁은 검증:

```bash
node --test --test-concurrency=1 server/tests/terminal-approval-contract.test.js
node --test --test-concurrency=1 server/tests/fs-approval-contract.test.js
npm --prefix client run build
```

NexusTerm 추가 후:

```bash
node --check server/services/terminal.js
node --test --test-concurrency=1 server/tests/nexus-term-contract.test.js
npm run verify:ui-smoke
npm --prefix client run build
git diff --check
```

Manual smoke:

1. NexusTerm을 launcher에서 연다.
2. terminal session preflight가 뜨는지 확인한다.
3. wrong typed confirmation이 거절되는지 확인한다.
4. 올바른 typed confirmation 후 shell이 열리는지 확인한다.
5. allowed root 폴더가 표시되는지 확인한다.
6. Markdown 파일을 preview/source로 여는지 확인한다.
7. 코드 파일을 읽고 편집 dirty state가 표시되는지 확인한다.
8. 저장 시 overwrite approval이 뜨는지 확인한다.
9. 모바일 viewport에서 하단 탭과 키보드가 겹치지 않는지 확인한다.
10. AI panel이 명령을 자동 실행하지 않는지 확인한다.

## 13. 개발 순서

1. Terminal session client 추출.
2. 기존 Terminal regression 확인.
3. `nexus-term` system app 등록.
4. desktop shell layout 구현.
5. Explorer read-only pane 구현.
6. Viewer read-only pane 구현.
7. Markdown preview/source 구현.
8. code editor dirty/save/approval 구현.
9. mobile bottom tab layout 구현.
10. search pane 구현.
11. AI context builder와 suggestion panel 구현.
12. smoke gate와 contract test 추가.

## 14. DoD

MVP 완료 기준:

- NexusTerm이 system app으로 등록되어 launcher에서 열린다.
- 실제 local terminal session은 typed confirmation 후에만 시작된다.
- terminal approval nonce는 consume-once이고 target hash scoped다.
- allowed roots 내부 폴더를 탐색할 수 있다.
- Markdown과 주요 text/code 파일을 열 수 있다.
- code/text 파일 저장은 FS overwrite approval을 통과해야 한다.
- 모바일 viewport에서 Terminal/Explorer/Viewer/Search/More 탭이 동작한다.
- AI panel은 suggestion-only이며 명령/파일 변경을 자동 실행하지 않는다.
- `npm --prefix client run build`와 focused contract tests가 통과한다.

## 15. 남은 결정

- NexusTerm이 기존 `terminal` 앱을 대체할지, 별도 앱으로 유지할지.
  - 초기에는 별도 앱으로 유지한다.
- Code Editor component를 직접 재사용할지, editor core만 추출할지.
  - 초기에는 필요한 service/helper를 재사용하고, UI는 NexusTerm에 맞게 작성한다.
- AI provider와 prompt 저장 정책.
  - 초기에는 현재 `/api/ai` 계약을 확인한 뒤 memory-only suggestion으로 둔다.
- git 기능 범위.
  - 초기에는 terminal command와 file read만 사용하고, git UI는 MVP 이후로 둔다.

## 16. Rollback/Safety Notes

- 기존 `terminal` app을 삭제하거나 대체하지 않는다.
- Terminal backend event names는 MVP에서 바꾸지 않는다.
- 기존 File Station APIs의 approval behavior를 완화하지 않는다.
- AI 자동 실행은 feature flag가 있더라도 MVP에서 비활성화한다.
- 문제가 생기면 `nexus-term` app seed/loader만 제거하면 기존 Terminal과 File
  Station은 유지된다.
