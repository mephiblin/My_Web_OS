# Calendar Shared Standard v1

Status: `[ACTIVE]`

이 문서는 My Web OS의 공용 일정 데이터 계약 v1이다.
목표는 코어 캘린더, 위젯, 애드온이 같은 일정 데이터를 공유하도록 표준화하는 것이다.

## 1. Scope

v1 범위:

- 공용 일정 이벤트 스키마
- SDK 계약(`window.WebOS.calendar.*`)
- 권한 모델(`calendar.read`, `calendar.write`)
- 오류 응답 계약(`code`, `message`, `details`)

v1 비범위:

- Google/CalDAV/ICS 연동
- 반복 일정(RRULE)
- 알림 스케줄러/푸시
- 고급 충돌 병합 전략

## 2. Design Principles

- 일정의 단일 원천(SSOT)은 코어 캘린더 저장소다.
- 패키지/위젯은 자체 일정 DB를 만들지 않고 표준 API를 사용한다.
- 표준 계약은 안정적으로 유지하고, 확장은 비파괴적으로 진행한다.

## 3. Permission Model

| Permission | 설명 | 위험 |
| --- | --- | --- |
| `calendar.read` | 공용 일정 조회 | low |
| `calendar.write` | 공용 일정 생성/수정/삭제 | medium |

권한 규칙:

- 조회 전용 앱/위젯은 `calendar.read`만 선언한다.
- 생성/수정/삭제가 필요한 앱은 `calendar.write`를 추가 선언한다.
- `calendar.write`는 내부적으로 읽기 작업도 포함할 수 있으나, 명시적으로 `calendar.read`를 함께 선언하는 것을 권장한다.

## 4. Event Schema v1

### 4.1 Core Event Shape

```json
{
  "id": "c0e0d53f-1ec9-4e3e-9d17-bf7289a3f61a",
  "title": "Deploy window",
  "startAt": "2026-04-28T10:00:00.000Z",
  "endAt": "2026-04-28T11:00:00.000Z",
  "allDay": false,
  "color": "#34d399",
  "note": "Smoke check after deploy",
  "createdAt": 1777350450000,
  "updatedAt": 1777350480000
}
```

### 4.2 Field Contract

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | `string` | server-generated | UUID 권장, 최대 128자 |
| `title` | `string` | yes | trim 후 비어있으면 invalid, 최대 200자 |
| `startAt` | `string` | yes | ISO datetime parse 가능해야 함 |
| `endAt` | `string \| null` | no | ISO datetime 또는 `null`, 존재 시 `endAt >= startAt` |
| `allDay` | `boolean` | no | 기본값 `false` |
| `color` | `string` | no | 기본값 `#58a6ff`, 최대 20자 |
| `note` | `string \| null` | no | 최대 4000자, 비면 `null` |
| `createdAt` | `number` | server-managed | epoch milliseconds |
| `updatedAt` | `number` | server-managed | epoch milliseconds |

### 4.3 Time Rules

- v1의 canonical 저장 포맷은 ISO UTC 문자열이다.
- 클라이언트 입력은 local datetime이어도 되지만, API 전송 전에 ISO UTC로 정규화한다.
- all-day 이벤트도 `startAt`은 필수다.

## 5. SDK Contract v1

Sandbox addon은 `/api/sandbox/sdk.js`를 통해 `window.WebOS.calendar`를 사용한다.

### 5.1 Methods

| Method | Permission | Purpose |
| --- | --- | --- |
| `WebOS.calendar.list({ from?, to? })` | `calendar.read` | 범위 조회 |
| `WebOS.calendar.month({ year, month })` | `calendar.read` | 월 조회 |
| `WebOS.calendar.create(payload)` | `calendar.write` | 이벤트 생성 |
| `WebOS.calendar.update(eventId, patch)` | `calendar.write` | 이벤트 수정 |
| `WebOS.calendar.remove(eventId)` | `calendar.write` | 이벤트 삭제 |

### 5.2 Request/Response Shapes

`list`:

```js
const result = await WebOS.calendar.list({
  from: '2026-04-01T00:00:00.000Z',
  to: '2026-04-30T23:59:59.999Z'
});
// { success, data: Event[], total, lastUpdatedAt }
```

`month`:

```js
const result = await WebOS.calendar.month({ year: 2026, month: 4 });
// { success, data: Event[], total, range, lastUpdatedAt }
```

`create`:

```js
const created = await WebOS.calendar.create({
  title: 'Deploy window',
  startAt: '2026-04-28T10:00:00.000Z',
  endAt: '2026-04-28T11:00:00.000Z',
  allDay: false,
  color: '#34d399',
  note: 'Smoke check after deploy'
});
// { success, data: Event, lastUpdatedAt }
```

`update`:

```js
await WebOS.calendar.update('event-id', {
  title: 'Deploy window (updated)',
  endAt: '2026-04-28T11:30:00.000Z'
});
// { success, data: Event, lastUpdatedAt }
```

`remove`:

```js
await WebOS.calendar.remove('event-id');
// { success, data: { removedId }, lastUpdatedAt }
```

## 6. Error Contract v1

오류 응답 공통 shape:

```json
{
  "error": true,
  "code": "CALENDAR_EVENT_TITLE_REQUIRED",
  "message": "title is required.",
  "details": null
}
```

### 6.1 Shared/Platform Errors

| Code | Meaning |
| --- | --- |
| `APP_PERMISSION_DENIED` | 선언되지 않은 permission 호출 |
| `WEBOS_SDK_REQUEST_TIMEOUT` | SDK parent round-trip timeout |
| `HTTP_4xx`, `HTTP_5xx` | 비정형 upstream 오류 fallback |

### 6.2 Calendar Domain Errors

| Code | Meaning |
| --- | --- |
| `CALENDAR_RANGE_FROM_INVALID` | `from` 포맷 invalid |
| `CALENDAR_RANGE_TO_INVALID` | `to` 포맷 invalid |
| `CALENDAR_RANGE_INVALID` | `from > to` |
| `CALENDAR_MONTH_YEAR_INVALID` | `year` 범위 invalid |
| `CALENDAR_MONTH_VALUE_INVALID` | `month` 범위 invalid |
| `CALENDAR_EVENT_TITLE_REQUIRED` | `title` 누락/빈값 |
| `CALENDAR_EVENT_START_INVALID` | `startAt` invalid |
| `CALENDAR_EVENT_END_INVALID` | `endAt` invalid |
| `CALENDAR_EVENT_RANGE_INVALID` | `endAt < startAt` |
| `CALENDAR_EVENT_ID_REQUIRED` | `eventId` 누락 |
| `CALENDAR_EVENT_PATCH_EMPTY` | update patch가 비어 있음 |
| `CALENDAR_EVENT_NOT_FOUND` | 대상 이벤트 없음 |
| `CALENDAR_INTERNAL_ERROR` | 캘린더 서버 내부 오류 |

## 7. Addon Compliance Checklist v1

- manifest에 필요한 최소 권한만 선언했다.
- 일정 데이터는 코어 API를 통해서만 읽고 쓴다.
- 이벤트 식별자는 `id`를 사용하고 title/date 매칭 삭제를 하지 않는다.
- `err.code` 기반으로 사용자 메시지를 분기한다.
- `startAt/endAt`을 locale 문자열로 저장하지 않고 ISO로 다룬다.

## 8. Versioning Policy

- v1에서는 필드 추가는 허용하되, 기존 필드 제거/의미 변경은 금지한다.
- 브레이킹 변경은 `v2` 별도 문서로 정의한다.
- addon은 알 수 없는 추가 필드를 무시하도록 구현한다.
