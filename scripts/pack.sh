#!/usr/bin/env bash
set -e

$(dirname $(which emcc))/tools/file_packager \
  preload.data \
  --preload assets@. \
  --js-output=preload.js \
  --separate-metadata \
  --export-es6
