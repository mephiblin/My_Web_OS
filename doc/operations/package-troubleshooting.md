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
