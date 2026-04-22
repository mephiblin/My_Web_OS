# 웹OS (Web OS) - 로컬 PC 관리 플랫폼

> [!WARNING]
> **보안 주의 및 면책 고지 (Disclaimer)**
> - 본 프로젝트는 현재 **개발 및 실험 단계**에 있으며, 보안 설정이 미비하여 외부 위협에 무방비하게 노출되어 있을 수 있습니다.
> - 본 소프트웨어의 사용으로 인해 발생하는 기기 오작동, 데이터 손실 등 모든 직간접적인 문제에 대해 개발자는 **일체의 책임을 지지 않습니다.**
> - 신뢰할 수 없는 환경이나 실제 운영 장비에서의 사용을 지양하고, 반드시 테스트 환경에서만 사용하시기 바랍니다.

로컬 PC의 파일 시스템, 터미널, 시스템 리소스를 웹 브라우저에서 제어할 수 있는 가상 데스크톱 환경입니다. Svelte 5와 Node.js를 기반으로 구현되었으며, 단순 파일 뷰어를 넘어 **파일/터미널/리소스 모니터링/로그/미디어/설정/샌드박스 앱**을 하나의 데스크톱 UX로 통합하는 것을 목표로 합니다.

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
- **Fs-extra**: 파일 시스템 유틸리티 및 인벤토리/샌드박스 저장소 관리.
- **Path Guard**: `ALLOWED_ROOTS` 설정을 기반으로 한 디렉토리 접근 제어.

---

## 🚀 주요 기능 (Key Features)

1.  **파일 스테이션 (File Station)**
    - **파일 제어**: 파일 및 폴더 생성, 읽기, 수정, 삭제(CRUD) 및 업로드.
    - **편집기**: Monaco Editor를 이용한 텍스트 및 코드 편집 기능 통합.
    - **인덱싱 검색**: `chokidar` 기반의 실시간 파일 인덱싱으로 대규모 폴더에서도 최적화된 재귀 검색 제공.
    - **공유 링크**: 파일 및 폴더에 대해 만료 시간이 포함된 보안 UUID 기반 공용 공유 링크 생성.
    - **휴지통 (Trash Bin)**: 실수로 삭제된 파일을 복구할 수 있는 격리 스토리지 운영.
    - **스마트 경로 감지**: 리눅스(XDG), 윈도우 환경에 따른 실제 시스템 폴더(문서, 다운로드 등) 자동 인식.

2.  **로그 센터 (Log Center)**
    - **중앙 집중식 로그 관리**: 시스템, 연결, 파일 전송, 샌드박스 이벤트 등 주요 이벤트를 범주별로 수집.
    - **심각도 레벨**: INFO, WARNING, ERROR 레벨 분류 및 시각화.
    - **대시보드**: 주간 활동 추이 차트 및 최근 24시간 에러 요약 제공.
    - **감사 추적**: 로그인, 시스템 변경, 앱 데이터 쓰기 등 운영 이력을 JSONL 로그로 저장.

3.  **터미널 (Terminal)**
    - 실제 PC의 셸(TTY)과 실시간 연동되어 명령어 실행 가능.
    - Xterm.js 및 Node-pty 기반의 안정적인 세션 유지.
    - 연결 종료 및 서버 종료 시 세션을 정리하는 Graceful Shutdown 지원.

4.  **리소스 모니터 (Resource Monitor)**
    - **실시간 대시보드**: CPU, GPU, 메모리 점유 상태 실시간 시각화.
    - **네트워크 모니터링**: 인터페이스별 트래픽 유동 상태 표시.
    - **위젯 연동**: 시스템 상태를 데스크톱 위젯과 앱 UI에서 함께 활용.

5.  **멀티태스킹 및 검색**
    - **Spotlight Search**: `Ctrl + Space` 단축키를 통한 시스템 전역 통합 검색 및 앱 실행.
    - **윈도우 관리**: 가장자리 드래그를 통한 지능형 창 분할 배치(Snapping) 및 애니메이션 적용.
    - **상태 저장**: 창 배치, 활성 창, 데스크톱 상태를 저장해 OS와 유사한 연속성 제공.

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

9.  **패키지 센터 (Package Center)**
    - **스토어/설치됨 분리 UI**: `Store`와 `설치됨` 카테고리 기반으로 앱 수명주기를 분리 관리.
    - **스토어 소스 등록**: GitHub/Raw URL 입력으로 레지스트리 소스를 추가/제거하고 목록을 동기화.
    - **스토어형 앱 목록**: 소스별 필터, 버전/설명/아이콘 표시, 원격 패키지 설치 지원.
    - **설치 앱 제어**: 설치된 패키지에 대해 `열기`, `중지`, `제거` 동작 제공.

10. **패키지 레지스트리 및 배포 파이프라인**
    - **레지스트리 API**: `/api/packages/registry/sources`, `/api/packages/registry`, `/api/packages/registry/install` 지원.
    - **설치 경로 통합**: source+package 기반 또는 직접 `zipUrl` 기반 설치를 공통 처리.
    - **가져오기/내보내기**: 패키지 ZIP import/export 및 clone 기반 워크플로우 제공.
    - **런타임 카탈로그**: `/api/packages/runtime/capabilities`로 샌드박스 권한/기능 기준 노출.

11. **샌드박스 앱 런타임 (Sandbox Runtime)**
    - **매니페스트 기반 앱 등록**: `manifest.json`을 읽어 데스크톱 앱 목록에 동적으로 병합.
    - **격리된 정적 자산 제공**: `/api/sandbox/:appId/...` 라우트를 통해 앱별 엔트리 및 자산 서빙.
    - **권한 기반 데이터 접근**: `app.data.list`, `app.data.read`, `app.data.write` 권한에 따라 앱 데이터 접근 제어.
    - **아이콘 메타 확장**: `iconType`/`iconUrl`을 통한 이미지 아이콘과 Lucide 아이콘 공통 처리.
    - **앱별 데이터 루트 분리**: 샌드박스 앱마다 독립된 데이터 저장 영역을 보유.

12. **서비스 및 설정 인프라 (Services & Config Foundation)**
    - **서비스 관리 API**: `/api/services`를 통해 내부 서비스 상태 조회 및 재시작 기반 제공.
    - **기본 설정 분리**: `server/config/defaults.json`으로 서버 및 시스템 기본값 분리 관리.
    - **설정 로더 모듈화**: `server/config/serverConfig.js`에서 환경 변수와 기본값을 통합 해석.
    - **인벤토리 경로 유틸리티**: 앱 ID 검증, 자산 경로 확인, 인벤토리 구조 생성 로직을 공통화.

---

## 🧱 시스템 구성 (Architecture Overview)

### **프로젝트 정체성과 철학**
- 본 프로젝트는 브라우저 안에서 로컬 PC를 제어하는 **웹 기반 운영 환경(Web OS)** 을 지향합니다.
- 여러 관리 기능을 앱 형태로 통합하고, 창 상태와 설정값을 저장해 **상태 중심 UX** 를 제공합니다.
- `node-pty`, `systeminformation`, `chokidar`, `rclone` 등 실제 OS 및 도구와 밀접하게 결합된 구조입니다.
- 기능 확장 속도를 우선하면서도, 점진적으로 보안 하드닝과 운영 안정성을 보완하는 방향을 가집니다.

### **프론트엔드**
- Svelte 기반 단일 앱에서 로그인 여부에 따라 `Login`과 `Desktop`을 분기합니다.
- Desktop은 앱 런처, 창 관리자, 위젯 계층, Spotlight, 컨텍스트 메뉴, 태스크바를 총괄합니다.
- 앱 컴포넌트를 ID 기반으로 동적 매핑하여 기본 앱 레지스트리와 샌드박스 앱을 같은 창 시스템으로 연결합니다.
- Package Center는 스토어 소스 관리, 원격 패키지 설치, 설치 앱 제어(`열기/중지/제거`)를 단일 UI에서 제공합니다.

### **백엔드**
- Express + Socket.io 구조로 HTTP API와 실시간 터미널/상태 스트림을 함께 제공합니다.
- 서비스 초기화 후 라우터를 `/api/fs`, `/api/system`, `/api/auth`, `/api/packages`, `/api/sandbox`, `/api/services` 등으로 분리합니다.
- `/api/packages`는 레지스트리 소스 관리, 원격 패키지 설치, import/export, manifest/파일 편집 API를 포함합니다.
- 종료 시 인덱서, PTY 세션, 내부 서비스 상태를 정리하는 graceful shutdown 로직을 포함합니다.

### **저장소 레이어**
- DB 대신 `server/storage` 아래 JSON/로그 파일을 사용하는 **파일 기반 영속화** 구조입니다.
- 앱 목록(`apps.json`), 인덱스(`index.json`), 감사 로그(`audit.log`), 각종 상태(`inventory/state_*.json`)를 직접 관리합니다.
- 샌드박스 앱은 `server/storage/inventory/apps/<app-id>` 구조로 저장되며, 매니페스트와 앱 자산을 함께 보관합니다.

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

### 2-1. Docker 실행 (Portability Profile)
`docker-compose.yml`은 다음 분리 원칙을 사용합니다.

- `webos_storage` 볼륨: Web OS 내부 상태/인벤토리 영속화 (`/app/server/storage`)
- 호스트 바인드 경로:
  - `./data -> /workspace/data`
  - `./media -> /workspace/media`
- `ALLOWED_ROOTS`는 컨테이너 내부 경로(`/workspace/data`, `/workspace/media`) 기준으로 설정

실행:
```bash
docker compose up --build -d
```

로그 확인:
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

중지:
```bash
docker compose down
```

### 3. 접속 정보
인스턴스가 실행되면 브라우저를 통해 다음 주소로 접속합니다.
- **주소**: `http://localhost:5173` (Vite 기본 포트)
- **기본 관리자 계정**: `.env`에 설정한 `ADMIN_USERNAME` 및 `ADMIN_PASSWORD` 사용.

### 4. 앱 추가 및 설치 방법
샌드박스 앱은 로컬 배치 방식과 스토어 설치 방식 둘 다 지원합니다.

#### 4-1. 로컬 샌드박스 앱 배치
`server/storage/inventory/apps/<app-id>/` 아래에 앱 폴더를 만들고 `manifest.json`과 엔트리 파일을 배치합니다.

예시 `manifest.json`:
```json
{
  "id": "hello-sandbox",
  "title": "Hello Sandbox",
  "version": "1.0.0",
  "entry": "index.html",
  "icon": {
    "type": "image",
    "src": "assets/icon.png"
  },
  "permissions": ["app.data.list", "app.data.read", "app.data.write"]
}
```

앱이 정상 배치되면 Package Center의 `설치됨` 목록에서 자동 감지되며, 데스크톱 창 안에서 샌드박스 프레임으로 실행됩니다.

#### 4-2. 스토어 소스 연결 후 설치
1. Package Center의 `Store` 카테고리에서 GitHub URL 또는 raw 레지스트리 URL을 입력합니다.
2. 저장 후 스토어 목록이 동기화되면 설치할 패키지를 선택해 `설치`를 실행합니다.
3. 설치 완료된 앱은 `설치됨` 카테고리에서 `열기`, `중지`, `제거`로 관리할 수 있습니다.

---

## 🔁 레거시 경로 마이그레이션 (P4)

배경화면/미디어 참조를 기존 직접 경로 방식에서 Media Library 표준 경로로 옮길 때는 아래 가이드를 사용하세요.

- [Media Library 마이그레이션 가이드](MEDIA_LIBRARY_MIGRATION.md)

핵심 기준:

- `image`/`video` 배경화면은 `/api/media-library-files/wallpapers/<filename>` 형식을 사용
- 로컬 절대경로, `/api/fs/raw?path=...` 같은 레거시 참조는 `Browse Local Files -> Import` 흐름으로 전환

---

## ⚠️ 현재 강점과 유의점

### **강점**
- **기능 통합도 높음**: 로컬 관리 작업 대부분을 단일 UI에서 수행 가능.
- **확장 구조가 단순명확**: 앱 레지스트리 + 컴포넌트 매핑 + 인벤토리 기반 앱 구조로 기능 확장이 쉬움.
- **실시간성 확보**: 터미널, 인덱싱, 리소스 모니터링, 로그 반영의 체감 반응이 좋음.
- **상태 영속화 UX**: 창/설정/위젯 상태를 저장하여 OS와 유사한 연속성을 제공.

### **유의점 및 기술 부채**
- **보안 하드닝 필요**: `helmet`, CORS allowlist, rate limit 세분화 등 추가 보완 여지 존재.
- **스토어 신뢰 정책 보강 필요**: 레지스트리 소스 allowlist/서명 검증/해시 검증 등 공급망 보안 고도화 필요.
- **파일 기반 저장 구조 한계**: 동시성, 백업, 무결성, 검색성 측면에서 장기적으로 DB 전환 검토 필요.
- **권한 모델 확장 필요**: 현재 관리자 중심 구조에서 향후 RBAC 및 다중 사용자 모델 확장이 필요.

---
