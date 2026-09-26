#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./download.sh
./pack.sh
