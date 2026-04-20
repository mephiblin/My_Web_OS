# Web OS 서버 실행 안내 (How to Start)

Web OS는 클라이언트(프론트엔드)와 서버(백엔드) 두 가지 프로세스를 모두 실행해야 정상적으로 동작합니다. 각각의 환경에 맞게 서버를 띄워주세요.

## 1. 백엔드 (Backend) 실행

가상 파일 시스템, 터미널 세션 유지, 리소스 모니터링 등을 담당하는 Node.js 백엔드 서버입니다.

- **실행 위치**: 프로젝트 최상위 폴더 (`/home/inri/문서/web_os`)
- **실행 명령어**:
  ```bash
  npm install
  node server/index.js
  ```
- **기본 접속 포트**: `3000` (API 및 Socket.io 통신 로컬 주소, 터미널 로그에는 `Web OS Server running on port 3000`으로 표시됩니다)

---

## 2. 프론트엔드 (Frontend) 실행

Svelte 5 및 Vite 기반의 웹 OS 데스크톱 UI 렌더링 서버입니다. 

- **실행 위치**: `client` 서브 폴더 (`/home/inri/문서/web_os/client`)
- **실행 명령어**:
  ```bash
  cd client
  npm install
  npm run dev
  ```
- **기본 접속 포트**: `5173` (Vite 기본 포트)

---

## 3. 웹사이트 접속

프론트엔드와 백엔드가 모두 정상적으로 실행되었다면, 웹 브라우저를 열고 프론트엔드 로컬 주소로 접속합니다.

- **브라우저 접속 주소**: [http://localhost:5173](http://localhost:5173)

> **참고 (로그인 정보)**  
> 기본 로그인 계정은 최상단 디렉토리의 `.env` 파일에 정의된 `ADMIN_USERNAME`과 `ADMIN_PASSWORD` 값으로 로그인하실 수 있습니다. Default 값이 지정되어 있지 않다면 설정을 먼저 확인해 주세요.
