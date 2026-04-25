#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-.env.hardened}"
VOLUME_NAME_OVERRIDE="${2:-}"
BACKUP_DIR="${3:-$ROOT_DIR/storage/rehearsal-backups}"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="webos_storage_${STAMP}.tar.gz"
MARKER_PATH="/vol/rehearsal/marker.txt"
ORIGINAL_MARKER="backup-before-${STAMP}"
MUTATED_MARKER="backup-after-${STAMP}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"

mkdir -p "$BACKUP_DIR"

echo "[1/6] Starting hardened stack..."
docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.hardened.yml" up -d --build

if [[ -n "$VOLUME_NAME_OVERRIDE" ]]; then
  VOLUME_NAME="$VOLUME_NAME_OVERRIDE"
else
  VOLUME_NAME="$(docker volume ls \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
    --filter "label=com.docker.compose.volume=webos_storage" \
    --format '{{.Name}}' | head -n 1)"
fi

if [[ -z "${VOLUME_NAME:-}" ]]; then
  echo "[ERROR] Could not resolve webos_storage docker volume name." >&2
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.hardened.yml" down
  exit 1
fi

echo "[2/6] Writing marker into volume $VOLUME_NAME..."
docker run --rm -v "${VOLUME_NAME}:/vol" alpine sh -lc \
  "mkdir -p /vol/rehearsal && printf '%s' '$ORIGINAL_MARKER' > $MARKER_PATH"

echo "[3/6] Creating backup archive $ARCHIVE_NAME..."
docker run --rm -v "${VOLUME_NAME}:/vol" -v "${BACKUP_DIR}:/backup" alpine sh -lc \
  "cd /vol && tar -czf /backup/${ARCHIVE_NAME} ."
docker run --rm -v "${BACKUP_DIR}:/backup" alpine sh -lc \
  "chown ${HOST_UID}:${HOST_GID} /backup/${ARCHIVE_NAME} || true"

echo "[4/6] Mutating marker to simulate drift..."
docker run --rm -v "${VOLUME_NAME}:/vol" alpine sh -lc \
  "printf '%s' '$MUTATED_MARKER' > $MARKER_PATH"

echo "[5/6] Restoring backup archive..."
docker run --rm -v "${VOLUME_NAME}:/vol" -v "${BACKUP_DIR}:/backup" alpine sh -lc \
  "find /vol -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf /backup/${ARCHIVE_NAME} -C /vol"

RESTORED_MARKER="$(docker run --rm -v "${VOLUME_NAME}:/vol" alpine sh -lc "cat $MARKER_PATH")"
if [[ "$RESTORED_MARKER" != "$ORIGINAL_MARKER" ]]; then
  echo "[ERROR] Restore validation failed: expected '$ORIGINAL_MARKER', got '$RESTORED_MARKER'" >&2
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.hardened.yml" down
  exit 1
fi

echo "[6/6] Restore validation passed."
echo "archive=${BACKUP_DIR}/${ARCHIVE_NAME}"
echo "marker_before=${ORIGINAL_MARKER}"
echo "marker_after_restore=${RESTORED_MARKER}"

docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.hardened.yml" down
