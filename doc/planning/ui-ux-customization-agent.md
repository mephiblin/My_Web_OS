# UI/UX, Customization, Agent Direction

## UI Language
- 다크 글래스모피즘 기반
- 반투명 표면 + 소프트 보더 + 블루 액센트 유지
- 운영 도구는 장식보다 정보 밀도와 가독성 우선

## Desktop Structure
- `Desktop.svelte`: 레이어/윈도우 호스팅 오케스트레이션
- `Window.svelte`: 이동/리사이즈/포커스/스냅 책임
- 앱별 로직은 앱 모듈, 스토어, API helper로 분리

## Customization Foundation
권장 구현 순서:
1. Start Menu 기반
2. `desktopStore` 영속화
3. Taskbar 설정 모델
4. Window 기본값/앱별 스타일 모델
5. Control Panel 세부 섹션
6. Theme preset save/load
7. Desktop layout edit mode
8. Context menu customization

## Agent/CLI Principle
- Agent는 장식이 아니라 작업 보조자
- explanation -> summary -> approval -> execution -> result reporting 순서 준수
- 삭제/덮어쓰기/롤백/터미널 실행은 승인 카드 필수
