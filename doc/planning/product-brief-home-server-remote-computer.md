# Product Brief - Personal Home Server And Remote Computer

## 한 줄 정의

My Web OS는 개인이 소유한 PC, 홈서버, 홈랩 장비를 브라우저에서 원격으로 운영하기 위한 개인 단위 Home Server & Remote Computer 플랫폼이다.

## 핵심 골자

이 프로젝트의 중심은 단순한 웹 데스크톱이 아니다.

목표는 집이나 개인 작업 공간에 있는 컴퓨터를 다음처럼 다루는 것이다.

- 원격으로 접속 가능한 개인 컴퓨터
- NAS처럼 파일을 정리하고 공유하는 홈 서버
- Docker, 로그, 서비스, 백업을 관리하는 홈랩 운영 콘솔
- 작은 앱과 위젯을 설치하고 만들어 쓰는 개인 앱 플랫폼
- 위험한 로컬 작업을 승인, 감사, 복구 흐름 안에서 실행하는 브라우저 기반 운영 계층

```text
Home Server = 파일, 미디어, 백업, 서비스, Docker, 로그
Remote Computer = 터미널, 앱 실행, 파일 편집, 시스템 상태, 원격 작업
Web OS = 권한, 승인, 감사, 복구, 패키지 수명주기
Package Center = 앱 설치, 제작, 실행, 업데이트, 백업, 롤백
```

## 왜 필요한가

개인 PC와 홈서버는 보통 기능이 흩어져 있다.

- 파일 관리는 파일 관리자나 NAS UI에서 한다.
- 터미널 작업은 SSH로 한다.
- Docker 관리는 별도 대시보드나 CLI에서 한다.
- 로그 확인, 백업, 미디어 관리, 문서 열람은 각각 다른 도구를 쓴다.
- 작은 개인용 도구를 만들면 배포, 실행, 백업, 권한 관리가 정리되지 않는다.

My Web OS는 이 흐름을 하나의 브라우저 기반 운영 표면으로 묶는다.

## 대상 사용자

1. 개인 홈서버 사용자
   - 사진, 문서, 다운로드, 백업, 미디어를 집 서버에 보관한다.
   - 외부에서도 브라우저로 파일과 서비스를 확인하고 싶다.

2. 홈랩 운영자
   - Docker, 서비스, 로그, 시스템 상태를 자주 본다.
   - 작은 내부 도구와 대시보드를 직접 만들어 쓴다.

3. 원격 작업용 개인 PC 사용자
   - 집이나 작업실 PC의 파일, 터미널, 코드, 문서를 원격에서 다룬다.
   - 무조건 SSH/원격 데스크톱만 쓰기보다, 웹 기반 작업 콘솔을 원한다.

4. 개인 앱 제작자
   - 메모, 할 일, 북마크, 미디어 관리, 개발 도구 같은 작은 앱을 직접 만들고 싶다.
   - Package Center에서 생성, 수정, 실행, 내보내기, 백업까지 관리하고 싶다.

## 제품 원칙

### 1. 개인 단위 우선

이 프로젝트는 기업용 멀티테넌트 SaaS가 아니다. 기본 단위는 한 명의 소유자 또는 신뢰 가능한 작은 가정/작업 공간이다.

향후 다중 사용자나 RBAC가 들어오더라도, 출발점은 "내 장비를 내가 안전하게 원격 운영한다"이다.

### 2. Host 경계는 명시적이어야 한다

파일 시스템, 터미널, Docker, 서비스 제어는 실제 장비에 영향을 준다.

따라서 다음은 기본값이어야 한다.

- allowed root 기반 파일 접근
- 위험 명령 승인
- overwrite/delete/rollback 승인
- audit log
- 실패 복구와 명시적 오류 코드
- package/app 권한 선언

### 3. Package Center는 앱 스토어가 아니라 운영 콘솔이다

Package Center는 설치 버튼만 있는 화면이 아니다.

설치된 앱에 대해 다음을 보여주고 제어해야 한다.

- manifest
- 권한
- runtime
- lifecycle
- health
- logs
- app data boundary
- backup
- rollback
- update/preflight

### 4. 앱은 독립적이어야 한다

Desktop과 Window는 운영 표면이다. 기능 로직은 앱, store, service, API helper에 둔다.

작은 도구는 Package Center에서 만들고 실행할 수 있어야 하며, 장기적으로 앱/위젯/서비스가 같은 패키지 체계 안에서 관리되어야 한다.

### 5. Synology/NAS 느낌은 방향성이고, Web OS가 차별점이다

Photo Station, Music Station, Download Station, Backup Manager 같은 NAS형 앱은 중요한 확장 방향이다.

다만 이 프로젝트의 차별점은 NAS 앱 목록이 아니라, 로컬 PC 운영 기능과 앱 제작/설치/권한/감사/복구를 하나의 Web OS 경험으로 묶는 것이다.

## 현재 구현 기반

현재 구현된 기반은 다음 문서에서 확인한다.

- `README.md`
- `AGENTS.md`
- `doc/operations/completed-backlog-log.md`
- `doc/reference/architecture-api-reference.md`
- `doc/reference/app-development-model.md`
- `doc/reference/package-ecosystem-guide.md`

현 시점의 핵심 구현 축:

- Web Desktop
- File Station
- Terminal
- Resource/Log/Docker operations
- Package Center
- Sandbox Runtime
- Cloud/Transfer jobs
- Media/Document/Model viewers
- Backup jobs/policy metadata
- Agent/AI assist
- Docker portability

## 제품 비전

최종 비전은 개인 장비를 위한 브라우저 기반 운영체제 계층이다.

```text
내 PC/홈서버에 접속한다.
파일을 관리한다.
터미널과 Docker를 조작한다.
서비스 상태와 로그를 본다.
백업과 복구를 관리한다.
필요한 작은 앱을 설치하거나 직접 만든다.
모든 위험한 동작은 권한, 승인, 감사, 복구 흐름을 가진다.
```

## 성공 기준

단기 성공:

- 원격 브라우저에서 파일, 터미널, Docker, 로그, 패키지 상태를 한 곳에서 확인한다.
- Package Center에서 작은 sandbox app을 만들고 실행하고 백업할 수 있다.
- 위험 동작은 명시적으로 승인되고 audit log에 남는다.

중기 성공:

- Memo, Todo, Bookmark, Download Station, Photo/Music/Document Station 같은 개인용 앱이 패키지로 관리된다.
- 파일, 미디어, 백업, 서비스 상태가 홈서버 운영 흐름으로 연결된다.
- 원격 접속을 전제로 보안, 세션, 감사, 복구 흐름이 강화된다.

장기 성공:

- My Web OS가 개인 PC/홈서버의 주 운영 화면이 된다.
- 사용자는 CLI, SSH, 개별 NAS 앱, 개별 Docker UI를 오가지 않고도 대부분의 개인 서버 운영을 처리할 수 있다.
- 앱 제작, 설치, 실행, 백업, 롤백이 하나의 패키지 생태계 안에서 돌아간다.

