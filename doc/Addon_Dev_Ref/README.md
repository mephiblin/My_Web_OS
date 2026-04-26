# Addon Development Reference

Status: `[ACTIVE]`

This folder is the practical addon development reference pack for My Web OS.
It complements the broader reference docs:

- `doc/reference/addon-development-guide.md`
- `doc/reference/app-development-model.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/reference/community-registry-and-presets.md`

## Reading Order

For AI-assisted coding:

1. `AI_VIBE_CODING_GUIDE_EN.md`
2. `SDK_API_REFERENCE.md`
3. `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`
4. `SECURITY_LIMITS_AND_APPROVALS.md`
5. `PACKAGING_INSTALLATION_AND_TESTING.md`

For human developers:

1. `HUMAN_ADDON_GUIDE_KO.md`
2. `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`
3. `SDK_API_REFERENCE.md`
4. `SECURITY_LIMITS_AND_APPROVALS.md`
5. `PACKAGING_INSTALLATION_AND_TESTING.md`

## Current Addon Target

The preferred addon target is:

```text
Package app + sandbox-html runtime + manifest permissions + WebOS SDK
```

Default location:

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
  assets/
  vendor/
```

Current addon safety rule:

```text
Addon code may request capability.
The Web OS parent frame owns approval for risky host operations.
The backend enforces approval nonce, target hash, TTL, consume-once, and audit.
```

## File Map

- `AI_VIBE_CODING_GUIDE_EN.md`
  - Direct instructions for AI coding agents and vibe-coding workflows.
- `HUMAN_ADDON_GUIDE_KO.md`
  - Korean guide for human developers who want to build addons.
- `SDK_API_REFERENCE.md`
  - Current `window.WebOS` SDK methods, required permissions, examples, and limits.
- `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`
  - Manifest fields, permissions, file associations, and contribution points.
- `SECURITY_LIMITS_AND_APPROVALS.md`
  - Required safety model, forbidden patterns, current platform limits.
- `PACKAGING_INSTALLATION_AND_TESTING.md`
  - Development, ZIP import, Git registry, package doctor, smoke checks.

