#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
python3 "$repo/scripts/prepare-asr-models.py" x-asr-fp32
