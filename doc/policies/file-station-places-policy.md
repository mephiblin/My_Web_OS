# File Station Places Policy (Windows/Ubuntu)

## Goal
설치 직후 File Station이 즉시 실사용 가능하도록 `Places` 노출/연결 기준을 정의한다.

## Core Rules
- 기본적으로 `Desktop`, `Documents`, `Downloads` 접근 가능해야 한다.
- `Home`은 사용자 홈 루트다.
  - Windows: `C:\Users\<user>`
  - Ubuntu: `/home/<user>`
- `Desktop`은 Home 하위의 별도 작업 표면으로 노출한다.
- Places에 보이는 항목은 실제로 열려야 하며, 클릭 시 `403`은 버그로 간주한다.

## Default Places
- Home
- Desktop
- Documents
- Downloads
- Pictures
- Music
- Videos

## Runtime Policy
- `ALLOWED_ROOTS`가 비어 있거나 레거시 단일값이면 Places 기준 기본 루트를 자동 보정한다.
- `INITIAL_PATH` 기본값은 `Documents`, 부재 시 `Home` 폴백.
- 각 Places는 `/api/fs/list` 기준으로 실제 탐색 가능해야 한다.

## Verification
- `GET /api/fs/user-dirs`가 Home/Desktop/Documents/Downloads 유효 경로 반환
- 각 Places 경로에 대해 `GET /api/fs/list?path=...` 성공
- `Home`과 `Desktop` 의미 분리가 유지됨
