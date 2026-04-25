# Media Library Migration Guide

> Status: `[LEGACY]` one-time migration guide. 기존 wallpaper/media 경로 데이터를 가진 설치에서만 필요하며, 신규 설치는 보통 불필요하다.

기존 wallpaper/media 레거시 경로 참조를 Media Library 표준 경로로 이관할 때 사용하는 운영 가이드.

## Target Scope
- `settings.wallpaperType`
- `settings.wallpaper`
- `settings.wallpaperId`
- `settings.wallpaperFit`
- UI: `Control Panel > Personalization > Media Library`

## Standard Reference
- `wallpaper`: `/api/media-library-files/wallpapers/<filename>`
- `wallpaperId`: `<filename>`
- `css` 타입은 gradient 문자열 그대로 사용

## Legacy Patterns To Replace
1. 로컬 절대 경로 직접 참조
2. `/api/fs/raw?path=...` 직접 참조
3. inventory 내부 경로 직접 참조
4. 임시/수동 URL 고정 참조

## Recommended Procedure
1. `Control Panel > Personalization` 이동
2. `My Images` 또는 `My Videos` 선택
3. `Browse Local Files`로 파일 선택
4. `Import to Media Library`로 복사
5. 갤러리 항목 선택 후 적용
6. 저장값이 `/api/media-library-files/wallpapers/...`인지 확인

## Error Codes
### `POST /api/system/wallpapers/import`
- `MEDIA_LIBRARY_INVALID_SOURCE_PATH`
- `MEDIA_LIBRARY_SOURCE_FORBIDDEN`
- `MEDIA_LIBRARY_SOURCE_SYSTEM_PROTECTED`
- `MEDIA_LIBRARY_SOURCE_NOT_FOUND`
- `MEDIA_LIBRARY_SOURCE_NOT_FILE`
- `MEDIA_LIBRARY_UNSUPPORTED_EXTENSION`
- `MEDIA_LIBRARY_IMPORT_FAILED`

### `POST /api/system/wallpapers/upload`
- `MEDIA_LIBRARY_UPLOAD_FILE_REQUIRED`
- `MEDIA_LIBRARY_UNSUPPORTED_EXTENSION`
- `MEDIA_LIBRARY_UPLOAD_FAILED`
