# Package Center Redesign Plan

상태: `[DRAFT]`
작성일: `2026-04-28`
소유 문서: `Addon_Dev_Help/package center/Package_Center_Redesign_Plan_KO.md`
참조 이미지: `Addon_Dev_Help/package center/package center.png`

## Summary

Package Center 리뉴얼의 핵심 방향은 단순한 패키지 목록 UI가 아니라
`설치/업데이트/가져오기/내보내기/삭제/런타임 상태`를 한 화면에서 검토하는
신뢰된 운영 콘솔로 만드는 것이다.

참조 이미지는 다음 구조를 제안한다.

```text
Top command bar
  -> Library/category sidebar
  -> Installed/store package list
  -> Selected package detail workspace
```

MVP 리뉴얼은 기존 Package Center의 API와 lifecycle approval 계약을 유지하면서,
설치된 패키지를 중심으로 `3-pane desktop layout`을 먼저 정리한다. 이후 Store,
Updates, ZIP import, registry source, runtime ops, backup/rollback을 같은 시각
언어로 합류시킨다.

구현 원칙:

- `client/src/apps/system/package-center/PackageCenter.svelte`의 기존 기능 계약을
  보존한다.
- 설치/업데이트/삭제/rollback/manifest update는 반드시 기존 preflight,
  typed confirmation, scoped approval, consume-once nonce 흐름을 유지한다.
- UI 리뉴얼은 component extraction과 CSS 정리로 진행하고, backend route 변경은
  MVP 범위에서 제외한다.
- `Desktop.svelte`, `Window.svelte` 같은 core window orchestration 파일에는 기능
  코드를 추가하지 않는다.

## Image Analysis

### Layout

스크린샷은 전체 창을 Package Center 전용 운영 화면으로 사용한다. 화면은 크게
상단 command bar, 좌측 library sidebar, 중앙 package list, 우측 detail panel,
하단 status bar로 나뉜다.

```text
┌────────────────────────────────────────────────────────────────────┐
│ App title | view/sort/filter/search | refresh/import/more/window    │
├──────────────┬──────────────────────┬──────────────────────────────┤
│ Library      │ Installed list        │ Selected package detail       │
│ Categories   │ package cards         │ header/actions/tabs/content   │
│ Summary card │ footer count          │ metadata cards                │
├──────────────┴──────────────────────┴──────────────────────────────┤
│ global status                                         last refresh  │
└────────────────────────────────────────────────────────────────────┘
```

시각적 비율은 대략 다음과 같다.

- 상단 command bar: 64px 내외, 전체 기능의 진입점.
- 좌측 sidebar: 250px 내외, Library와 Categories를 고정 노출.
- 중앙 list pane: 340px 내외, 현재 필터에 해당하는 패키지 카드 목록.
- 우측 detail pane: 남은 전체 폭, 선택 패키지의 운영/정보 영역.
- 하단 status bar: 36px 내외, 업데이트 상태와 마지막 새로고침 시각.

좌측 navigation과 중앙 package list가 분리되어 있어, 사용자는 먼저 범주를 고르고
그 안에서 패키지를 선택한 뒤, 우측에서 세부 작업을 수행한다.

### Information Structure

정보 구조는 `탐색 -> 선택 -> 검토 -> 실행` 흐름이다.

좌측 Library:

- `Store`: 설치 가능한 패키지 탐색.
- `Installed`: 설치된 패키지 관리. 스크린샷에서는 선택 상태이고 count `5` 표시.
- `Updates`: 업데이트 가능한 패키지. count `0` 표시.

좌측 Categories:

- `All`
- `Applications`
- `Tools`
- `Libraries`
- `Samples`

중앙 package list:

- 상단에 현재 결과 수 `5 Installed Packages`.
- 우측에 빠른 refresh icon.
- 각 row는 icon, title, package id, version을 포함.
- 선택된 row는 파란 gradient 배경으로 강조.
- 하단에 `Showing 5 of 5 packages` 같은 결과 summary.

우측 detail workspace:

- Header:
  - 큰 app icon.
  - package title.
  - package id와 version.
  - installed badge.
  - release channel.
  - primary action `Open`.
  - secondary action `Check for Updates`.
  - destructive action `Remove`.
  - utility action `Export`.
- Tabs:
  - `Overview`
  - `Details`
  - `Dependencies`
  - `Widget (1)`
  - `Files`
- Overview content:
  - package 설명.
  - screenshot/preview.
  - 주요 metadata table.
  - Version, Compatibility, Dependencies, Widgets summary cards.

이 구조는 현재 Package Center가 가진 package lifecycle 정보, runtime status, backup,
rollback, widget contribution, file contribution을 한 화면 안에서 단계적으로
노출하기 좋다.

### Visual Design

전체 스타일은 dark glass operations console이다. 단순한 dark mode가 아니라, 여러
panel이 얕은 깊이감과 투명도를 갖고 겹쳐진다.

관찰된 디자인 요소:

- 배경은 navy/near-black gradient.
- panel은 투명도가 있는 어두운 surface와 1px hairline border.
- 선택 상태는 saturated blue gradient와 left-to-right glow.
- primary action은 bright blue button.
- destructive action은 red tinted button.
- 성공 상태는 green check badge.
- inactive text는 slate/blue-gray 계열.
- 아이콘은 line icon 중심이며, 버튼과 navigation의 의미를 빠르게 전달한다.
- card radius는 8px에서 14px 사이로 보이며, 과도하게 둥글지 않다.
- detail panel은 list/sidebar보다 살짝 높은 elevation을 가진다.

### Interaction

스크린샷에서 추론되는 상호작용:

- 상단 `Installed` dropdown으로 view mode를 바꾼다.
- `Sort: Name` dropdown으로 정렬 기준을 바꾼다.
- `Filters` dropdown으로 runtime/type/channel/update 상태를 거른다.
- 검색창은 현재 view/list 전체에 즉시 적용된다.
- 좌측 Library item을 클릭하면 Store/Installed/Updates 화면으로 전환된다.
- Categories를 클릭하면 package type/category filter가 적용된다.
- 중앙 package row를 클릭하면 우측 detail panel이 갱신된다.
- 우측 tab을 클릭하면 선택 package의 세부 영역이 교체된다.
- `Open`은 실행 가능한 app/package를 연다.
- `Check for Updates`는 registry/update preflight 또는 update check를 시작한다.
- `Remove`는 삭제 preflight와 typed confirmation modal을 열어야 한다.
- `Export`는 export ticket/download 흐름을 사용한다.
- `Refresh`는 설치 목록, registry 목록, runtime status를 현재 view 기준으로 다시
  불러온다.
- 하단 status는 전역 업데이트 상태와 마지막 refresh 시각을 보여준다.

## Product Goals

### Goals

- Package Center를 `store + installed operations console + app workshop`의 기반
  화면으로 정리한다.
- 설치된 패키지를 한 번 선택하면 실행, 업데이트, 삭제, export, widget, files,
  dependencies, compatibility, runtime 상태를 같은 detail workspace에서 확인하게
  한다.
- package lifecycle preflight와 approval이 눈에 잘 띄도록 한다.
- 위험 권한, runtime process, network, allowed roots, backup/rollback 영향을
  install/update/delete 전에 명확히 노출한다.
- developer/operator가 많은 패키지를 빠르게 찾고 상태를 파악할 수 있게 검색,
  정렬, 필터, count, status chip을 일관화한다.
- desktop에서는 3-pane productivity layout을 제공하고, tablet/mobile에서는 panes를
  tabs/sheets로 접는다.

### Non-Goals

- Package Center backend route나 approval contract를 새로 설계하지 않는다.
- 기존 `/api/packages/*` endpoint를 우회하는 임시 UI path를 만들지 않는다.
- typed confirmation expected value를 프론트가 자동 복사하거나 자동 입력하지
  않는다.
- package install/update/delete/rollback을 browser-only confirmation으로 처리하지
  않는다.
- Store registry, ZIP import, wizard, runtime logs 등 모든 기존 기능을 한 번에
  재작성하지 않는다.

## IA/Layout

### Desktop IA

권장 desktop 구조:

```text
PackageCenterShell
├─ PackageCommandBar
│  ├─ AppIdentity
│  ├─ ViewSelector
│  ├─ SortSelector
│  ├─ FilterMenu
│  ├─ PackageSearch
│  └─ GlobalActions
├─ PackageWorkspace
│  ├─ PackageSidebar
│  │  ├─ LibraryNav
│  │  ├─ CategoryNav
│  │  └─ InstalledSummaryCard
│  ├─ PackageListPane
│  │  ├─ PackageListHeader
│  │  ├─ PackageList
│  │  └─ PackageListFooter
│  └─ PackageDetailPane
│     ├─ PackageHero
│     ├─ PackageDetailTabs
│     └─ PackageDetailContent
└─ PackageStatusBar
```

현재 구현이 단일 Svelte 파일에 큰 기능을 갖고 있으므로, 리뉴얼은 한 번에 파일을
분해하기보다 다음 순서로 component boundary를 만든다.

1. CSS token과 layout shell을 먼저 정리한다.
2. 기존 state/API 함수는 유지한 채 markup만 shell/sidebar/list/detail 영역으로
   묶는다.
3. 안정화 후 `components/PackageCommandBar.svelte`,
   `components/PackageSidebar.svelte`, `components/PackageListPane.svelte`,
   `components/PackageDetailPane.svelte`로 추출한다.
4. approval modal, preflight review, runtime log viewer처럼 위험도가 높은 기능은
   기존 동작을 보존한 뒤 마지막에 시각만 맞춘다.

### View Model

UI state는 다음 기준으로 나눈다.

```js
const viewState = {
  section: 'installed', // store | installed | updates
  category: 'all',
  query: '',
  sort: 'name',
  filters: {
    type: 'all',
    runtime: 'all',
    channel: 'all',
    status: 'all'
  },
  selectedPackageId: null,
  detailTab: 'overview'
};
```

기존 변수명을 바로 바꾸기보다, 먼저 derived helper를 만들어 현재 변수와 새 IA를
연결한다.

권장 derived helpers:

- `getActivePackageRows()`
- `getPackageCategoryCounts()`
- `getVisiblePackageCountLabel()`
- `getSelectedPackage()`
- `getPackageStatusChips(pkg)`
- `getPackagePrimaryActions(pkg)`
- `getPackageDangerActions(pkg)`
- `getPackageMetadataRows(pkg)`
- `getPackageOverviewCards(pkg)`

### Detail Tabs

권장 tab 정보:

- `Overview`: 설명, preview, 핵심 metadata, summary cards.
- `Details`: manifest, permissions, runtime profile, data boundary,
  fileAssociations.
- `Dependencies`: dependency/compatibility/preflight 상태.
- `Widgets`: package widget contribution과 Widget Store 연결.
- `Files`: package root file list, manifest file, export/import 관련 정보.
- `Ops`: service package일 때만 start/stop/restart/logs/events/health/backup/rollback
  quick actions를 노출한다.

스크린샷에는 `Ops` tab이 보이지 않지만 현재 프로젝트 기준에서는 managed package
운영 콘솔이 필요하므로, MVP 이후 hidden/conditional tab으로 추가하는 것이 좋다.

### Mobile IA

1000px 이하에서는 desktop 3-pane을 그대로 세로로 쌓지 말고, 작업 단계를 탭으로
접는다.

```text
MobilePackageCenter
├─ Top search/action bar
├─ Segment: Store | Installed | Updates
├─ Active panel
│  ├─ Browse
│  ├─ List
│  └─ Detail
└─ Bottom tabs: Browse | Packages | Detail | Ops | More
```

모바일 원칙:

- approval modal은 화면 밖으로 밀리지 않아야 한다.
- typed confirmation 문구, 입력 필드, 위험 summary, approve/cancel 버튼이 한
  viewport 안에 보여야 한다.
- destructive action은 bottom sheet의 맨 아래가 아니라 별도 danger zone에 둔다.
- package list row는 최소 44px 이상 touch target을 유지한다.

## Interaction Design

### Navigation

- `LibraryNav`는 Store, Installed, Updates 사이를 전환한다.
- 선택된 section은 sidebar와 command bar selector에 동시에 반영한다.
- `CategoryNav`는 현재 section 안에서만 category filter로 동작한다.
- Store와 Installed가 서로 다른 category count를 갖는 경우 count는 현재 section
  기준으로 계산한다.

### Search, Sort, Filters

- 검색은 title, id, description, publisher, category를 대상으로 한다.
- 검색어가 있으면 list header에 `Showing n of m packages`를 표시한다.
- sort 후보:
  - `Name`
  - `Updated`
  - `Installed date`
  - `Size`
  - `Status`
- filter 후보:
  - `Type`: app, widget, library, tool, service.
  - `Runtime`: sandbox, process-node, process-python, binary, static.
  - `Channel`: stable, beta, local/dev.
  - `Status`: installed, update available, blocked, degraded, running, stopped.

### Package Selection

- list에서 package row를 선택하면 detail panel이 즉시 갱신된다.
- 선택 package가 필터 결과에서 사라지면 첫 번째 visible row를 선택하거나 empty
  detail state를 보여준다.
- detail panel header는 선택 package의 상태와 주요 action을 항상 유지한다.

### Actions

Primary actions:

- `Open`: 실행 가능한 app/package를 연다.
- `Install`: Store package install preflight를 연다.
- `Update`: update preflight를 연다.

Secondary actions:

- `Check for Updates`
- `Export`
- `Backup`
- `View Logs`
- `Open Widget Store`

Danger actions:

- `Remove`
- `Rollback`
- `Force policy bypass`

Danger action 규칙:

- 항상 preflight 결과를 먼저 보여준다.
- typed confirmation은 사용자가 직접 입력해야 한다.
- `approval: { approved: true }` 같은 legacy shortcut은 사용하지 않는다.
- backend가 반환한 `operationId`, `nonce`, `targetHash`를 execute 단계에서만 사용한다.
- approval failure, expired nonce, target changed, blocked policy는 recoverable state로
  보여준다.

### Empty, Loading, Error States

각 pane은 자체 상태를 가져야 한다.

- Sidebar count loading: skeleton 또는 muted count.
- List loading: 5개 row skeleton.
- Detail empty: `Select a package to inspect operations and metadata.`
- Store empty: source 연결 또는 ZIP import CTA.
- Updates empty: `All packages are up to date.`
- Error: `{ code, message, details }`가 있으면 code를 badge로 표시하고 retry action을
  제공한다.

## Visual Direction

### Design Language

방향성은 `Midnight Operations Console`이다.

- 어두운 navy background 위에 glass panel을 배치한다.
- blue는 선택/primary action에만 강하게 사용한다.
- green은 정상/installed/healthy, amber는 warning/update, red는 destructive/error에
  제한한다.
- 정보 card는 dense하지만 압박감이 없도록 여백과 line-height를 충분히 둔다.

### CSS Token Direction

`PackageCenter.svelte` 내부 style 또는 `package-center.css` 분리 시 다음 token을
기준으로 맞춘다.

```css
:global(.package-center) {
  --pc-bg-0: #070b12;
  --pc-bg-1: #0b1120;
  --pc-bg-2: #111827;
  --pc-surface: rgba(15, 23, 42, 0.78);
  --pc-surface-strong: rgba(15, 23, 42, 0.92);
  --pc-surface-soft: rgba(30, 41, 59, 0.44);
  --pc-border: rgba(148, 163, 184, 0.16);
  --pc-border-strong: rgba(148, 163, 184, 0.28);
  --pc-text: #e5edf7;
  --pc-muted: #94a3b8;
  --pc-dim: #64748b;
  --pc-primary: #3b82f6;
  --pc-primary-strong: #60a5fa;
  --pc-success: #22c55e;
  --pc-warning: #f59e0b;
  --pc-danger: #ef4444;
  --pc-radius-sm: 8px;
  --pc-radius-md: 12px;
  --pc-radius-lg: 16px;
  --pc-shadow-panel: 0 18px 50px rgba(2, 6, 23, 0.35);
}
```

### Layout CSS Direction

Desktop shell:

```css
.package-center {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: 64px minmax(0, 1fr) 36px;
  color: var(--pc-text);
  background:
    radial-gradient(circle at 20% 0%, rgba(59, 130, 246, 0.18), transparent 32%),
    linear-gradient(180deg, var(--pc-bg-2), var(--pc-bg-0));
  overflow: hidden;
}

.pc-workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: 250px 340px minmax(0, 1fr);
  border-top: 1px solid var(--pc-border);
}

.pc-sidebar,
.pc-list-pane,
.pc-detail-pane {
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--pc-border);
}

.pc-detail-scroll {
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
```

Panel/card style:

```css
.pc-panel {
  border: 1px solid var(--pc-border);
  border-radius: var(--pc-radius-md);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(8, 13, 22, 0.82));
  box-shadow: var(--pc-shadow-panel);
}

.pc-package-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 78px;
  padding: 12px 14px;
  border-radius: var(--pc-radius-sm);
}

.pc-package-row.is-selected {
  background:
    linear-gradient(90deg, rgba(37, 99, 235, 0.45), rgba(30, 64, 175, 0.18)),
    rgba(15, 23, 42, 0.64);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.24);
}
```

Action buttons:

```css
.pc-btn {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--pc-border);
  border-radius: var(--pc-radius-sm);
  color: var(--pc-text);
  background: rgba(15, 23, 42, 0.72);
}

.pc-btn.primary {
  border-color: rgba(96, 165, 250, 0.56);
  background: linear-gradient(180deg, #2563eb, #1d4ed8);
}

.pc-btn.danger {
  border-color: rgba(248, 113, 113, 0.34);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.34);
}
```

### Component Direction

초기 추출 후보:

```text
client/src/apps/system/package-center/
├─ PackageCenter.svelte
├─ api.js
├─ components/
│  ├─ PackageCommandBar.svelte
│  ├─ PackageSidebar.svelte
│  ├─ PackageListPane.svelte
│  ├─ PackageListRow.svelte
│  ├─ PackageDetailPane.svelte
│  ├─ PackageHero.svelte
│  ├─ PackageTabs.svelte
│  ├─ PackageMetadataGrid.svelte
│  ├─ PackagePreflightReview.svelte
│  └─ PackageApprovalDialog.svelte
└─ packageCenterViewModel.js
```

컴포넌트 추출 시 주의:

- approval 실행 함수는 추출하더라도 expected confirmation 값을 자동 주입하지 않는다.
- API helper는 `api.js`의 기존 함수들을 우선 재사용한다.
- package row/detail rendering만 먼저 component화하고 lifecycle mutation 로직은
  충분히 테스트한 뒤 이동한다.
- 기존 store/source/zip/wizard 기능은 desktop shell 안의 utility panel로 유지하다가
  후속 slice에서 시각을 맞춘다.

## Implementation Slices

### P0 - Planning And Safety Baseline

In scope:

- 현재 Package Center 기능, API helper, approval flow를 inventory화한다.
- 스크린샷 기반 IA를 현재 state 변수와 매핑한다.
- 위험 action 목록을 정리한다.

DoD:

- 기존 install/update/delete/rollback/manifest update typed confirmation 흐름이
  어떤 함수에 있는지 확인된다.
- UI 리뉴얼 중 변경 금지 contract가 issue/plan에 명시된다.

Verification:

```bash
rg -n "typedConfirmation|approved: true|operationId|nonce|targetHash" client/src/apps/system/package-center server/routes/packages.js
node --check server/routes/packages.js
```

### P1 - Desktop Shell And Visual Tokens

In scope:

- `PackageCenter.svelte` root layout을 `command bar / workspace / status bar`로
  재배치한다.
- CSS token을 추가하고 기존 class와 충돌 없이 점진 적용한다.
- 기존 Store/Installed 화면 전환은 유지한다.

Out of scope:

- approval modal 동작 변경.
- API call 변경.
- component 대규모 추출.

User-visible outcome:

- Package Center가 스크린샷처럼 상단 command bar와 3-pane shell을 갖는다.

Verification:

```bash
npm --prefix client run build
git diff --check
```

### P2 - Sidebar And Package List Renewal

In scope:

- Library nav, category counts, installed summary card를 sidebar로 정리한다.
- package list row를 icon/title/id/version/status 중심으로 재구성한다.
- selected state, hover, keyboard focus style을 추가한다.
- search/sort/filter가 list 결과와 count에 반영되게 한다.

Out of scope:

- Store card 디자인 전면 재작성.
- runtime logs/detail tab 재작성.

User-visible outcome:

- 설치된 패키지 5개 같은 목록이 스크린샷처럼 명확한 row selection UX를 갖는다.

Verification:

```bash
npm --prefix client run build
npm run verify:ui-smoke
```

### P3 - Detail Hero And Overview Tab

In scope:

- 선택 package detail header를 screenshot형 hero로 만든다.
- Open, Check for Updates, Remove, Export action 배치를 정리한다.
- Overview tab에 description, preview, metadata table, summary cards를 배치한다.
- installed/healthy/update/degraded 상태 chip을 통일한다.

Out of scope:

- 실제 update/delete approval contract 변경.
- preview image 생성 backend 추가.

User-visible outcome:

- 선택한 패키지의 핵심 정보와 작업 버튼이 우측 detail panel에 고정적으로 보인다.

Verification:

```bash
npm --prefix client run build
git diff --check
```

### P4 - Details, Dependencies, Widgets, Files Tabs

In scope:

- 기존 manifest/details/dependencies/widgets/files 정보를 tab별로 재배치한다.
- dependency 없음, widget 있음, file list unavailable 같은 상태를 명확히 표시한다.
- `Widget (n)` count를 tab label에 반영한다.

Out of scope:

- 새로운 widget API 추가.
- file mutation 기능 추가.

User-visible outcome:

- Overview가 과밀해지지 않고, 개발자/운영자가 필요한 정보를 tab에서 찾을 수 있다.

Verification:

```bash
npm --prefix client run build
npm run verify:ui-smoke
```

### P5 - Lifecycle Approval Surface Polish

In scope:

- install/update/remove/rollback/manifest update preflight review를 새 visual language에
  맞춘다.
- 위험 권한, runtime process, backup/rollback 영향, blockers, warnings를 구분한다.
- typed confirmation input과 approve button의 모바일 가시성을 보장한다.

Out of scope:

- backend approval model 변경.
- force bypass 정책 변경.

User-visible outcome:

- 위험 작업 전에 무엇이 바뀌는지 더 명확히 보이고, 사용자가 직접 확인 문구를
  입력해야만 실행된다.

Verification:

```bash
rg -n "typedConfirmation: .*expectedConfirmation|typedConfirmation: .*preflight\\?\\.approval|approved: true" client/src/apps/system/package-center
npm --prefix client run build
npm run verify:ui-smoke
```

### P6 - Store, Import, Updates Alignment

In scope:

- Store source, registry packages, ZIP import, wizard/scaffold panels를 새 shell의
  utility/action panel로 맞춘다.
- Updates empty state와 update candidate state를 command bar/filter와 연결한다.
- Import flow는 preflight review를 먼저 보여주고 approve/install 단계로 이어진다.

Out of scope:

- registry protocol 변경.
- package template schema 변경.

User-visible outcome:

- Installed 화면뿐 아니라 Store/Updates/Import도 같은 navigation과 action language를
  사용한다.

Verification:

```bash
npm --prefix client run build
npm run verify:packages
npm run verify:ui-smoke
```

### P7 - Responsive And Accessibility Pass

In scope:

- 1280px, 1000px, 720px 이하 breakpoints를 정리한다.
- keyboard navigation, focus-visible, aria-label, aria-selected, aria-controls를
  보강한다.
- touch target과 approval modal viewport fit을 확인한다.

Out of scope:

- native mobile packaging.
- gesture-heavy custom navigation.

User-visible outcome:

- 좁은 창과 모바일에서도 package selection, detail, approval이 숨겨지지 않는다.

Verification:

```bash
npm --prefix client run build
npm run verify:ui-smoke
```

## Acceptance Criteria

- Package Center는 desktop에서 `command bar + sidebar + list pane + detail pane +
  status bar` 구조로 보인다.
- 기존 Store, Installed, Updates 전환이 동작한다.
- package search, sort, filter 결과와 count가 일관되게 표시된다.
- list row 선택 시 detail header와 tab content가 선택 package 기준으로 갱신된다.
- detail hero는 title, id, version, status, channel, primary/secondary/danger actions를
  노출한다.
- Overview tab은 description, preview, metadata, version, compatibility,
  dependencies, widgets summary를 제공한다.
- Details/Dependencies/Widgets/Files tab은 기존 데이터가 없는 경우에도 명확한 empty
  state를 보여준다.
- install/update/delete/rollback/manifest update는 기존 preflight와 typed
  confirmation을 유지한다.
- 프론트엔드는 expected typed confirmation을 approval request에 자동 복사하지
  않는다.
- `approval: { approved: true }` 패턴을 새로 추가하지 않는다.
- backend가 structured error를 반환하면 UI가 `code`, `message`, `details`를 가능한
  범위에서 표시한다.
- mobile/narrow layout에서 approval summary, typed input, cancel/approve button이
  화면 밖으로 밀리지 않는다.
- 기존 `package-center` system app registration과 launch contract가 유지된다.
- `npm --prefix client run build`가 통과한다.
- UI smoke가 Package Center launch와 기본 installed package 표시를 확인한다.

## Verification Plan

가장 좁은 검증부터 실행한다.

```bash
git status --short
git diff --check
npm --prefix client run build
```

approval/lifecycle UI를 건드린 경우:

```bash
rg -n "typedConfirmation: .*expectedConfirmation|typedConfirmation: .*preflight\\?\\.approval|approved: true" client/src/apps/system/package-center
node --check server/routes/packages.js
npm run verify:packages
```

Store/import/registry flow를 건드린 경우:

```bash
npm run verify:packages
npm run verify:ui-smoke
```

공유 contract나 route 변경이 포함된 경우:

```bash
npm test
npm run verify
```

수동 확인 체크리스트:

- Package Center가 Desktop/Start/Spotlight에서 열린다.
- Installed count와 package list가 표시된다.
- package를 클릭하면 detail panel이 갱신된다.
- Open 가능한 package는 `Open` 버튼이 보인다.
- update/delete/import 같은 위험 작업은 preflight review 후 typed confirmation을
  요구한다.
- 잘못된 typed confirmation은 실행 버튼을 비활성화하거나 backend에서 거절된다.
- Updates가 없으면 `All packages are up to date` 상태가 보인다.
- ZIP import와 Export는 기존 ticket/download 흐름을 깨지 않는다.
- 1000px 이하 화면에서 list/detail 전환과 approval modal이 읽을 수 있다.

## Risks/Rollback

### Risks

- 현재 `PackageCenter.svelte`가 많은 기능을 가진 큰 컴포넌트라, markup 리뉴얼 중
  lifecycle mutation 함수가 의도치 않게 깨질 수 있다.
- Store, ZIP import, wizard, runtime ops, backup/rollback이 같은 화면에 있어 한 번에
  리뉴얼하면 회귀 범위가 커진다.
- 시각 리뉴얼 중 danger action이 primary action과 가까워지면 삭제/rollback 오작동
  위험이 커진다.
- 모바일에서 approval modal이 화면 밖으로 밀리면 typed confirmation 계약이
  실사용에서 약해진다.
- preview/screenshot 영역을 새로 넣을 때 package icon 또는 remote image URL 처리
  정책이 불명확하면 broken image나 외부 요청 문제가 생길 수 있다.
- filter/sort state가 Store와 Installed 사이에서 공유되면 사용자가 빈 결과를 오류로
  오해할 수 있다.

### Rollback

- P1 shell 리뉴얼이 불안정하면 CSS/layout 변경만 되돌리고 기존 Package Center
  markup을 유지한다.
- P2 list renewal이 문제를 만들면 list row component extraction만 되돌리고 기존
  package selection state를 유지한다.
- P3 detail hero가 action 회귀를 만들면 action button 배치는 기존 구현으로 되돌리고
  metadata card만 유지한다.
- P5 approval polish에서 문제가 발생하면 즉시 기존 approval/preflight UI로 되돌린다.
- backend route나 approval contract는 MVP 리뉴얼에서 변경하지 않으므로, UI rollback만
  으로 안전하게 복구 가능해야 한다.

### Safety Notes

- Package Center는 system app이며 package lifecycle authority를 갖는다.
- UI 리뉴얼은 신뢰 경계를 약화시키면 안 된다.
- 모든 destructive/lifecycle 작업은 backend preflight와 approval evidence를 통해
  실행되어야 한다.
- package runtime, permissions, network, allowed roots, backup/rollback 영향은 숨기지
  말고 더 잘 보이게 만드는 것이 리뉴얼의 핵심이다.
