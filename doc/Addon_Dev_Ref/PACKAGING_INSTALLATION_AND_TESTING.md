# Packaging, Installation, And Testing

Status: `[ACTIVE]`

## Development Modes

### Direct Inventory Development

Best for quick local work.

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
```

Run:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
```

Then open the app from the Web OS launcher or File Station if file associations
apply.

### Built-In Addon Package Source

For built-in addon replacements, keep both source and runtime copy aligned:

```text
client/src/apps/addons/<addon>/package/
server/storage/inventory/apps/<app-id>/
```

This is currently used by package-first addon replacements such as:

- `doc-viewer`
- `model-viewer`
- `editor`

### ZIP Import

The zip root should contain:

```text
manifest.json
index.html
assets/
vendor/
```

Package Center import should:

- read manifest during preflight
- show lifecycle risks
- require approval for overwrite/update when needed
- create backup before replacing installed package files
- preserve rollback evidence

### Git Registry

Recommended for distributable addons.

Repository contents:

```text
webos-store.json
releases/<addon>.zip
```

The store index points to package zip artifacts.
See:

```text
doc/reference/community-registry-and-presets.md
doc/presets/webos-store.preset.json
doc/presets/package-manifest.preset.json
```

## Verification Commands

Narrow addon manifest check:

```bash
npm run package:doctor -- --manifest=server/storage/inventory/apps/<app-id>/manifest.json
```

Sandbox contract:

```bash
node --test --test-concurrency=1 server/tests/sandbox-sdk-contract.test.js
```

Package template/lifecycle checks when changing templates or install flows:

```bash
node --test --test-concurrency=1 server/tests/package-personal-templates.integration.test.js
node --test --test-concurrency=1 server/tests/package-lifecycle-approval-contract.test.js
```

UI smoke:

```bash
npm run verify:ui-smoke
```

Client build:

```bash
npm --prefix client run build
```

Full release gate:

```bash
npm run verify
git diff --check
```

## Manual Addon Smoke

Use this checklist for any non-trivial addon:

1. Launch from desktop/start/launcher.
2. Confirm app shows ready state, not blank iframe.
3. Open without launch data and confirm clear missing-context message.
4. Open from File Station with matching file association.
5. Confirm host file read works only with grant.
6. Confirm raw preview uses ticket URL when needed.
7. Confirm host write works only with write grant.
8. Confirm overwrite triggers parent-owned approval.
9. Deny approval and confirm addon handles failure.
10. Approve overwrite and confirm file content changes as expected.
11. Close and reopen addon.
12. Remove/reinstall or update through Package Center.

## Packaging Acceptance Checklist

Manifest:

- `id` stable
- `title` clear
- `version` set
- `runtime.type` is `sandbox-html`
- `runtime.entry` exists
- permissions minimal
- file associations match real behavior

Runtime:

- `index.html` includes `/api/sandbox/sdk.js`
- waits for `WebOS.ready()`
- visible loading/ready/error states
- no native risky `confirm()` / `prompt()`
- no direct backend approval calls

Host access:

- handles missing grant
- uses `WebOS.files.read()` for reads
- uses `rawTicket()` and `rawUrl(ticket)` for raw preview
- uses `WebOS.files.write({ overwrite: true })` for overwrite writes
- never calls `approveWrite()`

Package lifecycle:

- package doctor passes
- ZIP import preflight passes
- update/overwrite creates backup
- rollback path is visible
- uninstall removes stale file associations

## Troubleshooting

Blank iframe:

- Check manifest `runtime.entry`.
- Check SDK script path.
- Check browser console.
- Check that startup catches errors and renders them.

Permission denied:

- Add missing manifest permission only if truly needed.
- Confirm File Station provided grant.
- Confirm grant path matches file path.

Overwrite failed:

- Confirm `overwrite: true`.
- Confirm user typed parent approval.
- Retry after stale target/expired approval.

Raw preview failed:

- Confirm `rawTicket()` succeeded.
- Confirm `rawUrl(ticket)` received ticket object.
- Confirm ticket did not expire.

Package install failed:

- Run package doctor.
- Check manifest shape.
- Check zip root layout.
- Check Package Center preflight details.

