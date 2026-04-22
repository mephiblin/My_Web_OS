# Media Library 마이그레이션 가이드 (Legacy wallpaper/media path)

이 문서는 기존 배경화면/미디어 경로 참조를 현재 Media Library 모델로 옮길 때 사용하는 운영 가이드다.

## 1) 대상 범위

- 설정 키: `settings.wallpaperType`, `settings.wallpaper`, `settings.wallpaperId`, `settings.wallpaperFit`
- UI 흐름: `Control Panel > Personalization > Media Library`
- 관련 API:
  - `GET /api/system/wallpapers/list`
  - `POST /api/system/wallpapers/upload`
  - `POST /api/system/wallpapers/import`
  - 정적 파일 서빙: `GET /api/media-library-files/wallpapers/:filename`

## 2) 현재 표준 참조 형식

배경화면이 `image` 또는 `video`인 경우, 표준 참조는 아래와 같다.

- `wallpaper`: `/api/media-library-files/wallpapers/<filename>`
- `wallpaperId`: `<filename>`

`css` 타입은 기존처럼 gradient 문자열을 그대로 사용한다.

## 3) 레거시 참조 패턴 (마이그레이션 권장 대상)

아래 패턴이 보이면 Media Library로 이전하는 것을 권장한다.

1. 로컬 절대 경로 직접 참조
   - 예: `C:\Users\...\image.png`, `/home/.../wallpaper.jpg`
2. 파일 시스템 raw API 직접 참조
   - 예: `/api/fs/raw?path=...`
3. Inventory/내부 경로를 직접 바라보는 참조
4. 과거 임시 URL/수동 URL을 배경화면에 고정한 경우

## 4) 권장 마이그레이션 절차 (UI)

1. `Control Panel > Personalization`으로 이동
2. 배경 소스를 `My Images` 또는 `My Videos`로 선택
3. `Browse Local Files`로 파일 선택
4. 자동으로 `Import to Media Library` 경로를 통해 라이브러리에 복사
5. 갤러리에서 항목 선택 후 적용
6. 저장된 상태에서 `wallpaper`가 `/api/media-library-files/wallpapers/...` 형태인지 확인

## 5) 권장 마이그레이션 절차 (API/운영 스크립트)

인증 토큰이 있다고 가정한다.

```bash
# 1) 현재 설정 확인
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/system/state/settings

# 2) 로컬 파일을 Media Library로 import
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourcePath":"C:\\\\Users\\\\me\\\\Pictures\\\\bg.png","kind":"image"}' \
  http://localhost:3000/api/system/wallpapers/import

# 3) 응답 item.url/item.id를 settings에 반영
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "wallpaperType":"image",
    "wallpaper":"/api/media-library-files/wallpapers/bg-20260422-abc123.png",
    "wallpaperId":"bg-20260422-abc123.png",
    "wallpaperFit":"cover"
  }' \
  http://localhost:3000/api/system/state/settings
```

## 6) 에러 코드 대응

`POST /api/system/wallpapers/import` 기준:

- `MEDIA_LIBRARY_INVALID_SOURCE_PATH`: 소스 경로 누락/형식 오류
- `MEDIA_LIBRARY_SOURCE_FORBIDDEN`: 허용 루트(`ALLOWED_ROOTS`) 바깥 경로
- `MEDIA_LIBRARY_SOURCE_SYSTEM_PROTECTED`: 시스템 보호 경로 접근
- `MEDIA_LIBRARY_SOURCE_NOT_FOUND`: 소스 파일 없음
- `MEDIA_LIBRARY_SOURCE_NOT_FILE`: 디렉토리 입력 등 파일 아님
- `MEDIA_LIBRARY_UNSUPPORTED_EXTENSION`: 확장자 미지원
- `MEDIA_LIBRARY_IMPORT_FAILED`: 기타 import 실패

`POST /api/system/wallpapers/upload` 기준:

- `MEDIA_LIBRARY_UPLOAD_FILE_REQUIRED`: 파일 누락
- `MEDIA_LIBRARY_UNSUPPORTED_EXTENSION`: 확장자 미지원
- `MEDIA_LIBRARY_UPLOAD_FAILED`: 기타 업로드 실패

## 7) 운영 체크리스트

1. UI 적용 후 바탕화면이 정상 렌더링되는지 확인
2. `settings.wallpaper`가 표준 URL(`/api/media-library-files/...`)인지 확인
3. 레거시 직접경로가 남아 있는 preset/사용자 상태가 없는지 확인
4. 실패 시 에러 코드를 사용자에게 그대로 노출해 복구 경로 안내

## 8) 롤백 원칙

- 마이그레이션은 파일 원본을 즉시 삭제하지 않고 복사(import) 기반으로 수행한다.
- 적용 실패 시 `settings` 값을 이전 스냅샷으로 되돌린다.
- 운영 환경에서는 일괄 마이그레이션 전에 상태 백업을 권장한다.
