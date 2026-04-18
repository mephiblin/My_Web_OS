# 웹OS (Web OS) - 로컬 PC 관리 플랫폼

> [!IMPORTANT]
> **본 프로젝트는 Svelte 5와 Node.js를 기반으로 구축된 프리미엄 웹 OS 환경입니다.**
> 로컬 PC의 파일 시스템, 터미널, 시스템 리소스를 투명한 유리 테마(Glassmorphism) 인터페이스를 통해 브라우저에서 제어할 수 있습니다.

---

## 🛠️ 기술 스택 (Tech Stack)

본 프로젝트는 최신 웹 기술과 안정적인 백엔드 아키텍처를 결합하여 개발되었습니다.

### **Frontend**
- **Svelte 5**: 최신 런타임 최적화 및 간결한 문법을 통한 고성능 UI 구축.
- **Vite**: 초고속 빌드 도구 및 개발 서버.
- **Monaco Editor**: VS Code와 동일한 강력한 코드 편집 경험 제공 (파일 스테이션 내 통합).
- **Xterm.js**: 터미널 에뮬레이션을 위한 산업 표준 라이브러리.
- **Chart.js & Svelte-Chartjs**: 실시간 리소스 모니터링 시각화.
- **Lucide Svelte**: 현대적이고 일관된 아이콘 시스템.
- **Vanilla CSS**: 최상급 사용자 경험을 위한 커스텀 Glassmorphism 디자인 시스템.

### **Backend**
- **Node.js & Express**: 확장성 있는 서버 아키텍처.
- **Socket.io**: 터미널 및 리소스 모니터링을 위한 저지연 실시간 양방향 통신.
- **Node-pty**: 실제 시스템 셸(TTY)과의 연결 및 제어.
- **Systeminformation**: CPU, GPU, 메모리, 저장소, 네트워크 상태의 정밀한 측정.
- **JWT (JSON Web Token)**: 보안 인증 및 세션 관리.
- **Bcryptjs**: 사용자 비밀번호 보안 해싱.
- **Path Security**: `Path Guard` 미들웨어를 통한 디렉토리 트래버스 공격 원천 차단.

---

## 🚀 주요 기능 (Key Features)

1.  **파일 스테이션 (File Station)**
    - **CRUD 지원**: 파일 및 폴더의 생성, 읽기, 수정, 삭제, 업로드 관리.
    - **코드 편집기**: Monaco Editor 기반의 강력한 텍스트 편집 기능.
    - **지능형 경로 감지**: 리눅스(XDG), 윈도우(Known Folders) 등 OS 환경 및 언어에 관계없이 최적의 시스템 폴더 자동 맵핑.
    - **인벤토리**: 시스템 자산(배경화면, 아이콘) 전용 격리 저장소 운영.

2.  **터미널 (Terminal)**
    - 실제 PC의 셸에 실시간으로 접속하여 명령어를 실행하는 고성능 터미널 환경.
    - 브라우저 내에서 직접 시스템 관리 및 개발 작업 가능.

3.  **리소스 모니터 (Resource Monitor)**
    - CPU 사용량, 프로세스별 메모리 점유, 저장소 현황 실시간 감시.
    - **고급 데이터**: GPU 사용량 및 네트워크(IP) 상태 실시간 트래킹.

4.  **보안 및 설정 (Security & Settings)**
    - **JWT 기반 인증**: 승인된 사용자만 시스템 리소스에 접근 가능.
    - **Path Guard**: `ALLOWED_ROOTS` 설정을 통해 지정된 경로 이외의 비정상적 접근 차단.
    - **시스템 설정**: `.env` 및 설정 파일을 GUI를 통해 직관적으로 관리.

---

## 🚀 실행 단계

### 1. 백엔드 서버 실행
```bash
cd /home/inri/문서/web_os
node server/index.js
```
* 성공 시: `Web OS Server running on port 3000`

### 2. 프론트엔드 클라이언트 실행
```bash
cd /home/inri/문서/web_os/client
npm run dev
```
* 성공 시: 웹 브라우저를 통해 `http://localhost:5173` 접속

---

## 🧱 시스템 아키텍처 (Architecture)

시스템은 **Client-Server-OS**의 3계층 구조로 작동합니다.

1.  **Frontend (Client)**: 사용자의 입력을 받고 Socket.io/Fetch API를 통해 서버와 통신합니다.
2.  **Backend (Server)**: 비즈니스 로직(인증, 보안 검사)을 처리하며, 명령어를 OS에 전달합니다.
3.  **Local OS**: 실제 파일 시스템, 셸, 커널 리소스에 접근하여 데이터를 반환합니다.

---

## ⚠️ 경로 관리 보안 정책
보안을 위해 모든 파일 접근은 `.env`의 `ALLOWED_ROOTS` 설정에 따라 제한됩니다. 상위 디렉토리로의 비정상적 접근은 서버 단에서 즉시 차단됩니다.
