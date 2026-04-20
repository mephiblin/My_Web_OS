# My_Web_OS AI Reference

이 문서는 사람용 소개 문서가 아니라, **AI/에이전트가 현재 프로젝트를 빠르게 이해하고 수정 작업에 바로 들어가기 위한 기술 레퍼런스**입니다.

목표:
- 현재 구현 범위를 요약한다.
- 실제 디렉토리 구조와 핵심 파일을 안내한다.
- 서버 서비스, 상태 저장 방식, 인증 구조를 설명한다.
- 사용 가능한 API와 엔드포인트를 한눈에 정리한다.
- 새 앱이나 기능을 추가할 때 어디를 수정해야 하는지 알려준다.

---

## 1. 프로젝트 한 줄 요약

`My_Web_OS`는 Svelte 프론트엔드와 Express/Socket.io 백엔드를 기반으로, 로컬 PC의 파일 시스템, 터미널, 리소스 모니터링, 로그, 설정, 미디어 뷰어, 패키지형 샌드박스 앱을 웹 데스크톱 UI로 묶은 프로젝트다.

핵심 성격:
- 웹 브라우저에서 실행되는 데스크톱형 UI
- 로컬 시스템과 직접 연결되는 관리 콘솔
- 파일 기반 영속화(JSON, 로그, 인벤토리)
- 기본 앱 + 샌드박스 앱을 함께 지원하는 확장 구조

---

## 2. 런타임 구조

### 프론트엔드
- 위치: `client/`
- 기술: Svelte 5, Vite
- 역할:
  - 로그인 이후 데스크톱 화면 렌더링
  - 앱 아이콘 그리드, 창 관리, 위젯, Spotlight, 태스크바 제공
  - `/api/system/apps`에서 받은 앱 레지스트리를 바탕으로 앱 목록 구성
  - 기본 앱은 로컬 Svelte 컴포넌트로 렌더링
  - 샌드박스 앱은 `SandboxAppFrame`으로 iframe 형태 렌더링

### 백엔드
- 위치: `server/`
- 기술: Express, Socket.io, node-pty, systeminformation
- 역할:
  - 인증, 파일, 시스템, 로그, 공유, 클라우드, Docker, 샌드박스, 패키지 API 제공
  - PTY 기반 실시간 터미널 세션 관리
  - 상태 저장 및 인벤토리 구조 관리
  - 인덱싱, 휴지통, 공유 링크, 감사 로그 등 내부 서비스 구동

### 상태/저장소
- DB 없음
- `server/storage/` 아래의 JSON/로그 파일을 직접 사용
- UI 상태, 앱 인벤토리, 공유 링크, 감사 로그, 인덱스를 파일로 저장

---

## 3. 실제 디렉토리 구조

아래는 현재 작업에 실질적으로 중요한 디렉토리만 추린 것이다.

```text
client/
  src/
    apps/                       기본 앱 Svelte 컴포넌트
      code-editor/
      control-panel/
      docker-manager/
      document-viewer/
      file-explorer/
      log-viewer/
      media-player/
      model-viewer/
      package-center/
      resource-monitor/
      settings/
      terminal/
      transfer/
      widget-store/
    core/
      Desktop.svelte            데스크톱 메인 화면
      Window.svelte             윈도우 프레임
      Spotlight.svelte          통합 검색
      components/
        SandboxAppFrame.svelte  샌드박스 앱 iframe 런타임
      stores/                   창/위젯/데스크톱/상태 스토어
    utils/
      api.js                    인증 토큰 포함 fetch 래퍼

server/
  config/
    defaults.json               기본 설정값
    serverConfig.js             .env + defaults 통합 해석기
    rclone.conf                 클라우드 연동용 설정
  middleware/
    auth.js                     JWT 인증
    pathGuard.js                허용 루트 및 보호 경로 검사
  routes/
    auth.js
    cloud.js
    docker.js
    fs.js
    logs.js
    media.js
    packages.js
    sandbox.js
    services.js
    settings.js
    share.js
    system.js
  services/
    auditService.js             감사 로그
    cloudService.js             rclone 연동
    indexService.js             파일 인덱싱
    mediaService.js             메타데이터/썸네일
    packageRegistryService.js   앱 레지스트리 통합
    serviceManager.js           서비스 생명주기 관리
    shareService.js             공유 링크 저장/만료
    stateStore.js               UI 상태 저장소
    storageService.js           스토리지 진단
    terminal.js                 Socket.io PTY 세션
    trashService.js             휴지통
    userDirs.js                 사용자 폴더 감지
  storage/
    apps.json                   기본 앱 레지스트리
    index.json                  파일 인덱스
    shares.json                 공유 링크 메타
    audit.log                   감사 로그
    inventory/
      apps/                     샌드박스 앱 인벤토리
      state_*.json              UI 상태 파일
      wallpapers/               배경화면 저장 위치
      widgets/                  위젯 라이브러리
  utils/
    appPaths.js                 샌드박스 앱 경로 계산
    inventoryPaths.js           inventory 구조 경로 계산
    pathPolicy.js               경로 보안 유틸리티
  index.js                      서버 부트스트랩
```

---

## 4. 프론트엔드 핵심 구조

### 4.1 Desktop 진입점
- 파일: `client/src/core/Desktop.svelte`
- 역할:
  - `/api/system/apps` 호출로 앱 목록 로드
  - 앱 ID를 Svelte 컴포넌트에 매핑
  - 열려 있는 창 목록을 렌더링
  - 기본 앱이면 직접 컴포넌트 렌더링
  - `runtime === 'sandbox'`이면 `SandboxAppFrame` 렌더링

### 4.2 윈도우 상태 저장
- 파일: `client/src/core/stores/windowStore.js`
- 주요 동작:
  - 창 목록과 활성 창 ID 관리
  - `singleton` 앱 중복 실행 방지
  - 1초 debounce 후 `/api/system/state/windows`에 저장
  - 초기 로드시 `/api/system/state/windows`에서 복원

### 4.3 앱 매핑 방식
- 기본 앱은 `Desktop.svelte`의 `components` 객체에 직접 연결됨
- 앱 목록 자체는 `/api/system/apps`에서 서버가 반환
- 즉:
  - 기본 앱: 서버 레지스트리 + 프론트 컴포넌트 매핑 둘 다 필요
  - 샌드박스 앱: 인벤토리에 manifest 추가만으로 노출 가능

### 4.4 샌드박스 앱 렌더링
- 파일: `client/src/core/components/SandboxAppFrame.svelte`
- 역할:
  - 샌드박스 앱 엔트리 URL iframe 로드
  - 샌드박스 앱에서 부모 데스크톱으로 메시지 전달
  - 다른 앱 열기 같은 브리지 역할 수행

---

## 5. 백엔드 부트스트랩과 서비스 구조

### 5.1 서버 시작 흐름
- 파일: `server/index.js`
- 순서:
  1. `.env` 로드
  2. `serverConfig`로 defaults + env 병합
  3. `ServiceManager` 생성
  4. `indexService`, `trashService`, `shareService`, `auditService` 등록/시작
  5. Express + HTTP + Socket.io 초기화
  6. 터미널 서비스 초기화
  7. 라우트 마운트
  8. graceful shutdown 등록

### 5.2 관리되는 서비스
- `indexService`: 파일 검색 인덱스 및 watcher
- `trashService`: 삭제 파일 격리/복구/비우기
- `shareService`: 공유 링크 저장 및 조회
- `auditService`: 감사 로그 기록 및 조회

### 5.3 설정 로더
- 파일: `server/config/serverConfig.js`
- 책임:
  - `.env` 읽기
  - `defaults.json` 읽기
  - `ALLOWED_ROOTS`, `CORS_ORIGIN` 파싱
  - 민감값 마스킹
  - UI용 설정 제공
  - `.env` 업데이트 반영

주의:
- `helmet()`은 코드에 import 되어 있으나 현재 비활성화 상태다.
- CORS는 현재 설정값 기준으로 동작하며 기본값은 `*`다.

---

## 6. 인증과 권한 모델

### 6.1 인증 방식
- JWT Bearer 토큰
- 인증 미들웨어: `server/middleware/auth.js`
- 허용 방식:
  - `Authorization: Bearer <token>`
  - 또는 `?token=<token>` 쿼리 파라미터

### 6.2 로그인
- `POST /api/auth/login`
- 입력: `username`, `password`
- 성공 시 `token` 반환

### 6.3 검증
- `GET /api/auth/verify`

### 6.4 파일 경로 권한
- 미들웨어: `server/middleware/pathGuard.js`
- 역할:
  - 요청의 `path`를 절대 경로로 정규화
  - `ALLOWED_ROOTS` 밖 경로 차단
  - `server/storage/inventory` 같은 보호 시스템 영역 직접 접근 차단

### 6.5 샌드박스 권한
- 파일: `server/routes/sandbox.js`
- 앱 manifest의 `permissions` 기반
- 현재 사용 중인 권한:
  - `app.data.list`
  - `app.data.read`
  - `app.data.write`

---

## 7. 상태 저장 구조

### 7.1 저장 키
- 파일: `server/services/stateStore.js`
- 지원 키:
  - `settings`
  - `windows`
  - `widgets`
  - `shortcuts`
  - `desktops`

### 7.2 저장 위치
- `server/storage/inventory/state_<key>.json`
- legacy 파일이 있으면 읽어서 새 위치로 마이그레이션

### 7.3 특징
- 각 상태는 normalize 과정을 거쳐 저장됨
- 깨진 JSON 파일은 `.corrupt-<timestamp>.json`로 백업 후 기본값으로 복구 가능

---

## 8. 앱 레지스트리 구조

### 8.1 기본 앱
- 저장 위치: `server/storage/apps.json`
- 서버가 읽고 `runtime: 'builtin'`으로 정규화

### 8.2 샌드박스 앱
- 저장 위치: `server/storage/inventory/apps/<app-id>/`
- 필수 파일:
  - `manifest.json`
  - 엔트리 파일 예: `index.html`

### 8.3 통합 지점
- 파일: `server/services/packageRegistryService.js`
- 역할:
  - 기본 앱 + 샌드박스 앱 병합
  - 중복 ID 방지
  - 창 크기, 권한, 메타데이터 정규화

### 8.4 샌드박스 manifest 예시

```json
{
  "id": "hello-sandbox",
  "title": "Hello Sandbox",
  "description": "Example sandbox app",
  "version": "1.0.0",
  "entry": "index.html",
  "permissions": ["app.data.list", "app.data.read", "app.data.write"]
}
```

---

## 9. WebSocket / 실시간 터미널

### Socket.io 진입점
- 서버 파일: `server/services/terminal.js`

### 사용 이벤트
- 클라이언트 -> 서버
  - `terminal:init`
  - `terminal:input`
  - `terminal:resize`
- 서버 -> 클라이언트
  - `terminal:output`
  - `terminal:exit`

### 동작 방식
- 소켓 ID 하나당 PTY 세션 하나
- Windows는 `powershell.exe`, 그 외는 `bash`
- 소켓 disconnect 시 해당 PTY kill

주의:
- `node-pty`가 없으면 fallback 모드로 동작하며 실제 셸 세션은 열리지 않는다.

---

## 10. API 엔드포인트 요약

기준:
- `Auth`: JWT 필요 여부
- `Public`: 토큰 없이 접근 가능

### 10.1 Health

| Method | Path | Auth | 설명 |
|---|---|---:|---|
| GET | `/health` | Public | 서버 상태, uptime, 서비스 상태 스냅샷 |

### 10.2 Auth API

| Method | Path | Auth | 설명 |
|---|---|---:|---|
| POST | `/api/auth/login` | Public | 로그인 후 JWT 발급 |
| GET | `/api/auth/verify` | Token | 토큰 유효성 검사 |

### 10.3 File System API

모든 `/api/fs/*`는 기본적으로 인증 필요. 일부 라우트는 추가로 `pathGuard` 적용.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/fs/trash` | 휴지통 목록 |
| POST | `/api/fs/restore` | 휴지통 항목 복구. body: `id` |
| DELETE | `/api/fs/empty-trash` | 휴지통 비우기 |
| GET | `/api/fs/config` | 초기 경로 설정 반환 |
| GET | `/api/fs/user-dirs` | 사용자 폴더 자동 감지 |
| GET | `/api/fs/list` | 디렉토리 목록. query: `path` |
| GET | `/api/fs/search` | 파일 검색. query: `path`, `q` |
| GET | `/api/fs/read` | 파일 텍스트 읽기. query: `path` |
| GET | `/api/fs/raw` | 원본 파일 스트리밍/전송. query: `path` |
| POST | `/api/fs/write` | 파일 저장. body: `path`, `content` |
| DELETE | `/api/fs/delete` | 파일/폴더를 휴지통으로 이동. body 또는 query: `path` |
| POST | `/api/fs/create-dir` | 디렉토리 생성. body: `path` |
| PUT | `/api/fs/rename` | 이름 변경. body: `oldPath`, `newName` |
| GET | `/api/fs/archive-list` | ZIP 내부 목록 조회. query: `path` |
| POST | `/api/fs/extract` | ZIP 압축 해제. body: `path`, `destPath?` |
| POST | `/api/fs/upload-chunk` | chunk 업로드. multipart + `path`, `uploadId`, `chunkIndex`, `totalChunks`, `fileName` |

메모:
- `pathGuard`는 `server/storage/inventory` 직접 접근을 막는다.
- 삭제는 즉시 영구 삭제가 아니라 휴지통 이동이다.

### 10.4 System API

모든 `/api/system/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/system/overview` | 시스템 개요(CPU, 메모리, 스토리지, GPU, 네트워크) |
| GET | `/api/system/cpu` | 상세 CPU/로드/온도 |
| GET | `/api/system/network-ips` | 로컬/외부 IP |
| GET | `/api/system/apps` | 통합 앱 레지스트리 반환 |
| GET | `/api/system/storage/diagnostics` | 스토리지 진단(S.M.A.R.T 등) |
| GET | `/api/system/processes` | 프로세스 상위 50개 |
| GET | `/api/system/network/connections` | 네트워크 연결 정보 |
| GET | `/api/system/wallpapers/list` | 배경화면 인벤토리 목록 |
| POST | `/api/system/wallpapers/upload` | 배경화면 업로드 |
| GET | `/api/system/state/:key` | 상태 읽기 |
| POST | `/api/system/state/:key` | 상태 저장 |
| GET | `/api/system/widget-library` | 위젯 템플릿 목록 |
| POST | `/api/system/widget-library/:id` | 위젯 템플릿 저장/갱신 |
| DELETE | `/api/system/widget-library/:id` | 위젯 템플릿 삭제 |

지원되는 `:key`:
- `settings`
- `windows`
- `widgets`
- `shortcuts`
- `desktops`

### 10.5 Settings API

모든 `/api/settings/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/settings` | 현재 공개 가능한 설정 조회 |
| PUT | `/api/settings` | `.env` 갱신. 일부 키만 허용 |

현재 수정 가능한 키:
- `PORT`
- `NODE_ENV`
- `JWT_SECRET`
- `ALLOWED_ROOTS`
- `INITIAL_PATH`
- `INDEX_DEPTH`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `CORS_ORIGIN`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`

### 10.6 Logs API

모든 `/api/logs/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/logs` | 로그 조회. query: `limit`, `category` 또는 `type`, `level`, `search` |
| DELETE | `/api/logs` | 로그 비우기 미구현. 안전상 메시지만 반환 |

### 10.7 Share API

| Method | Path | Auth | 설명 |
|---|---|---:|---|
| GET | `/api/share/info/:id` | Public | 공유 링크 메타 정보 조회 |
| GET | `/api/share/download/:id` | Public | 공유 파일 다운로드 |
| POST | `/api/share/create` | Token | 공유 링크 생성. body: `path`, `expiryHours` |

### 10.8 Media API

현재 `/api/media/*`는 인증 필요지만 `pathGuard`는 적용되지 않는다.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/media/info` | 미디어 메타데이터. query: `path` |
| GET | `/api/media/thumbnail` | 썸네일 생성/반환. query: `path` |
| GET | `/api/media/subtitles` | 같은 디렉토리의 자막 탐색. query: `path` |
| GET | `/api/media/neighbors` | 이전/다음 미디어 탐색. query: `path`, `type` |

### 10.9 Cloud API

모든 `/api/cloud/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/cloud/providers` | 지원 provider 목록 |
| GET | `/api/cloud/remotes` | 설정된 remote 목록 |
| POST | `/api/cloud/setup` | 새 remote 설정. body: `name`, `provider` |
| GET | `/api/cloud/list` | remote 경로 목록. query: `remote`, `path` |
| GET | `/api/cloud/read` | remote 파일 읽기. query: `remote`, `path` |
| POST | `/api/cloud/add-webdav` | WebDAV 추가. body: `name`, `url`, `user`, `pass` |

### 10.10 Docker API

모든 `/api/docker/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/docker/containers` | 컨테이너 목록 |
| POST | `/api/docker/start` | 컨테이너 시작. body: `id` |
| POST | `/api/docker/stop` | 컨테이너 중지. body: `id` |
| POST | `/api/docker/restart` | 컨테이너 재시작. body: `id` |
| DELETE | `/api/docker/remove` | 컨테이너 강제 제거. body: `id` |

### 10.11 Packages API

모든 `/api/packages/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/packages` | 샌드박스 앱 패키지 목록 반환 |

### 10.12 Services API

모든 `/api/services/*`는 인증 필요.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/services` | 내부 서비스 상태 스냅샷 |
| POST | `/api/services/:name/restart` | 서비스 재시작 |

### 10.13 Sandbox API

샌드박스 데이터 API는 인증 필요, manifest/asset 서빙은 공개.

| Method | Path | Auth | 설명 |
|---|---|---:|---|
| POST | `/api/sandbox/:appId/data/list` | Token | 앱 데이터 디렉토리 목록 |
| POST | `/api/sandbox/:appId/data/read` | Token | 앱 데이터 파일 읽기 |
| POST | `/api/sandbox/:appId/data/write` | Token | 앱 데이터 파일 쓰기 |
| GET | `/api/sandbox/:appId/manifest` | Public | 샌드박스 앱 manifest 조회 |
| GET | `/api/sandbox/:appId/*` | Public | 앱 엔트리/정적 자산 서빙 |

### 10.14 Static Inventory API

| Method | Path | Auth | 설명 |
|---|---|---:|---|
| GET | `/api/inventory-files/*` | Public | inventory 루트의 정적 파일 제공 |

---

## 11. 현재 구현된 앱 목록

클라이언트 기본 앱 디렉토리 기준:
- `file-explorer`
- `terminal`
- `resource-monitor`
- `code-editor`
- `docker-manager`
- `settings`
- `control-panel`
- `transfer`
- `media-player`
- `document-viewer`
- `model-viewer`
- `log-viewer`
- `package-center`
- `widget-store`

서버 기본 앱 레지스트리:
- `server/storage/apps.json`

주의:
- 프론트 앱 폴더가 존재해도, 서버 레지스트리와 `Desktop.svelte` 매핑이 없으면 아이콘/실행이 완전히 연결되지 않을 수 있다.

---

## 12. 새 기능을 추가할 때 수정 지점

### 12.1 기본 Svelte 앱 추가
1. `client/src/apps/<app-name>/`에 컴포넌트 추가
2. `client/src/core/Desktop.svelte`의 import/`components` 매핑 추가
3. `server/storage/apps.json`에 앱 레지스트리 항목 추가
4. 필요 시 아이콘 문자열을 `Desktop.svelte`의 `iconMap`에서 처리

### 12.2 샌드박스 앱 추가
1. `server/storage/inventory/apps/<app-id>/` 폴더 생성
2. `manifest.json` 작성
3. 엔트리 파일 예: `index.html` 배치
4. 필요한 `permissions` 선언
5. `Package Center`와 `/api/system/apps`에서 자동 인식되는지 확인

### 12.3 새 상태 키 추가
1. `server/services/stateStore.js`의 `STATE_KEYS`에 키 추가
2. 기본값과 normalize 함수 추가
3. 프론트 스토어에서 `/api/system/state/:key` 연동

### 12.4 새 API 라우트 추가
1. `server/routes/<name>.js` 작성
2. `server/index.js`에서 `app.use('/api/<name>', router)` 마운트
3. 인증 필요 여부에 따라 `auth`, `pathGuard` 적용
4. 프론트 `apiFetch` 호출부 추가

---

## 13. AI가 작업할 때 특히 주의할 점

### 보안/권한
- `ALLOWED_ROOTS` 바깥 파일 접근은 차단된다.
- `server/storage/inventory`는 일반 파일 API로 접근하면 안 된다.
- 샌드박스 앱 데이터는 반드시 Sandbox API를 사용해야 한다.

### 상태 저장
- 창 상태는 프론트에서 debounce 저장한다.
- 상태 JSON 형식은 `stateStore`가 normalize 하므로, 구조 변경 시 해당 파일도 같이 수정해야 한다.

### 앱 등록
- 기본 앱은 프론트와 서버 두 군데 모두 연결해야 한다.
- 샌드박스 앱은 manifest 기반이라 프론트 코드 수정 없이도 나타날 수 있다.

### 운영상 한계
- 파일 기반 저장 구조라 동시성/무결성 이슈 가능성이 있다.
- `helmet`이 비활성화되어 있다.
- `media.js`는 현재 인증은 있지만 `pathGuard`는 없다.
- 인증 구조는 사실상 관리자 단일 계정 중심이다.

---

## 14. 빠른 작업 체크리스트

AI가 이 프로젝트를 수정할 때 가장 먼저 확인할 것:

1. 수정 대상이 기본 앱인지 샌드박스 앱인지 구분
2. UI 상태 저장이 필요한지 확인
3. 새 파일 경로가 `ALLOWED_ROOTS` 또는 inventory 보호 규칙과 충돌하는지 확인
4. 서버 라우트 추가 시 `server/index.js` 마운트 여부 확인
5. 샌드박스 앱이면 manifest, permissions, entryUrl 흐름 확인
6. 기본 앱이면 `Desktop.svelte` 매핑과 `apps.json` 등록 여부 확인

---

## 15. 현재 프로젝트 이해의 핵심 포인트

이 프로젝트를 가장 짧게 이해하면 다음과 같다.

- **프론트는 데스크톱 UI 엔진**
- **백엔드는 로컬 시스템 제어 API**
- **상태는 파일로 저장**
- **앱은 기본 앱 + 샌드박스 앱으로 구성**
- **샌드박스 앱은 inventory 기반으로 동적 등록**
- **대부분의 사용자 기능은 `/api/system`, `/api/fs`, `/api/sandbox`, `/api/packages` 축 위에 올라가 있음**

이 문서를 기준으로 보면, 다음 작업은 보통 아래 중 하나다.
- 새 앱 추가
- 기존 앱 UI 수정
- 새 API 추가
- 상태 저장 구조 변경
- 샌드박스 권한/인벤토리 확장
