# Documentation Index

문서 상태와 우선순위를 함께 관리한다.

우선순위 규칙:

1. `AGENTS.md` + roadmap/product brief
2. active planning/reference docs
3. dated operations snapshot
4. archive/legacy docs

상태 라벨:

- `[ACTIVE]`: 현재 구현/운영 기준
- `[SNAPSHOT]`: 특정 날짜 기준 진행 메모
- `[COMPLETED]`: 완료 기록(운영 증적)
- `[LEGACY]`: 1회성 이관/하위호환 대응 문서
- `[ARCHIVED]`: 과거 참고용, 신규 작업 기준 아님

## Root Docs
- `[ACTIVE]` `AGENTS.md` (로드맵/작업 규약/검증 계약)
- `[ACTIVE]` `README.md` (개발/에이전트 기준)
- `[ACTIVE]` `USER_README.md` (사용자/운영자 기준)

## Addon Development
- `[ACTIVE]` `doc/Addon_Dev_Ref/README.md` (애드온 개발 레퍼런스 묶음)
- `[ACTIVE]` `doc/Addon_Dev_Ref/AI_VIBE_CODING_GUIDE_EN.md` (AI/vibe-coding용 영문 지침)
- `[ACTIVE]` `doc/Addon_Dev_Ref/HUMAN_ADDON_GUIDE_KO.md` (인간 개발자용 한국어 가이드)
- `[ACTIVE]` `doc/Addon_Dev_Ref/SDK_API_REFERENCE.md`
- `[ACTIVE]` `doc/Addon_Dev_Ref/MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`
- `[ACTIVE]` `doc/Addon_Dev_Ref/SECURITY_LIMITS_AND_APPROVALS.md`
- `[ACTIVE]` `doc/Addon_Dev_Ref/PACKAGING_INSTALLATION_AND_TESTING.md`

## Presets
- `[ACTIVE]` `doc/presets/AGENTS.preset.md` (AGENTS 실행 프리셋 복사본)
- `[ACTIVE]` `doc/presets/webos-store.preset.json` (커뮤니티 스토어 인덱스 프리셋)
- `[ACTIVE]` `doc/presets/package-manifest.preset.json` (패키지 manifest 프리셋)
- `[ACTIVE]` `doc/presets/ecosystem-template-catalog.preset.json` (런타임 카탈로그와 동기화되는 문서용 프리셋 복사본)
- `[ACTIVE]` `server/presets/ecosystem-template-catalog.json` (서버 런타임이 실제 로드하는 builtin 카탈로그)

## Planning
- `[ACTIVE]` `doc/planning/product-brief-home-server-remote-computer.md`
- `[ACTIVE]` `doc/planning/feature-inventory-home-server-remote-computer.md`
- `[ACTIVE]` `doc/planning/implementation-priority-plan.md`
- `[ACTIVE]` `doc/planning/real-use-remediation-plan.md`
- `[ACTIVE]` `doc/planning/roadmap-home-server-remote-computer.md`
- `[ACTIVE]` `doc/planning/project-identity-boundaries.md`
- `[ACTIVE]` `doc/planning/feature-scope-priorities.md`
- `[ACTIVE]` `doc/planning/ui-ux-customization-agent.md`
- `[ACTIVE]` `doc/planning/app-install-file-workflow-direction.md`
- `[ACTIVE]` `doc/planning/large-file-continuity-and-cloud-transfer-considerations.md`

## Operations
- `[ACTIVE]` `doc/operations/completed-backlog-log.md`
- `[ACTIVE]` `doc/operations/local-run-guide.md`
- `[ACTIVE]` `doc/operations/calendar-docker-porting-readiness.md`
- `[ACTIVE]` `doc/operations/remote-access-hardening-guide.md`
- `[ACTIVE]` `doc/operations/verification-gate-guide.md`
- `[ACTIVE]` `doc/operations/package-troubleshooting.md`
- `[SNAPSHOT]` `doc/operations/next-tasks-2026-04-25.md`
- `[COMPLETED]` `doc/operations/backup-restore-rehearsal-2026-04-25.md`
- `[COMPLETED]` `doc/operations/station-real-use-validation-2026-04-25.md`
- `[COMPLETED]` `doc/operations/runtime-stability-notes-2026-04-26.md`
- `[SNAPSHOT]` `doc/operations/home-server-readiness-review-2026-04-26.md`
- `[SNAPSHOT]` `doc/operations/acme-real-domain-validation-2026-04-25.md`

## Policies
- `[ACTIVE]` `doc/policies/file-station-places-policy.md`

## Migrations
- `[LEGACY]` `doc/migrations/media-library-path-migration.md`

## Reference
- `[ACTIVE]` `doc/reference/architecture-api-reference.md`
- `[ACTIVE]` `doc/reference/addon-development-guide.md`
- `[ACTIVE]` `doc/reference/app-development-model.md`
- `[ACTIVE]` `doc/reference/core-system-core-app-addon-boundaries.md`
- `[ACTIVE]` `doc/reference/package-ecosystem-guide.md`
- `[ACTIVE]` `doc/reference/community-registry-and-presets.md`
- `[ACTIVE]` `doc/reference/app-ownership-matrix.md`

## Archive
- `[ARCHIVED]` `doc/archive/README.md`
- `[ARCHIVED]` `doc/archive/reference/core-addon-separation-remediation.completed.md`
- `[ARCHIVED]` `doc/archive/operations/daily-log-2026-04-24.completed.md`
