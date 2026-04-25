# Feature Inventory - Home Server And Remote Computer

이 문서는 My Web OS의 기능을 "개인 Home Server & Remote Computer" 관점에서 정리한다.

현재 구현된 기능은 `README.md`, `AGENTS.md`, `doc/operations/completed-backlog-log.md`를 기준으로 정리하고, 앞으로 만들 기능은 `doc/planning/roadmap-home-server-remote-computer.md`, `doc/planning/implementation-priority-plan.md`, 최근 검토 결과를 반영한다.

## 1. 현재 구현된 기능

### 1.1 Web Desktop

- 브라우저 기반 desktop shell.
- window, taskbar, start menu, spotlight search, context menu, widget 계층.
- window/layout 상태 저장.
- system app과 trusted addon 분리.
- lazy-loaded app launch registry.
- Monaco Code Editor와 Three.js Model Viewer 같은 heavy app을 초기 desktop bundle에서 분리.

Home Server / Remote Computer 의미:

- 원격 브라우저에서 로컬 PC를 앱 단위로 조작하는 기본 작업 표면이다.

### 1.2 File Station

- allowed root 기반 파일 탐색.
- 파일/폴더 생성, 읽기, 수정, 삭제 흐름.
- upload, trash, share link, indexed search.
- Open With와 file association 기반 앱 실행.
- single-file grant, read/readwrite launch context 방향.
- Media Library import flow.

Home Server / Remote Computer 의미:

- NAS의 File Station 역할과 원격 PC의 파일 선택/작업 의도를 동시에 담당한다.

### 1.3 Terminal

- Socket.io와 `node-pty` 기반 terminal session.
- session lifecycle과 reconnect/cleanup 흐름.
- 위험 명령 승인 gate 방향.

Home Server / Remote Computer 의미:

- SSH를 대체하거나 보조하는 웹 기반 원격 작업 콘솔이다.

### 1.4 System / Resource / Logs

- system resource summary.
- resource monitor UI.
- Log Viewer.
- audit/event log 저장.
- service/runtime/package 관련 운영 요약.

Home Server / Remote Computer 의미:

- 홈서버의 현재 상태와 장애 단서를 보는 운영 대시보드다.

### 1.5 Docker Operations

- Docker image/log/port/volume/health 관련 UI/API.
- Compose portability baseline.
- backend/frontend healthcheck.
- container log check path.
- host path binding guide.

Home Server / Remote Computer 의미:

- 홈랩 컨테이너 운영을 Web OS 안에서 확인하고 제어하기 위한 기반이다.

### 1.6 Package Center

- registry source management.
- remote package install.
- package import/export.
- manifest editing.
- preflight/quality check/package doctor.
- installed app operation view.
- runtime/lifecycle/health/permission/file association/app data boundary 표시.
- backup job, retention policy, schedule metadata.

Home Server / Remote Computer 의미:

- 개인 서버의 앱 설치/업데이트/백업/롤백 콘솔이며, 앱 제작 작업대의 기반이다.

### 1.7 Sandbox Runtime

- `/api/sandbox/:appId/*` 기반 static sandbox app serving.
- manifest permission.
- app-owned data API.
- sandbox SDK.
- launch context bridge.

Home Server / Remote Computer 의미:

- 작은 개인용 앱을 안전하게 설치하고 실행하기 위한 격리 실행 모델이다.

### 1.8 Cloud / Transfer Jobs

- `rclone` 기반 cloud listing/write/upload/mount status.
- async cloud upload job.
- upload retry/cancel UI.
- Transfer Manager active/completed/failed/canceled job 표시.
- retry와 finished history cleanup.

Home Server / Remote Computer 의미:

- 홈서버와 외부 cloud storage 사이의 전송 작업을 운영 작업으로 다루기 위한 기반이다.

### 1.9 Media / Document / Model Apps

- Media Player playlist/repeat/shuffle/background audio.
- Document Viewer PDF page/zoom/search/metadata.
- Model Viewer wireframe/axes/material info/screenshot.
- Code Editor/Monaco 기반 편집.

Home Server / Remote Computer 의미:

- 원격 파일을 단순 다운로드하지 않고 Web OS 안에서 열람/검토/편집하는 앱 계층이다.

### 1.10 Agent / Automation

- Agent UI.
- `/api/ai/assist` route.
- Docker 관련 host inspection intent/audit gate.
- approval-first action model 방향.

Home Server / Remote Computer 의미:

- 개인 서버 운영 작업을 설명, 승인, 실행, 보고 흐름으로 보조하는 자동화 계층이다.

## 2. 구현 예정 기능

### 2.1 문서/품질/릴리즈 안정화

출처:

- 최근 "충돌, 모순, 치명부분 검토" 결과.
- README 하단 우선순위.
- `AGENTS.md`의 `A11`.

작업:

- A11 Test Isolation And Regression Coverage.
- cloud upload filename leaf validation regression test.
- backup-policy nonexistent app behavior test.
- backup job queued-to-running cancellation race test.
- transfer `error` status normalization test.
- sandbox postMessage payload clone safety test.
- direct multi-file `node --test` isolation 원인 정리.
- untracked AI route/service 파일 추적 여부 확정.
- generated storage file commit policy 정리.
- `doc/operations/next-tasks-2026-04-25.md` 갱신.
- architecture/package reference 문서 최신화.

### 2.2 개인 생산성 앱

출처:

- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/planning/implementation-priority-plan.md`

우선 후보:

- Memo app
- Todo app
- Bookmark Manager
- Clipboard History
- Calculator

목표:

- 작은 앱 생태계의 첫 실사용 사례를 만든다.
- sandbox app data 저장과 Package Center lifecycle을 실제 앱으로 검증한다.
- 앱/위젯 hybrid 구조를 실험한다.

### 2.3 Synology/NAS형 Station 앱

출처:

- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/planning/implementation-priority-plan.md`

후보:

- Download Station
- Photo Station
- Music Station
- Video Station
- Document Station

목표:

- Home Server 정체성을 강화한다.
- File Station, Media Viewer, Document Viewer, Transfer Manager를 상위 앱 경험으로 묶는다.

### 2.4 홈랩 / 운영 앱

출처:

- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/planning/implementation-priority-plan.md`
- 현재 Docker/System/Logs/Package Center 구현

후보:

- Server Monitor
- Log Analyzer
- Backup Manager
- Service Dashboard

목표:

- 운영자용 홈서버 콘솔을 강화한다.
- system, logs, Docker, backup jobs, service routes를 실사용 앱으로 연결한다.

### 2.5 개발자 도구 앱

출처:

- `doc/planning/roadmap-home-server-remote-computer.md`
- `doc/planning/implementation-priority-plan.md`

후보:

- Markdown Preview
- JSON Formatter
- API Tester
- Snippet Vault
- CSV Viewer
- Text Processor

목표:

- Remote Computer로서의 실용성을 높인다.
- Code Editor와 Package Center의 app creation workflow를 확장한다.

### 2.6 Widget / Hybrid Package

후보:

- Clock
- Weather
- CPU usage
- RAM usage
- Disk usage
- Network traffic
- Today Todo
- Recent Memo
- Recent Bookmark
- Music controls

목표:

- desktop dashboard 경험을 강화한다.
- 작은 앱을 app mode와 widget mode로 동시에 제공하는 패키지 모델을 검증한다.

### 2.7 Python / Process Runtime 실험

후보:

- CSV/data analysis tool
- text processor
- simple calculation tool
- educational sample app

원칙:

- 처음부터 강한 서버 실행 권한을 열지 않는다.
- browser-first, limited permission, experimental template 순서로 진행한다.
- process runtime은 lifecycle, logs, permissions, backup, rollback이 Package Center에 보일 때 확장한다.

## 3. 기능 분류 기준

### System App

Host 권한을 직접 다루는 앱.

예:

- File Station
- Terminal
- Settings / Control Panel
- Package Center
- Resource Monitor
- Log Viewer
- Docker Manager
- Transfer Manager

규칙:

- backend route/service 검증 필수.
- 위험 동작은 승인과 audit 필요.
- sandbox app으로 성급히 전환하지 않는다.

### Trusted Addon

Web OS에 번들된 작업 앱.

예:

- Media Player
- Document Viewer
- Model Viewer
- Code Editor
- Widget Store

규칙:

- File Station에서 명시적 launch context를 받아 파일을 연다.
- app logic은 `Desktop.svelte`나 `Window.svelte`에 넣지 않는다.
- 장기적으로 package app으로 옮길 수 있게 manifest-like metadata를 유지한다.

### Package App

Package Center에서 설치/제작/실행/백업/삭제되는 앱.

예:

- Memo
- Todo
- Bookmark
- Photo Station
- JSON Formatter
- API Tester

규칙:

- manifest 기반.
- permissions 명시.
- app-owned data root 사용.
- lifecycle/health/logs/backup/rollback을 Package Center에 노출.

### Widget / Hybrid

Desktop에 작게 올라가는 앱 또는 app mode + widget mode를 모두 가진 패키지.

예:

- clock
- weather
- CPU/RAM/disk/network
- todo/memo/bookmark summary
- music controls

규칙:

- 작고 빠르게 로드되어야 한다.
- 큰 권한을 기본 요구하지 않는다.
- Package Center에서 같은 패키지의 widget capability로 표시한다.
