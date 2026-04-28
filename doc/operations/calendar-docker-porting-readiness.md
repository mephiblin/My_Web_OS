# Calendar Docker Porting Readiness

Status: `[ACTIVE]`

This note documents what Docker, Compose, and remote deployments must preserve
for the Calendar provider model.

The current Calendar integration has:

- local Web OS events stored in the inventory state
- default Korea public holiday source `holidays-kr`
- Nager.Date as the default no-auth holiday provider
- cache file `server/storage/inventory/system/calendar-holidays.json`
- future source slots for CalDAV and Google Calendar

## 1. Default Holiday Source

`holidays-kr` is the default read-only public holiday source.

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

It fetches:

```text
https://date.nager.at/api/v3/PublicHolidays/{year}/KR
```

Calendar month/event APIs merge this source unless filtered:

```text
GET /api/system/calendar/month?year=2026&month=4
GET /api/system/calendar/month?year=2026&month=4&sources=local
GET /api/system/calendar/month?year=2026&month=4&sources=local,holidays-kr
```

## 2. Docker Requirements

The backend container needs outbound HTTPS access for holiday provider fetches.

Minimum outbound target:

```text
date.nager.at:443
```

Current `docker-compose.yml` and `docker-compose.hardened.yml` do not define a
restricted network egress policy, so this works in ordinary Docker installs as
long as the host itself has internet access.

If a future deployment adds a firewall, custom Docker network policy, outbound
proxy, or no-internet profile, document one of these choices:

- allow backend egress to `date.nager.at:443`
- disable the `holidays-kr` source
- replace `provider: "nager"` with a local/offline provider
- pre-seed `calendar-holidays.json` into the inventory volume

## 3. Persistent State

Calendar provider cache and local events must survive container rebuilds.

The existing compose volume already covers this:

```yaml
volumes:
  - webos_storage:/app/server/storage
```

Important files inside that volume:

```text
/app/server/storage/inventory/system/calendar.json
/app/server/storage/inventory/system/calendar-holidays.json
```

Do not mount these as read-only unless the calendar is intentionally running in
a read-only demo mode. The backend writes local events, source config, and
holiday cache.

## 4. Future Compose Environment Knobs

The current implementation stores source config through the Calendar source API.
For Docker portability, future compose profiles may expose these optional env
knobs:

```yaml
environment:
  WEBOS_CALENDAR_DEFAULT_COUNTRY: "KR"
  WEBOS_CALENDAR_HOLIDAY_PROVIDER: "nager"
  WEBOS_CALENDAR_HOLIDAY_ENABLED: "true"
  HTTPS_PROXY: "${HTTPS_PROXY:-}"
  NO_PROXY: "${NO_PROXY:-127.0.0.1,localhost,backend,frontend}"
```

These env knobs are not required by the current code yet. They are reserved
names for the next portability pass.

## 5. CalDAV And Google Calendar Readiness

Google Calendar read-only sync is implemented. CalDAV remains
registry/scaffold-ready but not fully implemented.

When porting these providers to Docker:

- keep OAuth tokens, app passwords, and refresh tokens out of public source
  config responses
- mount secret storage under the same persistent backend volume or a dedicated
  secret volume
- require outbound HTTPS from backend to the chosen CalDAV or Google endpoints
- support proxy env variables if the deployment runs behind a corporate/home
  proxy
- make read-only sync the first Docker-supported mode

Google Calendar needs these persistent files inside the backend inventory
volume:

```text
server/storage/inventory/system/calendar-google-secrets.json
server/storage/inventory/system/calendar-sync-state.json
```

The Google OAuth redirect URI must point at the externally reachable backend
callback route:

```text
https://your-webos.example/api/system/calendar/google/auth/callback
```

Source examples:

```json
{
  "id": "nextcloud-main",
  "type": "caldav",
  "config": {
    "serverUrl": "https://cloud.example/remote.php/dav",
    "username": "user",
    "calendarUrl": "",
    "syncEnabled": true,
    "syncDirection": "readOnly"
  }
}
```

```json
{
  "id": "google-primary",
  "type": "google",
  "config": {
    "calendarId": "primary",
    "syncEnabled": true,
    "syncDirection": "readOnly"
  }
}
```

Secret fields must be configured through a separate trusted flow, not directly
through public source JSON.

## 6. Verification

After Compose starts, check backend health:

```bash
docker compose ps
docker compose logs --tail=80 backend
```

Check the holiday provider from inside the backend container:

```bash
docker compose exec backend node - <<'NODE'
const svc = require('./server/services/calendarHolidayService');
svc.getHolidayEvents({ year: 2026, countryCode: 'KR', provider: 'nager', sourceId: 'holidays-kr' })
  .then((result) => {
    console.log({ total: result.total, cacheState: result.cacheState });
  })
  .catch((err) => {
    console.error(err.code || err.name, err.message);
    process.exit(1);
  });
NODE
```

Expected result:

```text
total > 0
cacheState is fresh, fallback, or stale depending on provider/cache state
```

Then confirm the HTTP API:

```bash
curl -H "Authorization: Bearer <token>" \
  "http://127.0.0.1:3000/api/system/calendar/month?year=2026&month=4&sources=holidays-kr"
```

The response should include read-only holiday events with:

```json
{
  "source": "holidays-kr",
  "sourceType": "holiday",
  "readOnly": true,
  "provider": "nager",
  "calendarId": "KR"
}
```
