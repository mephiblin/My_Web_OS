# Security, Limits, And Approval Rules

Status: `[ACTIVE]`

This file defines the practical safety boundary for addon development.

## Core Security Model

```text
Addon asks for capability.
Parent Web OS frame owns trusted UI and approval.
Backend enforces permission, target, nonce, target hash, TTL, consume-once, and audit.
```

An addon is not trusted to approve its own risky Host operation.

## Host File Access

Host file access requires:

1. declared permission
2. valid File Station/file grant
3. backend path validation
4. app/user/grant match
5. operation-specific approval when needed

Read:

```js
await WebOS.files.read({ path, grantId });
```

Write:

```js
await WebOS.files.write({ path, grantId, content, overwrite: true });
```

## Overwrite Approval

For existing host files, overwrite is high-risk.

Correct flow:

1. Addon calls `WebOS.files.write({ overwrite: true })`.
2. Backend returns approval-required preflight when needed.
3. Parent Web OS frame shows typed-confirm approval dialog.
4. User types the confirmation in trusted parent UI.
5. Parent calls backend approve endpoint.
6. Parent retries write with scoped approval evidence.
7. Backend consumes nonce once and validates target hash.

Forbidden:

```js
await WebOS.files.approveWrite();
fetch('/api/sandbox/my-addon/file/write/approve');
```

Forbidden:

```json
{
  "approval": {
    "approved": true
  }
}
```

## Raw Tickets

Raw file URLs are bearer-style access. They must be short-lived tickets, not
grant URLs.

Correct:

```js
const ticket = await WebOS.files.rawTicket({ path, grantId, profile: 'preview' });
const url = WebOS.files.rawUrl(ticket);
```

Forbidden:

```js
WebOS.files.rawUrl({ path, grantId });
```

Legacy sandbox raw grant endpoint is disabled with:

```text
SANDBOX_RAW_GRANT_URL_DISABLED
```

## Data Boundaries

App data:

```text
server/storage/inventory/data/<app-id>/
```

Host files:

```text
allowed roots managed by Host/file APIs
```

Do not confuse app data with host file access.

## Current Platform Limits

Sandbox is browser sandboxing, not VM/kernel isolation.

Current limitations:

- No native OS/kernel isolation for addon code.
- No public-internet security claim by default.
- Backend restart can invalidate pending approval state.
- Long-running transfer/backup behavior still benefits from real-use observation.
- `backgroundServices` are metadata only until lifecycle/approval execution policy exists.
- `settingsPanels` are metadata/validation first; full launch UX is later.
- Browser click-through automation is not yet a full coverage gate.

## Risk Classification

Low risk:

- UI-only utility
- app-owned data only
- notification-only addon

Medium risk:

- reads granted host files
- opens raw preview tickets
- contributes File Station preview actions

High risk:

- writes granted host files
- overwrites existing host files
- package lifecycle changes
- background execution proposals
- system/terminal/docker operations

High-risk changes require backend contract and focused tests.

## Bad Pattern Checklist

Search before finishing:

```bash
rg -n "approveWrite|approved: true|rawUrl\\(\\{ path, grantId \\}\\)" \
  client/src/apps/addons server/storage/inventory/apps server/routes/packages.js
```

Also check system self-confirmation regressions:

```bash
rg -n "typedConfirmation: .*expectedConfirmation|typedConfirmation: .*preflight\\?\\.approval" \
  client/src/apps/system
```

These patterns should not appear in production addon/system paths.

## Human Review Questions

Before merging an addon:

1. Does it request only necessary permissions?
2. Does it show clear missing-grant state?
3. Does it avoid direct backend approval calls?
4. Does it avoid raw grant URLs?
5. Does it handle SDK startup failure visibly?
6. Does Package Center install/update/remove behavior remain valid?
7. Does it keep feature code out of core desktop/window files?

