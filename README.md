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

2.  **터미널 (Terminal)**
    - 실제 PC의 셸과 실시간 연동되어 명령어 실행 가능.
    - Xterm.js 및 Node-pty 기반의 안정적인 세션 유지.

3.  **리소스 모니터 (Resource Monitor)**
    - CPU 사용량, 프로세스 및 메모리 점유 상태 실시간 확인.
    - GPU 사용량 및 네트워크(IP) 정보 트래킹 지원.

4.  **보안 및 설정 (Security & Settings)**
    - **인증**: JWT 기반의 로그인 시스템.
    - **경로 보안**: 지정된 최상위 경로(ALLOWED_ROOTS) 이외의 접근 차단.
    - **환경 설정**: `.env` 파일 및 JSON 기반 설정에 대한 GUI 편집 지원.

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
