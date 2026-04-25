# Roadmap - Personal Home Server And Remote Computer

이 로드맵은 My Web OS를 개인 단위 Home Server & Remote Computer 플랫폼으로 발전시키기 위한 순서다.

우선순위는 다음 기준으로 정한다.

1. 데이터 손실과 Host 위험을 줄이는가
2. 원격 운영 신뢰성을 높이는가
3. Package Center를 실제 앱 제작/운영 콘솔로 만드는가
4. 작은 앱 생태계를 검증하는가
5. Home Server / NAS형 경험을 강화하는가

## R0. 문서, 테스트, 릴리즈 안정화

목표:

- 현재 구현 상태와 문서 상태를 맞춘다.
- A10 이후 발견된 회귀 위험을 테스트로 고정한다.
- 커밋/배포 시 깨질 수 있는 파일 추적 문제를 정리한다.

범위:

- `A11. Test Isolation And Regression Coverage`.
- cloud upload validation regression test.
- backup policy nonexistent app behavior test.
- backup job cancellation race test.
- transfer error normalization test.
- sandbox postMessage clone safety test.
- direct multi-file `node --test` isolation 원인 정리.
- `server/routes/ai.js`, `server/services/aiActionService.js` 같은 untracked runtime dependency 추적 여부 확정.
- generated storage file commit policy 정리.
- `doc/operations/next-tasks-2026-04-25.md`를 현재 backlog 기준으로 갱신.
- architecture/package reference 문서 최신화.

완료 기준:

- `npm test` 통과.
- 필요한 focused test가 추가됨.
- README, AGENTS, doc planning/reference가 현재 상태와 충돌하지 않음.
- 커밋 시 서버 import가 깨지지 않는 파일 추적 상태.

## R1. Remote Computer 신뢰성 강화

목표:

- 원격 브라우저에서 개인 PC를 안정적으로 조작할 수 있게 한다.

범위:

- 세션/로그인/토큰 만료 UX 개선.
- 원격 접속을 전제로 한 CORS/helmet/rate-limit 설정 점검.
- Terminal 위험 명령 승인 UX 고도화.
- File Station read/write/overwrite/delete approval 흐름 정리.
- 작업 실패 시 recovery action 제공.
- audit log 검색/필터 강화.
- allowed root 상태와 grant 상태를 UI에서 더 명확하게 표시.

완료 기준:

- 원격 접속 상태에서 파일/터미널/시스템 조작의 실패 원인을 사용자가 이해할 수 있음.
- 위험 동작은 조용히 실행되지 않음.
- audit trail이 작업 단위로 남음.

## R2. Home Server 운영 콘솔 강화

목표:

- NAS/홈랩 운영에 필요한 상태, 로그, 백업, Docker, 서비스 제어를 하나의 흐름으로 묶는다.

범위:

- Service Dashboard.
- Server Monitor.
- Log Analyzer.
- Backup Manager.
- Docker Manager health/log/volume/port UX 정리.
- backup job scheduling 실행기.
- backup retention/schedule policy UI 고도화.
- cloud upload provider-side 완료 확인 또는 보수적 완료 표시.

완료 기준:

- 홈서버 상태, 서비스 상태, Docker 상태, 로그, 백업 상태를 Package Center/운영 앱에서 연결해서 볼 수 있음.
- 백업 실패/성공/복구 지점이 명확히 표시됨.

## R3. Package Center를 앱 제작 작업대로 확장

목표:

- Package Center가 앱 목록이 아니라 "앱을 만들고 운영하는 작업대"가 되게 한다.

범위:

- 새 패키지 생성.
- template 선택.
- manifest 편집.
- 파일 트리 편집.
- preview.
- 실행.
- clone.
- export.
- delete.
- package quality gate.
- app/widget/hybrid package capability 표시.

추천 template:

- Empty HTML app.
- Memo app.
- Widget.
- Server Monitor.
- Markdown editor.
- Python experimental template.

완료 기준:

- 사용자가 Package Center에서 작은 sandbox app을 만들고 실행하고 내보낼 수 있음.
- 생성된 앱의 권한, data root, backup, lifecycle이 Package Center에 표시됨.

## R4. 1차 개인 앱 생태계

목표:

- 자주 쓰는 작은 앱으로 package/sandbox/app-data 흐름을 검증한다.

우선순위:

1. Memo
2. Todo
3. Bookmark Manager
4. Calculator
5. Clipboard History

완료 기준:

- 각 앱은 package 또는 package-ready 구조를 가진다.
- app-owned data 저장을 사용한다.
- 필요한 경우 widget mode를 제공한다.
- Package Center에서 install/run/backup/export 흐름을 확인할 수 있다.

## R5. NAS형 Station 앱

목표:

- 개인 홈서버의 파일/미디어/다운로드 경험을 Synology-like station 앱으로 확장한다.

우선순위:

1. Download Station
2. Photo Station
3. Music Station
4. Document Station
5. Video Station

완료 기준:

- File Station, Transfer Manager, Media Player, Document Viewer와 중복되지 않고 역할이 분리됨.
- Station 앱은 라이브러리/분류/검색/최근 항목 중심 UX를 제공함.
- 대용량 파일과 원격 접근을 전제로 실패/재시도/상태 표시가 있음.

## R6. 개발자 도구와 Remote Workstation

목표:

- 원격 컴퓨터로서 개발과 문서 작업을 실제로 처리할 수 있게 한다.

후보:

- Markdown Preview.
- JSON Formatter.
- API Tester.
- Snippet Vault.
- CSV Viewer.
- Text Processor.
- Code Editor save/open flow 고도화.

완료 기준:

- README, manifest, JSON, API 테스트 같은 일상 개발 작업을 Web OS 안에서 처리할 수 있음.
- File Station Open With와 save/overwrite approval 흐름이 자연스럽게 연결됨.

## R7. Automation / Agent

목표:

- 개인 서버 운영 작업을 Agent가 설명, 계획, 승인, 실행, 보고하도록 만든다.

범위:

- 승인 카드 UX 고도화.
- file/system/docker/package action proposal.
- execution result summary.
- 실패 시 recovery suggestion.
- audit log 연결.
- 반복 작업 자동화.

완료 기준:

- Agent가 위험 작업을 조용히 실행하지 않음.
- 사용자는 실행 전 영향 범위와 rollback 가능성을 볼 수 있음.
- 실행 결과가 Package Center/Logs/Audit와 연결됨.

## R8. Remote Access / Home Server 배포 모델

목표:

- 집 안과 외부에서 안전하게 접근 가능한 개인 서버 배포 형태를 정리한다.

범위:

- Docker Compose production-like profile.
- reverse proxy guide.
- HTTPS/TLS guide.
- admin password/bootstrap guide.
- backup/restore guide.
- allowed roots hardening guide.
- remote access threat model.

완료 기준:

- 개인 홈서버에 설치할 때 필요한 최소 보안/운영 문서가 있음.
- 외부 노출 시 금지/권장 설정이 명확함.

## 실행 순서 요약

```text
R0 현재 상태 안정화
-> R1 Remote Computer 신뢰성
-> R2 Home Server 운영 콘솔
-> R3 Package Center 앱 제작 작업대
-> R4 작은 개인 앱 생태계
-> R5 NAS형 Station 앱
-> R6 개발자 도구 / Remote Workstation
-> R7 Automation / Agent
-> R8 Remote Access 배포 모델
```

## 바로 다음 작업

1. R5 Station 실사용 검증(대용량 root 수동 증적) 마감.
2. R8 실도메인 ACME 발급 최종 증적(외부 80/443, `https://<domain>/health` 200) 확보.
3. 코어는 feature-freeze 기준으로 bugfix/security/perf만 유지하고, 신규 가치는 앱 생태계(R4~R6 확장)로 집중.
