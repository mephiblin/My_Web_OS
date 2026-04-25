# My Web OS - User Guide

> 이 문서는 사용자/운영자용 안내서입니다. 개발/에이전트 기준은 `README.md`를 보세요.

My Web OS는 내 PC/홈서버를 브라우저에서 운영하기 위한 Web OS입니다.

> [!WARNING]
> 이 프로젝트는 로컬 파일/터미널/Docker를 직접 다룹니다. 신뢰 가능한 개인 환경에서만 사용하세요.
> `ALLOWED_ROOTS`는 꼭 필요한 경로만 최소로 설정하세요.

## 한 줄 모델

- File Station: 파일을 안전하게 보고 열고 옮기고 공유하는 기본 허브
- Apps: 문서/미디어/코드 같은 작업별 전용 도구
- Web OS: 승인, 권한, 감사, 복구를 관리하는 운영 레이어
- Package Center: 앱 설치/업데이트/실행/백업/롤백을 관리하는 콘솔

## 기능 요약 (기능: 설명)

### 1) 데스크톱

- 윈도우 관리: 앱 창 열기/이동/리사이즈/최소화/최대화/포커스.
- 작업 표시줄: 실행 앱과 빠른 전환 상태를 한 눈에 확인.
- 시작 메뉴/스포트라이트: 앱 검색과 실행을 빠르게 수행.
- 컨텍스트 메뉴: 파일/앱에 맞는 동작을 바로 선택.

### 2) 파일 작업

- File Station: `ALLOWED_ROOTS` 범위 안에서 탐색/생성/수정/삭제.
- Open With: 파일 확장자에 맞는 앱으로 바로 열기.
- 업로드/휴지통/공유: 파일 이동과 복구, 링크 공유를 운영형으로 처리.
- 권한 경계: 앱이 필요한 파일만 다루도록 경로/권한을 제한.

### 3) 원격 컴퓨터 작업

- Terminal: 브라우저에서 실시간 터미널 세션 사용.
- Resource Monitor: CPU/메모리/시스템 상태를 확인.
- Log Viewer: 운영 로그/오류 흐름을 추적.
- Docker Manager: 이미지/컨테이너/로그/포트/볼륨 상태를 점검.

### 4) 패키지/앱 운영

- Package Center: 앱 설치/업데이트/삭제를 중앙에서 관리.
- Runtime/Health: 앱 실행 상태와 오류를 확인.
- Manifest/Quality Gate: 설치 전 유효성 점검으로 문제를 사전 차단.
- Backup/Rollback: 앱 상태를 백업하고 필요 시 롤백.

### 5) 클라우드/전송

- Cloud 연동: `rclone` 기반으로 마운트/업로드/경로 상태를 확인.
- Transfer Manager: 진행/완료/실패 상태를 분리해서 관리.
- 재시도/정리: 실패 작업 재시도, 완료 이력 정리 지원.

### 6) 스테이션 앱 (NAS 스타일)

- Download Station: 다운로드 작업 큐/재시도/취소/필터.
- Photo Station: 사진 라이브러리 검색/그룹/최근 항목.
- Music Station: 오디오 라이브러리 중심 탐색.
- Document Station: 문서 목록/검색/최근 작업 중심 탐색.
- Video Station: 비디오 라이브러리 관리 및 재사용 흐름.

### 7) 보안/하드닝

- Reverse Proxy + TLS: 외부 노출 시 HTTPS 종료 지점 구성.
- Admin Bootstrap: 초기 계정/비밀번호/JWT 설정 경로 제공.
- Allowed Roots 최소권한: 호스트 파일 접근 범위를 최소화.
- Backup/Restore 리허설: 운영 전 복구 절차를 실제로 검증.

## 빠른 실행

필수 권장:

- Node.js 20+ (최소 18)
- cloud 기능 사용 시 `rclone`
- Docker 프로필 사용 시 Docker/Compose

기본 실행:

```bash
npm install
npm run apps:registry:migrate
node server/index.js
```

프론트 개발 서버:

```bash
cd client
npm install
npm run dev
```

접속:

- `http://localhost:5173`

로그인:

- `.env`의 `ADMIN_USERNAME`, `ADMIN_PASSWORD`

## 원격접속 하드닝 시작점

- 가이드: `doc/operations/remote-access-hardening-guide.md`
- 리허설 기록: `doc/operations/backup-restore-rehearsal-2026-04-25.md`

## 현재 알려진 제한

- Cloud 업로드 진행률: provider 최종 반영이 아니라 local stream 기준입니다.
- 대형 번들 로딩: Monaco/Three는 초기 번들에서 분리됐지만 첫 실행 로딩이 큽니다.
- 테스트 실행 방식: 멀티 파일 직접 실행보다 루트 `npm test` 경로가 더 안정적입니다.

## 문서 빠른 길찾기

- 전체 문서 인덱스/상태: `doc/README.md`
- 완료 작업 기록: `doc/operations/completed-backlog-log.md`
- 다음 운영 작업: `doc/operations/next-tasks-2026-04-25.md`
- 개발자/에이전트 기준: `README.md`
