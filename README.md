# 웹OS (Web OS) - 로컬 PC 관리 플랫폼

로컬 PC의 파일 시스템, 터미널, 시스템 리소스를 웹 브라우저에서 제어할 수 있는 가상 데스크톱 환경입니다. Svelte 5와 Node.js를 기반으로 구현되었습니다.

---

## 🛠️ 기술 스택 (Tech Stack)

### **Frontend**
- **Svelte 5**: 클라이언트 UI 프레임워크.
- **Vite**: 빌드 도구 및 개발 서버.
- **Monaco Editor**: 파일 스테이션 내 텍스트/코드 편집기 통합.
- **Xterm.js**: 터미널 에뮬레이션 구현.
- **Chart.js & Svelte-Chartjs**: 시스템 리소스 시각화.
- **Three.js**: 3D 모델(FBX, GLTF, OBJ) 렌더링 엔진.
- **Lucide Svelte**: 시스템 아이콘 세트.
- **CSS**: Glassmorphism 테마 기반의 커스텀 UI 디자인.

### **Backend**
- **Node.js & Express**: API 및 정적 파일 서버.
- **Socket.io**: 터미널 및 리소스 모니터링 실시간 데이터 통신.
- **Node-pty**: 시스템 셸(TTY) 연동.
- **Systeminformation**: CPU, GPU, 메모리 등 하드웨어 데이터 수집.
- **JWT (JSON Web Token)**: 사용자 인증 및 토큰 관리.
- **Bcryptjs**: 비밀번호 보안 처리.
- **Path Guard**: `ALLOWED_ROOTS` 설정을 기반으로 한 디렉토리 접근 제어.

---

## 🚀 주요 기능 (Key Features)

1.  **파일 스테이션 (File Station)**
    - **파일 제어**: 파일 및 폴더 생성, 읽기, 수정, 삭제(CRUD) 및 업로드.
    - **편집기**: Monaco Editor를 이용한 텍스트 편집 기능.
    - **경로 감지**: 리눅스(XDG), 윈도우 환경에 따른 시스템 폴더(문서, 다운로드 등) 자동 감지.
    - **인벤토리**: 시스템 자산 보관을 위한 별도 저장 프로젝트 운영.

2.  **스마트 경로 감지 (Smart Directory Detection)**
    - **지능형 폴더 인식**: OS나 언어 설정과 관계없이 사용자의 실제 '문서', '사진', '다운로드' 폴더를 지능적으로 찾아냅니다. 
    - **4단계 폴백(Fallback)**:
        - `사용자 지정` (.env 설정)
        - `OS 표준 API` (Linux XDG, Windows Known Folders)
        - `환경 변수` (XDG_DOCUMENTS_DIR 등)
        - `다국어 하이패스 스캔` (다국어 폴더명 브루트 포스 스캔)
    - **멀티 OS 지원**: Linux, Windows, macOS 환경을 모두 지원하여 높은 이식성을 보장합니다.

3.  **터미널 (Terminal)**
    - 실제 PC의 셸과 실시간 연동되어 명령어 실행 가능.
    - Xterm.js 및 Node-pty 기반의 안정적인 세션 유지.

4.  **리소스 모니터 (Resource Monitor)**
    - CPU 사용량, 프로세스 및 메모리 점유 상태 실시간 확인.
    - GPU 사용량 및 네트워크(IP) 정보 트래킹 지원.

4.  **멀티태스킹 및 검색 (Multitasking & Search)**
    - **Spotlight Search**: `Ctrl + Space` 단축키를 통한 시스템 전역 앱 및 기능 통합 검색.
    - **가상 데스크톱 (Virtual Desktops)**: 여러 작업 공간을 전환하며 효율적인 멀티태스킹 지원.
    - **윈도우 스냅 (Window Snapping)**: 상단 및 좌우 가장자리 드래그를 통한 지능형 창 분할 배치.

5.  **통합 미디어 및 문서 뷰어 (Media & Document Viewers)**
    - **미디어 플레이어**: 비디오(자막 지원), 오디오, 고해상도 이미지 전용 통합 뷰어.
    - **3D 모델 뷰어**: FBX, GLTF, OBJ 모델을 지원하며 리깅 애니메이션 및 자동 프레이밍 기능 탑재.
    - **문서 뷰어**: PDF 파일을 브라우저 내에서 즉시 확인 가능한 전용 뷰어 탑재.
    - **파일 탐색기 연동**: 더블 클릭 시 확장자에 따른 지능형 앱 연결 및 창 재사용 로직.

6.  **클라우드 스토리지 통합 (Cloud Integration)**
    - **rclone 기반 연동**: 구글 드라이브(Google Drive) 등 40여 종의 클라우드 스토리지를 로컬처럼 관리.
    - **Cloud Manager**: 설정 앱 내에서 클라우드 계정 등록 및 마운트 상태 제어.

---

## 🚀 실행 단계

### 1. 백엔드 서버 실행
```bash
cd ~/web_os
node server/index.js
```

### 2. 프론트엔드 클라이언트 실행
```bash
cd ~/web_os/client
npm run dev
```

---

## 🧱 시스템 아키텍처 (Architecture)

1.  **Frontend (Client)**: 사용자 입력을 수용하고 Socket.io 및 API 통신으로 데이터 요청 및 표시.
2.  **Backend (Server)**: 비즈니스 로직 처리, 보안 검사 수행 및 OS 리소스 연동 서비스 제공.
3.  **Local OS**: 서버를 통해 전달받은 파일 조작 및 셸 명령어 실행 결과 반환.

---

## ⚠️ 보안 정책
보안을 위해 모든 파일 접근은 `.env` 내 `ALLOWED_ROOTS` 설정 범위 내로 제한됩니다. 비정상적인 상위 디렉토리 접근 시도는 서버 단에서 원천 차단됩니다.
