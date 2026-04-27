# Addon Dev Ref

Status: `[ACTIVE]`

이 폴더는 My Web OS 패키지/애드온을 독립 개발하기 위한 standalone reference pack이다. 목표는 프로젝트 전체 소스 없이도 이 폴더만 보고 다음 작업을 할 수 있게 하는 것이다.

- 작은 sandbox UI 애드온 개발
- 파일 뷰어/에디터/런처형 애드온 개발
- Plex, Immich, downloader 같은 로컬 서비스형 hybrid tool package 개발
- ZIP 패키징, Package Center 설치, preflight, 백업/롤백 흐름 이해
- SDK, manifest, 권한, 보안 경계 확인

## 핵심 모델

My Web OS 패키지는 크게 다섯 갈래로 나뉜다.

| 종류 | 사용처 | 런타임 | Launcher 표시 |
| --- | --- | --- | --- |
| `app` | 일반 UI 애드온, 뷰어, 에디터 | `sandbox-html` | 예 |
| `widget` | 데스크톱 위젯 | `sandbox-html` | 보통 위젯 영역 |
| `service` | UI 없는 백그라운드 로컬 서비스 | `process-node`, `process-python`, `binary` | 아니오 |
| `hybrid` | sandbox UI + 로컬 관리 서비스 | UI는 `sandbox-html`, 서비스는 managed process | UI가 있으면 예 |

V1의 중요한 전제:

- `sandbox-html`은 브라우저 iframe 안에서 격리되는 작은 UI 애드온 경로다.
- `process-node`, `process-python`, `binary`는 신뢰한 로컬 패키지용 native process 경로다.
- native process 패키지는 OS 레벨로 완전 격리되지 않는다.
- Docker 격리와 패키지별 폴더 grant는 V1 이후 확장이다.
- Package Center는 위험 권한, 런타임, healthcheck, backup, rollback 영향을 설치 전에 보여줘야 한다.

## 읽는 순서

처음 만드는 경우:

1. `QUICKSTART_FIRST_ADDON_KO.md`
2. `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`
3. `SDK_API_REFERENCE.md`
4. `PACKAGING_INSTALLATION_AND_TESTING.md`

Plex/Immich/downloader급 툴을 만드는 경우:

1. `QUICKSTART_HYBRID_TOOL_KO.md`
2. `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`
3. `SDK_API_REFERENCE.md`
4. `SECURITY_LIMITS_AND_APPROVALS.md`
5. `PACKAGE_LIFECYCLE_AND_DISTRIBUTION.md`

배포/업데이트/롤백까지 확인하는 경우:

1. `PACKAGE_LIFECYCLE_AND_DISTRIBUTION.md`
2. `PACKAGING_INSTALLATION_AND_TESTING.md`
3. `SECURITY_LIMITS_AND_APPROVALS.md`

전체 설계 감각이 필요한 경우:

1. `HUMAN_ADDON_GUIDE_KO.md`
2. `CORE_INTEGRATION_MAP.md`

## 패키지 루트 구조

독립 개발자는 아래 구조를 하나의 패키지 루트로 보면 된다.

```text
my-package/
  manifest.json
  index.html                  # sandbox app이면 기본 entry
  ui/index.html               # hybrid UI entry 예시
  service/index.js            # Node service 예시
  service/main.py             # Python service 예시
  assets/
  vendor/
  README.md
```

ZIP 배포 시에는 `manifest.json`이 ZIP 루트에 있거나, ZIP 안에 단일 폴더가 있고 그 안에 `manifest.json`이 있으면 된다.

```text
my-package.zip
  manifest.json
  ui/index.html
  service/index.js
```

또는:

```text
my-package.zip
  my-package/
    manifest.json
    ui/index.html
    service/index.js
```

## 직접 개발 경로

프로젝트 repo 안에서 빠르게 테스트할 때는 inventory에 직접 둘 수 있다.

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
```

하지만 독립 배포 기준은 ZIP/registry 설치다. 직접 inventory 편집은 Package Center의 install/update approval, backup, rollback 흐름을 우회한다.

## Package Center에서 기대되는 것

설치/가져오기/preflight 화면은 최소한 다음을 보여줘야 한다.

- package id, title, version
- package type: `app`, `widget`, `service`, `hybrid`, `developer`
- runtime type, command, entry
- hybrid UI entry와 service entry
- permissions
- `allowedRoots` 접근 여부
- network permission
- service autoStart, restartPolicy, healthcheck
- backup/rollback 영향
- lifecycle approval typed confirmation

## 파일 목록

- `QUICKSTART_FIRST_ADDON_KO.md`: 가장 작은 sandbox UI 애드온 만들기
- `QUICKSTART_HYBRID_TOOL_KO.md`: Node/Python 서비스가 붙은 hybrid tool package 만들기
- `QUICKSTART_FIRST_ADDON_EN.md`: English quickstart for a small sandbox addon
- `HUMAN_ADDON_GUIDE_KO.md`: 전체 개발 판단 가이드
- `MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`: manifest, runtime, permission 계약
- `SDK_API_REFERENCE.md`: `window.WebOS` SDK 계약
- `CORE_INTEGRATION_MAP.md`: launcher, sandbox, service bridge, File Station 연동 지도
- `SECURITY_LIMITS_AND_APPROVALS.md`: 보안 경계, 승인, native process 신뢰 모델
- `PACKAGE_LIFECYCLE_AND_DISTRIBUTION.md`: Package Center 설치/업데이트/ZIP/registry/백업/롤백
- `PACKAGING_INSTALLATION_AND_TESTING.md`: 패키징과 테스트 체크리스트

## V1 완료 기준 요약

이 폴더의 계약을 따르는 hybrid package는 다음이 가능해야 한다.

- Package Center template 또는 ZIP import로 설치 가능
- sandbox UI와 managed Node/Python service를 함께 포함
- service start/stop/restart/log/event/health 확인 가능
- UI가 `WebOS.service.request()`로 자기 service 호출 가능
- service가 `WEBOS_APP_DATA_DIR`, `WEBOS_ALLOWED_ROOTS_JSON`, `WEBOS_SERVICE_PORT`를 env로 받음
- update/import 전 backup/rollback 영향이 preflight에 표시됨
- 삭제 시 runtime이 중지되고 package-owned runtime 등록이 제거됨
