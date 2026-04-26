#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.hardened.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

ENV_FILE=".env.hardened"
VOLUME_NAME_OVERRIDE=""
BACKUP_DIR="$ROOT_DIR/storage/rehearsal-backups"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-webos_rehearsal_${STAMP}}"

EXECUTE=0
YES=0
KEEP_STACK=0
ENV_FILE_SET=0
VOLUME_NAME_SET=0
BACKUP_DIR_SET=0
PROJECT_NAME_SET=0
POSITIONAL=()

HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
ARCHIVE_NAME="webos_storage_${STAMP}.tar.gz"
MARKER_PATH="/vol/rehearsal/marker.txt"
ORIGINAL_MARKER="backup-before-${STAMP}"
MUTATED_MARKER="backup-after-${STAMP}"
STACK_STARTED=0

usage() {
  cat <<'USAGE'
Usage:
  bash tools/rehearse-storage-backup-restore.sh [options] [ENV_FILE] [VOLUME_NAME] [BACKUP_DIR]

Preferred flags:
  --dry-run                 Print the rehearsal plan without Docker or volume mutation. Default.
  --execute                 Actually start Docker Compose and mutate the target storage volume.
  --yes, -y                 Skip the interactive confirmation. Required for noninteractive --execute.
  --env-file PATH           Compose env file. Default: .env.hardened.
  --volume-name NAME        Existing volume to rehearse against. Default: auto-detect webos_storage.
  --backup-dir PATH         Archive output directory. Default: storage/rehearsal-backups.
  --project-name NAME       Compose project name. Default: webos_rehearsal_<timestamp>.
  --keep-stack              Do not run compose down on exit/failure.
  --help, -h                Show this help.

Positional compatibility:
  Existing calls may still pass ENV_FILE, VOLUME_NAME, and BACKUP_DIR as the
  first three positional arguments. Prefer the explicit flags above for new use.

Examples:
  bash tools/rehearse-storage-backup-restore.sh
  bash tools/rehearse-storage-backup-restore.sh --execute
  bash tools/rehearse-storage-backup-restore.sh --execute --yes --project-name webos_rehearsal_manual
USAGE
}

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    fail "$flag requires a value."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      EXECUTE=0
      ;;
    --execute)
      EXECUTE=1
      ;;
    --yes|-y)
      YES=1
      ;;
    --keep-stack)
      KEEP_STACK=1
      ;;
    --env-file)
      shift
      require_value "--env-file" "${1:-}"
      ENV_FILE="$1"
      ENV_FILE_SET=1
      ;;
    --env-file=*)
      ENV_FILE="${1#--env-file=}"
      require_value "--env-file" "$ENV_FILE"
      ENV_FILE_SET=1
      ;;
    --volume-name|--volume)
      shift
      require_value "--volume-name" "${1:-}"
      VOLUME_NAME_OVERRIDE="$1"
      VOLUME_NAME_SET=1
      ;;
    --volume-name=*|--volume=*)
      VOLUME_NAME_OVERRIDE="${1#*=}"
      require_value "--volume-name" "$VOLUME_NAME_OVERRIDE"
      VOLUME_NAME_SET=1
      ;;
    --backup-dir)
      shift
      require_value "--backup-dir" "${1:-}"
      BACKUP_DIR="$1"
      BACKUP_DIR_SET=1
      ;;
    --backup-dir=*)
      BACKUP_DIR="${1#--backup-dir=}"
      require_value "--backup-dir" "$BACKUP_DIR"
      BACKUP_DIR_SET=1
      ;;
    --project-name)
      shift
      require_value "--project-name" "${1:-}"
      PROJECT_NAME="$1"
      PROJECT_NAME_SET=1
      ;;
    --project-name=*)
      PROJECT_NAME="${1#--project-name=}"
      require_value "--project-name" "$PROJECT_NAME"
      PROJECT_NAME_SET=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      fail "Unknown option: $1"
      ;;
    *)
      POSITIONAL+=("$1")
      ;;
  esac
  shift
done

if [[ ${#POSITIONAL[@]} -gt 3 ]]; then
  fail "Too many positional arguments. Expected ENV_FILE, VOLUME_NAME, BACKUP_DIR."
fi

if [[ ${#POSITIONAL[@]} -ge 1 && "$ENV_FILE_SET" -eq 0 ]]; then
  ENV_FILE="${POSITIONAL[0]}"
fi
if [[ ${#POSITIONAL[@]} -ge 2 && "$VOLUME_NAME_SET" -eq 0 ]]; then
  VOLUME_NAME_OVERRIDE="${POSITIONAL[1]}"
fi
if [[ ${#POSITIONAL[@]} -ge 3 && "$BACKUP_DIR_SET" -eq 0 ]]; then
  BACKUP_DIR="${POSITIONAL[2]}"
fi

if [[ -z "$PROJECT_NAME" ]]; then
  fail "Compose project name cannot be empty."
fi

if [[ "$PROJECT_NAME_SET" -eq 0 && -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
  echo "[info] Using COMPOSE_PROJECT_NAME from environment: $PROJECT_NAME"
elif [[ "$PROJECT_NAME_SET" -eq 0 ]]; then
  echo "[info] Using isolated compose project: $PROJECT_NAME"
fi

COMPOSE_ARGS=(-p "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

cleanup() {
  local status=$?
  if [[ "$EXECUTE" -eq 1 && "$STACK_STARTED" -eq 1 && "$KEEP_STACK" -eq 0 ]]; then
    if [[ "$status" -ne 0 ]]; then
      echo "[cleanup] Rehearsal failed; stopping compose project $PROJECT_NAME..."
    else
      echo "[cleanup] Stopping compose project $PROJECT_NAME..."
    fi
    docker compose "${COMPOSE_ARGS[@]}" down || true
  elif [[ "$EXECUTE" -eq 1 && "$STACK_STARTED" -eq 1 && "$KEEP_STACK" -eq 1 ]]; then
    echo "[cleanup] Keeping compose project running: $PROJECT_NAME"
  fi
  return "$status"
}
trap cleanup EXIT

print_plan() {
  echo "[dry-run] Storage backup/restore rehearsal plan"
  echo "mode=dry-run"
  echo "compose_file=$COMPOSE_FILE"
  echo "env_file=$ENV_FILE"
  echo "project_name=$PROJECT_NAME"
  if [[ -n "$VOLUME_NAME_OVERRIDE" ]]; then
    echo "volume=$VOLUME_NAME_OVERRIDE"
  else
    echo "volume=auto-detect label com.docker.compose.project=$PROJECT_NAME and com.docker.compose.volume=webos_storage"
  fi
  echo "backup_dir=$BACKUP_DIR"
  echo "archive=${BACKUP_DIR}/${ARCHIVE_NAME}"
  echo "keep_stack=$KEEP_STACK"
  echo ""
  echo "No Docker Compose stack, Docker container, volume write, restore delete, or archive write will run."
  echo "Use --execute for the actual rehearsal. Add --yes for noninteractive automation."
}

confirm_execute() {
  if [[ "$YES" -eq 1 ]]; then
    return
  fi

  if [[ ! -t 0 ]]; then
    fail "--execute requires --yes in noninteractive mode."
  fi

  echo "[confirm] This rehearsal will start compose project '$PROJECT_NAME' and mutate the selected webos_storage volume."
  if [[ -n "$VOLUME_NAME_OVERRIDE" ]]; then
    echo "[confirm] Explicit target volume: $VOLUME_NAME_OVERRIDE"
  else
    echo "[confirm] Target volume will be resolved from compose project labels after stack startup."
  fi
  echo "[confirm] Type 'execute ${PROJECT_NAME}' to continue:"
  read -r ANSWER
  if [[ "$ANSWER" != "execute ${PROJECT_NAME}" ]]; then
    fail "Confirmation did not match. Aborting without mutation."
  fi
}

if [[ "$EXECUTE" -eq 0 ]]; then
  print_plan
  exit 0
fi

confirm_execute

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "Compose file not found: $COMPOSE_FILE"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  fail "Env file not found: $ENV_FILE"
fi

mkdir -p "$BACKUP_DIR"

echo "[1/6] Starting hardened stack with compose project $PROJECT_NAME..."
STACK_STARTED=1
docker compose "${COMPOSE_ARGS[@]}" up -d --build

if [[ -n "$VOLUME_NAME_OVERRIDE" ]]; then
  VOLUME_NAME="$VOLUME_NAME_OVERRIDE"
else
  VOLUME_NAME="$(docker volume ls \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter "label=com.docker.compose.volume=webos_storage" \
    --format '{{.Name}}' | head -n 1)"
fi

if [[ -z "${VOLUME_NAME:-}" ]]; then
  fail "Could not resolve webos_storage docker volume name for project $PROJECT_NAME."
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
  fail "Restore validation failed: expected '$ORIGINAL_MARKER', got '$RESTORED_MARKER'"
fi

echo "[6/6] Restore validation passed."
echo "archive=${BACKUP_DIR}/${ARCHIVE_NAME}"
echo "marker_before=${ORIGINAL_MARKER}"
echo "marker_after_restore=${RESTORED_MARKER}"
