# Web OS 서버 실행 안내 (How to Start)

Web OS는 클라이언트(프론트엔드)와 서버(백엔드) 두 가지 프로세스를 모두 실행해야 정상적으로 동작합니다. 각각의 환경에 맞게 서버를 띄워주세요.

## 1. 백엔드 (Backend) 실행

가상 파일 시스템, 터미널 세션 유지, 리소스 모니터링 등을 담당하는 Node.js 백엔드 서버입니다.

- **실행 위치**: 프로젝트 루트  
  예: `C:\Users\mephi\Documents\GitHub\My_Web_OS`
- **실행 명령어**:
  ```bash
  npm install
  node server/index.js
  ```
- **기본 접속 포트**: `3000`
- **정상 로그 예시**:
  - `Web OS Server running on port 3000`
  - `[INDEX] Loaded ... entries`
  - `[SHARE] Initialized DB`

---

## 2. 프론트엔드 (Frontend) 실행

Svelte 5 및 Vite 기반의 웹 OS 데스크톱 UI 렌더링 서버입니다.

- **실행 위치**: `client` 폴더  
  예: `C:\Users\mephi\Documents\GitHub\My_Web_OS\client`
- **실행 명령어**:
  ```bash
  cd client
  npm install
  npm run dev
  ```
- **기본 접속 포트**: `5173`
- **정상 로그 예시**:
  - `VITE ... ready in ... ms`
  - `Local: http://localhost:5173/`

---

## 3. 웹사이트 접속

프론트엔드와 백엔드가 모두 정상적으로 실행되었다면, 웹 브라우저를 열고 프론트엔드 로컬 주소로 접속합니다.

- **브라우저 접속 주소**: [http://localhost:5173](http://localhost:5173)

> **참고 (로그인 정보)**  
> 기본 로그인 계정은 최상단 디렉토리의 `.env` 파일에 정의된 `ADMIN_USERNAME`과 `ADMIN_PASSWORD` 값으로 로그인하실 수 있습니다. Default 값이 지정되어 있지 않다면 설정을 먼저 확인해 주세요.

---

## 4. 실행 확인 (권장)

PowerShell에서 포트 리스닝으로 확인:

```powershell
netstat -ano | findstr ":3000"
netstat -ano | findstr ":5173"
```

둘 다 `LISTENING`이면 정상 실행 상태입니다.

---

## 5. 백그라운드 실행 시 로그 파일

백그라운드 실행으로 띄운 경우, 아래 로그 파일을 확인하면 됩니다.

- 백엔드:
  - `server.run.out.log`
  - `server.run.err.log`
- 프론트:
  - `client.run.out.log`
  - `client.run.err.log`

최근 실행 확인 기준:

- 백엔드 포트: `3000` 리스닝 확인
- 프론트 포트: `5173` 리스닝 확인
- 백엔드 로그: `Web OS Server running on port 3000` 확인
- 프론트 로그: `Local: http://localhost:5173/` 확인

---

## 6. 프로세스 중지

포그라운드 실행이면 `Ctrl + C`로 종료합니다.

백그라운드 실행이면 PID 확인 후 종료:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "server/index.js|vite" } | Select-Object ProcessId,Name,CommandLine
Stop-Process -Id <PID> -Force
```
