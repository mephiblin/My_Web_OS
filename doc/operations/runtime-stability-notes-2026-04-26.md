# Runtime Stability Notes - 2026-04-26

Status: `[COMPLETED]` runtime stability and documentation sync snapshot.

## Scope

This snapshot records the post-package-runtime stability pass for local development and user testing.

Layers:

- Web Desktop
- Sandbox / Package
- Remote Computer UX
- Home Server Operations
- Docs / Verification

## Changes Recorded

### 1. Sandbox Loading

- `server/static/webos-sandbox-sdk.js` now repeats `webos:ready` briefly until context arrives.
- `client/src/core/components/SandboxAppFrame.svelte` now keeps the loading overlay until bridge readiness or explicit timeout.
- Timeout path surfaces `SANDBOX_BRIDGE_READY_TIMEOUT` instead of silent infinite loading.

Why:

- A sandbox iframe can load before the parent listener/context handoff is fully ready.
- Repeating the ready signal makes the bridge tolerant to timing races without changing app UX.

### 2. System Polling Stability

- `/api/system/overview` now uses short TTL cache and concurrent refresh coalescing.
- `/api/system/network-ips` now uses cache and a shorter external IP lookup timeout.

Why:

- Resource widgets and monitor screens can request overview data repeatedly.
- Direct repeated `systeminformation` calls caused avoidable latency and could delay app package assets.

### 3. Terminal Reconnection

- Terminal backend emits `terminal:ready` after PTY creation.
- Terminal frontend waits for readiness before forwarding input.
- Terminal PTY env now has UTF-8 fallbacks for `LANG`, `LC_ALL`, and `TERM`.
- Korean output was verified through a socket/PTY smoke test.

Important boundary:

- Backend restart kills existing PTY/local shell sessions.
- Reconnect/open creates a new shell; previous terminal process state is not recoverable.

### 4. Broken UI Text Cleanup

Corrupted UI text was replaced in:

- Resource Monitor temperature/network labels
- Docker Manager status line
- Media Player subtitle label
- Log Viewer rename arrow

## Runtime Files Policy

The following are local/generated runtime state and should not be committed:

- `server/storage/index.json`
- `server/storage/media-library/`
- `storage/rehearsal-backups/`
- `.playwright-mcp/`

The following inventory fixtures remain intentionally trackable:

- `server/storage/inventory/system/apps.json`
- `server/storage/inventory/apps/hello-sandbox/`
- `server/storage/inventory/apps/doc-viewer/`
- `server/storage/inventory/apps/editor/`
- `server/storage/inventory/apps/model-viewer/`

## Verification

Commands run:

```bash
node --check server/routes/system.js
node --check server/services/terminal.js
node --check server/static/webos-sandbox-sdk.js
node --test server/tests/sandbox-sdk-contract.test.js
npm test
cd client && npm run build
npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json
```

Smoke checks run:

```bash
node -e "fetch('http://127.0.0.1:3000/health').then(r=>{console.log('backend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
node -e "fetch('http://127.0.0.1:5173').then(r=>{console.log('frontend',r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Observed:

- `npm test`: 62 tests passed.
- Client build passed.
- Package doctor completed with `fails=0`, with existing builtin registry warnings for system apps without file associations/station allowlist entries.
- Terminal socket/PTY Korean output smoke passed.
- Backend and frontend health checks passed.

## Remaining Operational Notes

- Existing terminal windows should be reopened after backend restart.
- Large Monaco/Three chunks remain expected first-use cost.
- If app loading still stalls, check package entry script load errors before changing app UX.
