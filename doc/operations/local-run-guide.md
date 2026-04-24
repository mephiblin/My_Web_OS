# Local Run Guide

Web OS는 백엔드와 프론트엔드 두 프로세스를 함께 실행해야 정상 동작한다.

## Backend
- 위치: 프로젝트 루트
- 실행:
```bash
npm install
node server/index.js
```
- 기본 포트: `3000`

## Frontend
- 위치: `client/`
- 실행:
```bash
cd client
npm install
npm run dev
```
- 기본 포트: `5173`

## Access
- 브라우저: `http://localhost:5173`
- 로그인: `.env`의 `ADMIN_USERNAME`, `ADMIN_PASSWORD`

## Quick Health Check
```powershell
netstat -ano | findstr ":3000"
netstat -ano | findstr ":5173"
```
`LISTENING`이면 정상.

## Stop
- 포그라운드: `Ctrl + C`
- 백그라운드:
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "server/index.js|vite" } | Select-Object ProcessId,Name,CommandLine
Stop-Process -Id <PID> -Force
```
