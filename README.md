# 웹OS (Web OS) - 로컬 PC 관리 플랫폼

> [!WARNING]
> **보안 주의 및 면책 고지 (Disclaimer)**
> - 본 프로젝트는 현재 **개발 및 실험 단계**에 있으며, 보안 설정이 미비하여 외부 위협에 무방비하게 노출되어 있을 수 있습니다.
> - 본 소프트웨어의 사용으로 인해 발생하는 기기 오작동, 데이터 손실 등 모든 직간접적인 문제에 대해 개발자는 **일체의 책임을 지지 않습니다.**
> - 신뢰할 수 없는 환경이나 실제 운영 장비에서의 사용을 지양하고, 반드시 테스트 환경에서만 사용하시기 바랍니다.

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
- **Chokidar**: 파일 시스템 실시간 이벤트 감시 및 검색 인덱싱.
- **JWT (JSON Web Token)**: 사용자 인증 및 토큰 관리.
- **Bcryptjs**: 비밀번호 보안 처리.
- **Path Guard**: `ALLOWED_ROOTS` 설정을 기반으로 한 디렉토리 접근 제어.

---

## 🚀 주요 기능 (Key Features)

1.  **파일 스테이션 (File Station)**
    - **파일 제어**: 파일 및 폴더 생성, 읽기, 수정, 삭제(CRUD) 및 업로드.
    - **편집기**: Monaco Editor를 이용한 텍스트 및 코드 편집 기능 통합.
    - **인덱싱 검색**: `chokidar` 기반의 실시간 파일 인덱싱으로 대규모 폴더에서도 최적화된 재귀 검색 제공.
    - **공유 링크**: 파일 및 폴더에 대해 만료 시간이 포함된 보안 UUID 기반 공용 공유 링크 생성.
    - **휴지통 (Trash Bin)**: 실수로 삭제된 파일을 복구할 수 있는 격리 스토리지 운영.
    - **스마트 경로 감지**: 리우드(XDG), 윈도우 환경에 따른 실제 시스템 폴더(문서, 다운로드 등) 자동 인식.

2.  **로그 센터 (Log Center) - 신규**
    - **중앙 집중식 로그 관리**: 시스템, 연결, 파일 전송 등 모든 이벤트를 범주별로 수집.
    - **심각도 레벨**: INFO, WARNING, ERROR 레벨 분류 및 시각화.
    - **대시보드**: 주간 활동 추이 차트 및 최근 24시간 에러 요약 제공.
    - **고급 필터링**: 날짜, 범주, 키워드 기반의 전문 로그 검색.

3.  **터미널 (Terminal)**
    - 실제 PC의 셸(TTY)과 실시간 연동되어 명령어 실행 가능.
    - Xterm.js 및 Node-pty 기반의 안정적인 세션 유지.

4.  **리소스 모니터 (Resource Monitor)**
    - **실시간 대시보드**: CPU, GPU, 메모리 점유 상태 실시간 시각화.
    - **네트워크 모니터링**: 인터페이스별 트래픽 유동 상태 표시.

5.  **멀티태스킹 및 검색**
    - **Spotlight Search**: `Ctrl + Space` 단축키를 통한 시스템 전역 통합 검색 및 앱 실행.
    - **윈도우 관리**: 가장자리 드래그를 통한 지능형 창 분할 배치(Snapping) 및 애니메이션 적용.

6.  **통합 미디어 및 문서 뷰어**
    - **미디어 플레이어**: 비디오(자막 지원), 오디오, 고해상도 이미지 전용 통합 뷰어.
    - **3D 모델 뷰어**: FBX, GLTF, OBJ 모델 실시간 렌더링 및 자동 프레이밍.
    - **문서 뷰어**: PDF 전용 뷰어 탑재.

7.  **클라우드 스토리지 통합 (Cloud Integration)**
    - **rclone 연동**: `rclone` CLI를 통해 구글 드라이브 등 원격 저장소를 로컬 가상 경로(`cloud://`)로 연동.

8.  **시스템 제어 (System Control)**
    - **통합 제어판**: 배경화면(이미지/비디오), 글래스모피즘 테마 가변 설정, 유저 프로필 관리.
    - **보안 로그**: 로그인/로그아웃 및 주요 시스템 변경 이력 추적.
    - **안전한 종료 (Graceful Shutdown)**: 서버 종료 시 리소스 누수를 방지하는 안전 프로세스.

---

## 🚀 실행 및 설치 가이드 (Execution Guide)

### 📋 요구 사항
- **Node.js**: v18.0.0 이상 (v20 이상 권장)
- **Rclone**: 클라우드 저장소 연동을 위해 시스템에 설치 및 경로(Path) 설정 필요.
- **FFmpeg**: 미디어 파일의 썸네일 생성 및 인코딩 정보 추출을 위해 필요.
- **Smartmontools**: 리소스 모니터 내 스토리지 건강 상태(S.M.A.R.T) 조회를 위해 필요.

### 1. 환경 설정 (Environment Setup)
프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 다음 설정을 입력합니다.
```env
PORT=3000
JWT_SECRET=당신의_비밀키
ALLOWED_ROOTS=["/home/user/Documents", "/path/to/data"] # 접근 허용 디렉토리 배열
NODE_ENV=development
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
INITIAL_PATH=/home/user # 초기 탐색 경로
INDEX_DEPTH=5 # 파일 인덱싱 재귀 깊이
```

### 2. 의존 서비스 설치 및 실행

#### **백엔드 (Backend)**
```bash
# 루트 디렉토리에서 실행
npm install
node server/index.js
```

#### **프론트엔드 (Frontend)**
```bash
# 별도의 터미널에서 실행
cd client
npm install
npm run dev
```

### 3. 접속 정보
인스턴스가 실행되면 브라우저를 통해 다음 주소로 접속합니다.
- **주소**: `http://localhost:5173` (Vite 기본 포트)
- **기본 관리자 계정**: `.env`에 설정한 `ADMIN_USERNAME` 및 `ADMIN_PASSWORD` 사용.

---
