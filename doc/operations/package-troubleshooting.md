# Package Troubleshooting

> Status: `[ACTIVE]` package install/runtime 운영 트러블슈팅 가이드.

This document lists common package install/runtime issues and quick recovery actions.

## 1. Preflight Blocked

Symptoms:

- `executionReadiness.ready = false`
- blockers in `qualityGate`, `dependencyCompatibility`, or `lifecycleSafeguards`

Actions:

1. Re-run `POST /api/packages/registry/preflight`
2. Fix blocker messages in order:
   - manifest/runtime errors
   - dependency/version mismatch
   - policy/lifecycle safeguard blockers

## 2. Runtime Fails To Start

Symptoms:

- runtime status `error` or repeated recover events

Actions:

1. Check runtime events/logs in Package Center Ops Console
2. Validate `runtime.type` and `runtime.entry`
3. Re-run package health check endpoint:
   - `GET /api/packages/:id/health`

## 3. Rollback Blocked

Symptoms:

- `POST /api/packages/:id/rollback/preflight` returns blockers

Actions:

1. Ensure backup snapshot exists
2. Stop active runtime if needed
3. Resolve lifecycle safeguard blockers
4. Retry rollback

## 4. Permission Denied In Sandbox

Symptoms:

- `APP_PERMISSION_DENIED`
- sandbox approval prompt denies method

Actions:

1. Add explicit permission in package manifest
2. Reinstall/update package
3. Confirm capability appears in `/api/sandbox/:appId/capabilities`

## 5. SDK Compatibility Issue

Symptoms:

- app bridge rejects version

Actions:

1. Query `GET /api/system/app-api-policy?clientVersion=<x.y.z>`
2. Align app client version with `minimumSupportedVersion` and major compatibility rules

## 6. Sandbox App Stays Loading

Symptoms:

- window opens but package UI remains on loading
- `SANDBOX_BRIDGE_READY_TIMEOUT`
- app entry says it is waiting for file/context

Actions:

1. Confirm package entry includes `/api/sandbox/sdk.js`
2. Confirm the entry calls or waits for `window.WebOS.ready()`
3. Check browser console for SDK/script load errors
4. Check backend route availability:
   - `GET /api/sandbox/sdk.js`
   - `GET /api/sandbox/:appId/capabilities`
5. If file context is required, confirm File Station issued a valid grant.

## 7. Terminal Disconnected

Symptoms:

- terminal shows disconnected
- input no longer reaches local shell
- backend was restarted or crashed

Actions:

1. Confirm backend is running:
   - `GET /health`
2. Close the old terminal window and open Terminal again.
3. Treat the new connection as a new local shell; previous PTY state is not recovered after backend restart.
4. If Korean output appears broken, check host locale/font availability; server sets UTF-8 terminal env fallback, but the browser still needs a font with Korean glyphs.
