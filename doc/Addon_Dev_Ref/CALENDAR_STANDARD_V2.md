# Calendar Shared Standard v2

Status: `[ACTIVE]`

This document extends `CALENDAR_STANDARD_V1.md` with calendar sources and
provider-backed read-only events.

V2 keeps the v1 event fields stable and adds non-breaking metadata so the core
calendar API can merge local events, public holidays, and future sync providers.

## 1. Scope

V2 includes:

- source registry model
- read-only provider events
- public holiday provider contract
- Google Calendar read-only OAuth sync
- source filtering for event reads
- safe placeholders for CalDAV sync providers

V2 does not yet include:

- full CalDAV sync implementation
- two-way external calendar writes
- recurring event expansion
- notification scheduling

## 2. Event Metadata Additions

V2 events may include these fields:

```json
{
  "source": "local",
  "sourceType": "local",
  "readOnly": false,
  "externalId": null,
  "provider": null,
  "calendarId": "local"
}
```

Field rules:

| Field | Meaning |
| --- | --- |
| `source` | source id such as `local` or `holidays-kr` |
| `sourceType` | `local`, `holiday`, `caldav`, or `google` |
| `readOnly` | true when the event cannot be changed through local CRUD |
| `externalId` | provider-owned event identity |
| `provider` | provider adapter name such as `nager` |
| `calendarId` | provider calendar id or country code |

Local user-created events must be stored as:

```json
{
  "source": "local",
  "sourceType": "local",
  "readOnly": false,
  "calendarId": "local"
}
```

Provider events should be returned as read-only unless a future provider has an
explicit two-way sync contract.

## 3. Source Registry

Calendar sources are stored in the core calendar state and exposed through:

```text
GET /api/system/calendar/sources
POST /api/system/calendar/sources
PUT /api/system/calendar/sources/:id
DELETE /api/system/calendar/sources/:id
POST /api/system/calendar/sources/:id/sync
```

Source shape:

```json
{
  "id": "holidays-kr",
  "title": "KR Public Holidays",
  "type": "holiday",
  "enabled": true,
  "readOnly": true,
  "color": "#ef4444",
  "config": {
    "countryCode": "KR",
    "provider": "nager"
  },
  "lastSyncedAt": null,
  "lastError": null
}
```

Supported `type` values:

| Type | Status |
| --- | --- |
| `local` | active |
| `holiday` | active, read-only |
| `caldav` | registry/scaffold only |
| `google` | active, read-only sync |

Secret fields such as passwords, app passwords, OAuth access tokens, and refresh
tokens must not be stored in the public source config.

## 4. Public Holidays

The default holiday provider is Nager.Date.

Default source:

```json
{
  "id": "holidays-kr",
  "title": "KR Public Holidays",
  "type": "holiday",
  "enabled": true,
  "readOnly": true,
  "config": {
    "countryCode": "KR",
    "provider": "nager"
  }
}
```

`holidays-kr` means:

- `id`: stable source id used by source filters and event metadata
- `title`: default visible label for Korea public holidays
- `type`: `holiday`, so events are read-only provider events
- `config.countryCode`: `KR`
- `config.provider`: `nager`
- upstream API: `https://date.nager.at/api/v3/PublicHolidays/{year}/KR`

Holiday events are fetched by year and country, then cached in:

```text
server/storage/inventory/system/calendar-holidays.json
```

If the provider request fails and a previous cache exists, the API may return
the cached data with provider status `fallback`.

Deployments that run in Docker, behind a firewall, or through a strict outbound
proxy must allow backend egress to `date.nager.at` or provide a future alternate
holiday provider. See `doc/operations/calendar-docker-porting-readiness.md`.

## 5. Event Read Filtering

The existing read APIs remain:

```text
GET /api/system/calendar/events
GET /api/system/calendar/month
```

Both support optional source filtering:

```text
?sources=local
?sources=holiday
?sources=local,holidays-kr
```

Without a filter, active local and provider sources are merged.

## 6. Google Calendar Read-Only Sync

Google Calendar is implemented as a read-only sync provider.

Google source example:

```json
{
  "id": "google-primary",
  "title": "Google Calendar",
  "type": "google",
  "enabled": true,
  "readOnly": true,
  "color": "#4285f4",
  "config": {
    "calendarId": "primary",
    "syncEnabled": true,
    "syncDirection": "readOnly"
  }
}
```

OAuth client settings and tokens are stored outside public source state:

```text
server/storage/inventory/system/calendar-google-secrets.json
```

Incremental sync state is stored in:

```text
server/storage/inventory/system/calendar-sync-state.json
```

Google routes:

```text
GET /api/system/calendar/google/config
PUT /api/system/calendar/google/config
GET /api/system/calendar/google/auth/start
GET /api/system/calendar/google/auth/callback
POST /api/system/calendar/google/disconnect
POST /api/system/calendar/google/sync
```

`auth/callback` is validated by signed OAuth state because Google redirects to
the backend without the Web OS bearer token. Other Google management routes
remain authenticated.

Google events are converted to read-only provider events:

```json
{
  "source": "google-primary",
  "sourceType": "google",
  "readOnly": true,
  "provider": "google",
  "calendarId": "primary",
  "externalId": "google-event-id"
}
```

If Google returns `410 Gone`, the backend drops the stale sync token and runs a
full source resync. `403` and `429` failures are stored as retryable source
errors with a backoff timestamp.

## 7. CalDAV Placeholder

CalDAV source records may be created now, but sync endpoints return
`CALENDAR_SYNC_PROVIDER_NOT_IMPLEMENTED` until the CalDAV provider service is
implemented.
