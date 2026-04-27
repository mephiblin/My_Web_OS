# Package Lifecycle And Distribution

Status: `[ACTIVE]`

이 문서는 Package Center 설치, ZIP import, registry distribution, backup, rollback, runtime lifecycle 계약을 설명한다.

## 1. 개발/배포 방식

| 방식 | 용도 | 특징 |
| --- | --- | --- |
| Direct inventory | 빠른 로컬 테스트 | Package Center approval/backup을 우회함 |
| Package Center template | 새 패키지 scaffold | preflight와 품질 체크 포함 |
| ZIP import | 독립 배포/수동 설치 | manifest preflight, approval, backup/rollback |
| Registry install | store/source 기반 설치 | HTTP(S) index + ZIP artifact |
| Local workspace bridge | 개발 편의용 연결 메타데이터 | inventory package가 canonical |

## 2. ZIP 구조

허용 구조 1: manifest가 ZIP 루트에 있음.

```text
my-package.zip
  manifest.json
  index.html
  assets/
```

허용 구조 2: ZIP 안에 단일 package folder가 있음.

```text
my-package.zip
  my-package/
    manifest.json
    ui/index.html
    service/index.js
```

피할 것:

- 여러 manifest 포함
- 여러 package root 포함
- 빌드 캐시/소스맵/불필요한 node_modules 포함
- secret, token, local config 포함

## 3. Package Center preflight

설치 전 Package Center는 다음을 확인해야 한다.

- manifest shape
- package id 충돌
- runtime profile
- UI entry/service entry 존재
- permissions
- tool package review
- dependency/compatibility
- lifecycle safeguards
- backup/rollback plan
- local workspace bridge 영향

Tool Package review에는 다음이 포함된다.

- runtime type
- runtime command
- service entry
- hybrid UI entry
- `runtime.process`
- `service.bridge`
- `service.http.enabled`
- healthcheck
- network permission
- allowedRoots access
- app data access

## 4. Lifecycle approval

설치/업데이트/rollback/manifest update는 scoped approval을 사용한다.

개념 흐름:

```text
preflight
  -> user reviews risk
  -> user types confirmation in Package Center
  -> backend creates scoped approval
  -> operation executes with approval evidence
  -> approval nonce is consumed once
```

Approval evidence 예시:

```json
{
  "approval": {
    "operationId": "op_...",
    "nonce": "nonce_...",
    "targetHash": "sha256:..."
  }
}
```

금지:

```json
{ "approved": true }
```

## 5. Backup and rollback

Overwrite/update 전에는 기존 package files를 backup snapshot으로 보존해야 한다.

Rollback 기대 동작:

- 선택한 backup snapshot을 현재 package files에 복원
- manifest/runtime/permission 변화가 다시 반영
- 필요 시 runtime을 중지하고 다시 시작 가능
- 이벤트/감사 로그에 rollback이 남음

패키지 개발자가 해야 할 일:

- app data migration을 backward-compatible하게 설계
- manifest version을 명확히 올림
- service startup이 이전 app data를 읽어도 crash하지 않게 처리
- healthcheck로 rollback 후 상태 확인 가능하게 함

## 6. Runtime lifecycle

Managed package는 Package Center installed console에서 다음을 제공해야 한다.

- start
- stop
- restart
- logs
- runtime events
- status
- health
- recover/retry
- backup
- rollback
- delete

Service manifest의 lifecycle 필드:

```json
{
  "service": {
    "autoStart": false,
    "restartPolicy": "on-failure",
    "maxRetries": 3,
    "restartDelayMs": 1000,
    "http": { "enabled": true }
  }
}
```

Restart policies:

| Policy | 의미 |
| --- | --- |
| `never` | 자동 재시작 안 함 |
| `on-failure` | 비정상 종료 시 재시작 |
| `always` | 종료 시 재시작 |

## 7. Registry index 예시

Registry source는 HTTP(S) JSON으로 제공할 수 있다.

```json
{
  "packages": [
    {
      "id": "media-tool",
      "title": "Media Tool",
      "version": "0.1.0",
      "description": "Hybrid media library tool.",
      "zipUrl": "https://example.com/packages/media-tool-0.1.0.zip",
      "permissions": ["runtime.process", "service.bridge"],
      "runtimeType": "process-node",
      "appType": "hybrid"
    }
  ]
}
```

Package Center는 registry package를 가져와 preflight한 뒤 install/update approval을 요구한다.

## 8. Versioning

권장:

- `0.x`: 실험/내부 개발
- `1.0.0`: manifest, app data schema, service API가 안정화된 첫 릴리즈
- patch: bugfix
- minor: backward-compatible feature
- major: breaking manifest/data/service API change

## 9. Release checklist

- `manifest.json`에 정확한 type/runtime/permissions가 있다.
- `package:doctor`가 통과한다.
- ZIP root가 정상이다.
- Package Center ZIP preflight가 blocker 없이 통과한다.
- update 전 backup이 생성된다.
- rollback 후 service start와 healthcheck가 성공한다.
- `WebOS.service.request()` 또는 sandbox SDK 사용 경로가 정상이다.
