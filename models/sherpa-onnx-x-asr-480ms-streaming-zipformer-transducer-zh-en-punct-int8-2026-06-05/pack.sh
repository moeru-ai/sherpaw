#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
python3 "$repo/models/pack-x-asr-models.py" x-asr "$@"
