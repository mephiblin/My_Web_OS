# 웹OS (Web OS) 프로젝트 기획서 v2.0

> **문서 버전**: 2.0  
> **최종 수정일**: 2026-04-18  
> **상태**: 기획 확정 대기

---

## 1. 프로젝트 개요

### 1.1 목적
로컬 PC에 설치되어 웹 브라우저(localhost)를 통해 시스템 자원을 관리하는 **시놀로지 DSM 스타일의 웹 운영체제**를 구축한다. 별도의 클라우드 의존 없이, 본인의 PC를 하나의 서버처럼 웹 UI로 완전히 제어하는 것이 핵심 가치이다.

### 1.2 핵심 목표
| 목표 | 설명 |
|---|---|
| **로컬 파일 완전 제어** | 파일/폴더의 생성, 읽기, 쓰기, 편집, 삭제를 웹 UI에서 수행 |
| **실시간 터미널** | 브라우저에서 로컬 셸(Bash/Zsh)에 직접 접속 |
| **시스템 모니터링** | CPU, RAM, GPU, 디스크, 네트워크 상태를 실시간 대시보드로 확인 |
| **DSM-like 데스크탑 UX** | 멀티 윈도우, 태스크바, 앱 런처 등 데스크탑 OS와 동일한 사용감 |

### 1.3 대상 사용자
- 개인 워크스테이션/홈서버 운영자
- 개발자 (로컬 개발환경 통합 관리)
- NAS/서버 관리에 익숙한 파워 유저

---

## 2. 시스템 아키텍처

### 2.1 전체 구조도
```
┌──────────────────────────────────────────────────┐
│                  Web Browser (Client)             │
│  ┌────────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ File       │ │ Terminal │ │ System Monitor │  │
│  │ Explorer   │ │ (xterm)  │ │ (Dashboard)    │  │
│  └─────┬──────┘ └────┬─────┘ └───────┬────────┘  │
│        │              │               │           │
│  ┌─────┴──────────────┴───────────────┴────────┐  │
│  │         Window Manager (Desktop Shell)       │  │
│  └──────────────────┬──────────────────────────┘  │
└─────────────────────┼────────────────────────────┘
                      │ HTTP / WebSocket
┌─────────────────────┼────────────────────────────┐
│              Backend Server (Node.js)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ REST API │ │ WS Hub   │ │ Auth Middleware   │  │
│  │ (Express)│ │(Socket.io)│ │ (JWT/Session)    │  │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
│       │             │                │            │
│  ┌────┴─────┐  ┌────┴─────┐  ┌──────┴─────────┐  │
│  │ FS Module│  │ PTY      │  │ SysInfo Module │  │
│  │ (fs-extra)│ │(node-pty)│  │(systeminformation)│
│  └──────────┘  └──────────┘  └────────────────┘  │
│                      │                            │
│              ┌───────┴──────────┐                 │
│              │  Host OS (Linux) │                 │
│              └──────────────────┘                 │
└───────────────────────────────────────────────────┘
```

### 2.2 통신 프로토콜
| 대상 | 프로토콜 | 용도 |
|---|---|---|
| 파일 시스템 API | REST (HTTP) | CRUD 요청/응답 |
| 터미널 | WebSocket | 실시간 양방향 stdin/stdout 스트리밍 |
| 시스템 모니터링 | WebSocket | 초 단위 메트릭 Push |
| 파일 업/다운로드 | HTTP Multipart | 대용량 파일 전송 |

---

## 3. 핵심 기능 상세

### 3.1 파일 시스템 관리 (File Station)

#### 3.1.1 파일/폴더 브라우징
- 로컬 시스템의 폴더 트리 구조를 사이드바에 시각화
- 아이콘 뷰 / 리스트 뷰 / 상세 뷰 전환 지원
- 파일 미리보기 (이미지, 텍스트, PDF, 비디오 썸네일)
- 파일 정보 표시: 이름, 크기, 수정일, 권한(chmod)

#### 3.1.2 CRUD 작업
- **생성**: 새 파일/폴더 생성 (우클릭 컨텍스트 메뉴 또는 툴바)
- **읽기**: 클릭으로 파일 열기, 텍스트/이미지/미디어 인라인 뷰
- **쓰기/수정**: 내장 에디터에서 직접 편집 후 저장
- **삭제**: 휴지통 개념 적용 (즉시 삭제 + 복구 가능)
- **이름 변경 / 이동 / 복사**: 드래그 앤 드롭 지원
- **업로드/다운로드**: 로컬 ↔ 브라우저 간 파일 전송

#### 3.1.3 내장 코드 에디터
- **Monaco Editor** (VS Code 기반) 통합
- 구문 강조(Syntax Highlighting): JS, Python, JSON, Markdown 등
- 자동 완성 및 기본 IntelliSense
- 다중 탭 에디팅
- 저장 단축키 (Ctrl+S → 서버로 PUT 요청)

#### 3.1.4 권한 관리
- 파일/폴더 권한(chmod) 조회 및 수정
- 소유자(owner/group) 정보 표시

### 3.2 실시간 터미널 (Terminal)

#### 3.2.1 핵심 기능
- **xterm.js** 기반 웹 터미널 렌더러
- **node-pty** 기반 서버 사이드 PTY(Pseudo Terminal) 생성
- WebSocket을 통한 실시간 stdin/stdout 스트리밍
- 다중 터미널 탭 (세션별 독립 셸)

#### 3.2.2 부가 기능
- 터미널 테마 커스터마이징 (폰트, 색상 스킴)
- 셸 선택 (Bash, Zsh, Fish 등)
- 명령어 히스토리 (셸 자체 히스토리 연동)
- 터미널 분할 (Split Pane) — 수평/수직
- 터미널 출력 검색 (xterm-addon-search)
- 클립보드 복사/붙여넣기 지원

### 3.3 시스템 모니터링 (Resource Monitor)

#### 3.3.1 CPU 모니터링
- 전체 사용률(%) 실시간 게이지
- 코어별 사용률 막대 그래프
- 1분 / 5분 / 15분 Load Average
- CPU 온도 (lm-sensors 연동)

#### 3.3.2 메모리 모니터링
- 전체 RAM 크기 / 사용 중 / 캐시 / 가용 메모리
- SWAP 사용량
- 도넛 차트 시각화

#### 3.3.3 스토리지 모니터링
- 마운트된 디스크별 사용량 / 남은 용량
- 디스크 I/O (읽기/쓰기 속도) 실시간 그래프
- S.M.A.R.T 상태 (디스크 건강도)

#### 3.3.4 GPU 모니터링
- GPU 코어 사용률, VRAM 할당량
- GPU 온도 게이지
- nvidia-smi / rocm-smi 연동

#### 3.3.5 네트워크 모니터링
- 네트워크 인터페이스별 Up/Down 속도
- 실시간 트래픽 그래프
- 현재 활성 연결 수

#### 3.3.6 전력 및 쿨링
- 센서 기반 메인보드 온도
- 팬 속도(RPM) 모니터링
- 대략적 시스템 전력 소비량

### 3.4 서비스 제어 (Service Manager)

#### 3.4.1 Docker 컨테이너 관리
- 컨테이너 목록 및 상태 (Running / Stopped / Error)
- 원클릭 시작 / 정지 / 재시작 토글
- 컨테이너 로그 실시간 스트리밍
- 기본 리소스 사용량 (CPU/RAM per container)

#### 3.4.2 시스템 서비스 관리
- systemd 서비스 목록 및 상태 확인
- 서비스 시작/정지/재시작 제어
- 서비스 로그 조회 (journalctl 연동)

### 3.5 커스텀 스크립트 런처 (Quick Launcher)
- 자주 쓰는 터미널 명령어를 아이콘 버튼으로 등록
- 원클릭 실행 및 결과 출력 모달
- 스크립트 카테고리 분류 (시스템, 개발, 크롤링 등)
- 실행 로그 히스토리 저장

---

## 4. UI/UX 상세 설계

### 4.1 데스크탑 셸 (Desktop Shell)
```
┌──────────────────────────────────────────────────┐
│  ● ● ●     ◀ ▶     Web OS             🔍  🔔  ⚙️ │  ← 상단바
├──────────────────────────────────────────────────┤
│                                                  │
│   ┌─────────────────┐  ┌──────────────────┐      │
│   │  📁 File Station │  │  >_ Terminal     │      │
│   │                 │  │                  │      │
│   │  [파일 목록]     │  │  user@pc:~$      │      │
│   │                 │  │                  │      │
│   └─────────────────┘  └──────────────────┘      │
│                                                  │
│   ┌──────────────────────────────────────┐       │
│   │  📊 Resource Monitor                 │       │
│   │  CPU ████████░░ 78%  RAM ██████░░ 62%│       │
│   └──────────────────────────────────────┘       │
│                                                  │
├──────────────────────────────────────────────────┤
│  📁  >_  📊  ⚡  🐳        │ 16:30           │  ← 태스크바
└──────────────────────────────────────────────────┘
```

### 4.2 창 관리 시스템 (Window Manager)
| 기능 | 설명 |
|---|---|
| 드래그 이동 | 타이틀바를 잡고 자유 이동 |
| 리사이즈 | 창 모서리 드래그로 크기 조절 |
| 최소화/최대화/닫기 | 타이틀바 버튼 (●●●) |
| 스냅 | 화면 가장자리에 50% 스냅 |
| Z-order | 클릭 시 최상위로 포커스 전환 |
| 태스크바 | 열린 앱 목록 표시, 클릭으로 전환 |

### 4.3 디자인 시스템
- **테마**: 다크 모드 기본 (밝은 테마 전환 옵션)
- **컬러 팔레트**:
  - 배경: `#0d1117`, `#161b22`
  - 표면(Surface): `rgba(255,255,255,0.05)` (글래스 효과)
  - 엑센트: `#58a6ff` (블루), `#3fb950` (그린), `#f85149` (레드)
- **글래스모피즘**: `backdrop-filter: blur(20px)` + 반투명 배경
- **타이포그래피**: `Inter` 또는 `Pretendard` (한글 지원)
- **애니메이션**: 창 열기/닫기 시 `scale + opacity` 트랜지션 (200ms ease-out)
- **아이콘**: Phosphor Icons 또는 Lucide Icons

### 4.4 반응형 고려
- 기본 대상: 데스크탑 브라우저 (1920x1080 이상)
- 태블릿(1024px+): 터치 친화적 버튼 크기 확대
- 모바일: 최소 지원 (단일 앱 전체화면 모드)

---

## 5. API 설계

### 5.1 파일 시스템 API (RESTful)
| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/fs/list?path=` | 디렉토리 내용 조회 |
| `GET` | `/api/fs/read?path=` | 파일 내용 읽기 |
| `POST` | `/api/fs/create` | 파일/폴더 생성 |
| `PUT` | `/api/fs/write` | 파일 내용 쓰기(저장) |
| `PUT` | `/api/fs/rename` | 이름 변경 |
| `PUT` | `/api/fs/move` | 이동 |
| `POST` | `/api/fs/copy` | 복사 |
| `DELETE` | `/api/fs/delete` | 삭제 |
| `GET` | `/api/fs/info?path=` | 파일 메타정보 조회 |
| `POST` | `/api/fs/upload` | 파일 업로드 |
| `GET` | `/api/fs/download?path=` | 파일 다운로드 |

### 5.2 시스템 API
| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/system/overview` | CPU/RAM/Disk 요약 |
| `GET` | `/api/system/cpu` | CPU 상세 정보 |
| `GET` | `/api/system/memory` | 메모리 상세 |
| `GET` | `/api/system/disk` | 디스크 목록/용량 |
| `GET` | `/api/system/gpu` | GPU 상태 |
| `GET` | `/api/system/network` | 네트워크 상태 |
| `GET` | `/api/system/processes` | 프로세스 목록 |

### 5.3 Docker API
| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/docker/containers` | 컨테이너 목록 |
| `POST` | `/api/docker/:id/start` | 컨테이너 시작 |
| `POST` | `/api/docker/:id/stop` | 컨테이너 정지 |
| `POST` | `/api/docker/:id/restart` | 컨테이너 재시작 |
| `GET` | `/api/docker/:id/logs` | 컨테이너 로그 |

### 5.4 WebSocket 이벤트
| 이벤트 | 방향 | 설명 |
|---|---|---|
| `terminal:input` | Client → Server | 터미널 키 입력 |
| `terminal:output` | Server → Client | 터미널 출력 스트림 |
| `terminal:resize` | Client → Server | 터미널 크기 변경 |
| `metrics:update` | Server → Client | 시스템 메트릭 Push (1초 간격) |
| `docker:status` | Server → Client | 컨테이너 상태 변경 알림 |

---

## 6. 기술 스택

### 6.1 Frontend
| 기술 | 역할 |
|---|---|
| **Vite** | 빌드 도구 / 번들러 |
| **Svelte** (또는 React) | UI 프레임워크 |
| **Vanilla CSS** | 스타일링 (글래스모피즘, 다크 모드) |
| **xterm.js** | 웹 터미널 렌더러 |
| **Monaco Editor** | 코드 에디터 |
| **Chart.js** / **uPlot** | 실시간 차트/그래프 |
| **Phosphor Icons** | 아이콘 시스템 |

### 6.2 Backend
| 기술 | 역할 |
|---|---|
| **Node.js** (v20+) | 런타임 |
| **Express** | HTTP REST API 서버 |
| **Socket.io** | WebSocket 실시간 통신 |
| **node-pty** | PTY(Pseudo Terminal) 셸 연동 |
| **fs-extra** | 확장 파일 시스템 작업 |
| **systeminformation** | 하드웨어/OS 정보 수집 |
| **dockerode** | Docker API 클라이언트 |
| **multer** | 파일 업로드 처리 |

### 6.3 보안
| 기술 | 역할 |
|---|---|
| **bcrypt** | 비밀번호 해싱 |
| **jsonwebtoken** | JWT 토큰 인증 |
| **helmet** | HTTP 보안 헤더 |
| **express-rate-limit** | API 요청 제한 |

---

## 7. 보안 설계

### 7.1 인증 (Authentication)
- 최초 실행 시 관리자 계정 설정 (비밀번호)
- 로그인 페이지 → JWT 토큰 발급 → 세션 유지
- 토큰 만료 시 자동 재인증 요구

### 7.2 경로 보안 (Path Traversal 방지)
- API로 접근 가능한 루트 디렉토리를 설정 파일로 제한
- `../` 등의 경로 조작 시도 차단 (Path Normalization)
- 심볼릭 링크 추적 제한 옵션

### 7.3 프로세스 보안
- 터미널 세션은 인증된 사용자만 생성 가능
- 동시 접속 세션 수 제한
- 위험 명령어 경고 시스템 (선택적)

### 7.4 네트워크 보안
- 기본적으로 `localhost` (127.0.0.1)만 바인딩
- 외부 접근 시 HTTPS + 인증 필수
- CORS 설정으로 허용 도메인 제한

---

## 8. 설정 및 구성 관리

### 8.1 설정 파일 (`config.json`)
```json
{
  "server": {
    "port": 3000,
    "host": "127.0.0.1"
  },
  "security": {
    "jwtSecret": "auto-generated-on-first-run",
    "sessionTimeout": "24h",
    "allowedRoots": ["/home/user", "/mnt/data"]
  },
  "terminal": {
    "defaultShell": "/bin/bash",
    "maxSessions": 5
  },
  "monitoring": {
    "updateInterval": 1000,
    "enableGpu": true
  }
}
```

### 8.2 환경 변수 오버라이드
- `WEB_OS_PORT`, `WEB_OS_HOST` 등으로 설정 파일 없이 빠르게 조정 가능

---

## 9. 에러 처리 전략

### 9.1 Backend
- **통일된 에러 응답 포맷**:
  ```json
  {
    "error": true,
    "code": "FS_PERMISSION_DENIED",
    "message": "Permission denied: /root/secret",
    "timestamp": "2026-04-18T16:30:00Z"
  }
  ```
- **에러 코드 체계**: `FS_*` (파일), `TERM_*` (터미널), `SYS_*` (시스템), `AUTH_*` (인증)
- **로깅**: winston 또는 pino를 사용한 레벨별 로그 기록

### 9.2 Frontend
- API 실패 시 토스트 알림(Toast Notification)으로 사용자에게 안내
- WebSocket 연결 끊김 시 자동 재연결 (exponential backoff)
- 네트워크 오류 시 오프라인 상태 표시

---

## 10. 프로젝트 디렉토리 구조 (예상)
```
web_os/
├── package.json
├── config.json
├── server/                    # Backend
│   ├── index.js               # 서버 진입점
│   ├── routes/
│   │   ├── fs.js              # 파일 시스템 API
│   │   ├── system.js          # 시스템 모니터링 API
│   │   ├── docker.js          # Docker 관리 API
│   │   └── auth.js            # 인증 API
│   ├── services/
│   │   ├── terminal.js        # node-pty 관리
│   │   ├── metrics.js         # 시스템 메트릭 수집
│   │   └── docker.js          # Docker 연동
│   ├── middleware/
│   │   ├── auth.js            # JWT 검증
│   │   └── pathGuard.js       # 경로 보안
│   └── utils/
│       └── logger.js          # 로깅 유틸리티
├── client/                    # Frontend
│   ├── index.html
│   ├── src/
│   │   ├── main.js            # 앱 진입점
│   │   ├── desktop/
│   │   │   ├── Shell.svelte   # 데스크탑 셸 (배경 + 태스크바)
│   │   │   ├── WindowManager.svelte
│   │   │   ├── Taskbar.svelte
│   │   │   └── AppLauncher.svelte
│   │   ├── apps/
│   │   │   ├── FileExplorer.svelte
│   │   │   ├── Terminal.svelte
│   │   │   ├── CodeEditor.svelte
│   │   │   ├── ResourceMonitor.svelte
│   │   │   ├── DockerManager.svelte
│   │   │   └── ScriptLauncher.svelte
│   │   ├── components/        # 공용 UI 컴포넌트
│   │   │   ├── Window.svelte
│   │   │   ├── ContextMenu.svelte
│   │   │   ├── Toast.svelte
│   │   │   └── Modal.svelte
│   │   └── styles/
│   │       ├── global.css
│   │       ├── variables.css  # CSS Custom Properties
│   │       └── glassmorphism.css
│   └── vite.config.js
└── scripts/                   # 유틸리티 스크립트
    └── setup.js               # 최초 설정 스크립트
```

---

## 11. 개발 로드맵

### Phase 1 — 기반 구축 (1~2주)
- [x] 프로젝트 기획서 작성
- [ ] Node.js + Express 기본 서버 세팅
- [ ] 파일 시스템 REST API 구현 (list, read, write, create, delete)
- [ ] JWT 기반 인증 미들웨어 및 로그인 API
- [ ] 경로 보안(Path Guard) 미들웨어

### Phase 2 — 데스크탑 셸 (1~2주)
- [ ] Vite + Svelte 프론트엔드 프로젝트 구성
- [ ] 윈도우 매니저 (드래그, 리사이즈, 최소화/최대화, Z-order)
- [ ] 태스크바 및 앱 런처
- [ ] 글래스모피즘 디자인 시스템 적용

### Phase 3 — 핵심 앱 (2~3주)
- [ ] 파일 탐색기 (File Explorer) 앱 구현
- [ ] Monaco 기반 코드 에디터 앱 통합
- [ ] xterm.js + node-pty 터미널 앱 구현
- [ ] 다중 터미널 탭 및 분할 기능

### Phase 4 — 모니터링 & 서비스 (1~2주)
- [ ] systeminformation 기반 시스템 메트릭 API
- [ ] 실시간 대시보드 차트 (CPU, RAM, GPU, Disk, Network)
- [ ] Docker 컨테이너 관리 UI
- [ ] 커스텀 스크립트 런처

### Phase 5 — 완성도 (1주)
- [ ] 보안 강화 (HTTPS, Rate Limiting, 입력 검증)
- [ ] 에러 처리 및 로깅 시스템
- [ ] 사용자 설정 UI (설정 앱)
- [ ] PM2 또는 systemd 기반 자동 실행 구성
- [ ] README 및 설치 가이드 작성

---

## 12. 리스크 및 대응 방안

| 리스크 | 영향도 | 대응 방안 |
|---|---|---|
| node-pty 크로스 플랫폼 빌드 이슈 | 높음 | prebuild 바이너리 사용, Docker fallback |
| 대용량 파일 읽기 시 메모리 초과 | 중간 | 스트림 기반 읽기, 파일 크기 제한 경고 |
| WebSocket 연결 불안정 | 중간 | 자동 재연결 로직, 연결 상태 UI 표시 |
| 보안 취약점 (Path Traversal) | 높음 | 화이트리스트 기반 경로 제한, 정규화 검증 |
| GPU 모니터링 호환성 | 낮음 | nvidia-smi 미감지 시 해당 위젯 비활성화 |

---

## 13. 성공 기준 (Definition of Done)
- [ ] 웹 브라우저에서 localhost 접속 시 DSM 스타일 데스크탑 로딩
- [ ] 파일 CRUD가 실제 로컬 파일시스템에 즉시 반영
- [ ] 터미널에서 아무 명령이나 실행 가능 (ls, top, vim 등)
- [ ] CPU/RAM/GPU 메트릭이 1초 간격으로 실시간 업데이트
- [ ] Docker 컨테이너를 UI에서 제어 가능
- [ ] 로그인 인증 없이는 어떤 API에도 접근 불가
