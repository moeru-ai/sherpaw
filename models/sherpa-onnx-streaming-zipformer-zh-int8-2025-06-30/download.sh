#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
python3 "$repo/models/prepare-asr-models.py" zipformer-zh
