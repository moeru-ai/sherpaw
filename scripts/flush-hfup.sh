#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd -P)"
MODELS_ROOT="${MODELS_ROOT:-${REPO_ROOT}/models}"

usage() {
  cat <<'EOF'
Usage:
  scripts/flush-hfup.sh [TARGET_DIR ...]

Behavior:
  - Without args: auto-discover all directories under MODELS_ROOT containing hfup.config.json.
  - With args: update only the provided target directories.
    Relative paths are resolved from repository root.

Env:
  MODELS_ROOT   Root directory to scan for hfup.config.json (default: <repo>/models)
EOF
}

resolve_target() {
  local raw="$1"
  local target

  if [[ "${raw}" = /* ]]; then
    target="${raw}"
  else
    target="${REPO_ROOT}/${raw}"
  fi

  if [[ ! -d "${target}" ]]; then
    echo "Error: target directory does not exist: ${target}" >&2
    return 1
  fi

  (cd -- "${target}" >/dev/null 2>&1 && pwd -P)
}

run_hfup_generate() {
  local root="$1"
  local cfg="${root}/hfup.config.json"

  if [[ ! -f "${cfg}" ]]; then
    echo "Skip: no hfup.config.json in ${root}" >&2
    return 0
  fi

  echo "==> Updating hfup artifacts in ${root}"
  pnpm exec hfup generate \
    --root "${root}" \
    --outDir "${root}" \
    --with-model-card \
    --with-lfs
}

main() {
  local -a targets=()

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  if [[ "$#" -gt 0 ]]; then
    local arg resolved
    for arg in "$@"; do
      resolved="$(resolve_target "${arg}")"
      targets+=("${resolved}")
    done
  else
    if [[ ! -d "${MODELS_ROOT}" ]]; then
      echo "Error: MODELS_ROOT does not exist: ${MODELS_ROOT}" >&2
      exit 1
    fi

    local cfg
    while IFS= read -r -d '' cfg; do
      targets+=("$(dirname "${cfg}")")
    done < <(find "${MODELS_ROOT}" -type f -name "hfup.config.json" -print0)
  fi

  if [[ "${#targets[@]}" -eq 0 ]]; then
    echo "No target directories found."
    exit 0
  fi

  local target
  for target in "${targets[@]}"; do
    run_hfup_generate "${target}"
  done

  echo "Done. Updated ${#targets[@]} target(s)."
}

main "$@"
