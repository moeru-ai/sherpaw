# X-ASR Hugging Face model packs

The INT8 and FP32 X-ASR zh-en variants use the same packaging contract as the
existing Sherpaw Zipformer models. Both are the upstream 480 ms streaming,
punctuation-enabled models dated 2026-06-05.

## Layout

```text
README.md
LICENSE
manifest.json
install/bin/wasm/
  preload.data
  preload.js
  preload.js.metadata
```

The ES module loader exports `loadDataFile(Module)`. The metadata uses `files`
with `filename`, `start`, and `end`, plus `remote_package_size`. Virtual files,
in order, are `/decoder.onnx`, `/encoder.onnx`, `/joiner.onnx`, and `/tokens.txt`.
The INT8 encoder/joiner filenames are normalized while their bytes are unchanged.
The INT8 variant's decoder retains its original floating-point precision.

## Reproduce

Use Python 3.11+ and Docker, then run:

```sh
python3 scripts/pack-x-asr-models.py
```

Each model directory also has `download.sh` and `pack.sh`. The packer uses
`emscripten/emsdk:4.0.23`, verifies the pinned source archives through the existing
preparer, checks extracted model hashes, and verifies every byte range in the
preload data against its source file. It writes the three artifacts under each
model's `install/bin/wasm/` and a generated `package-manifest.json` recording
source URLs, file hashes, virtual paths, and artifact hashes.

An activated local Emscripten 4.0.23 installation can be used instead of Docker:

```sh
python3 scripts/pack-x-asr-models.py --file-packager /path/to/emscripten/tools/file_packager
```

The published `manifest.json` is this package manifest. Publish only the model
card, upstream license, manifest, and the three preload artifacts; source
archives and loose ONNX files stay local. Published revisions are pinned as
submodules under `models/huggingface/`, consistent with existing model packs.

## Verification

Both generated ES module loaders were executed locally. Each restored all four
virtual files with hashes matching the original ONNX/token files and released
all run dependencies. Both generated `preload.js` files are byte-identical to
the existing Zipformer loader. Virtual paths and metadata fields match the existing
`sherpaw-zipformer-zh-en-2023-02-20` pack. INT8 data is 169,227,953 bytes; FP32 data
is 614,981,400 bytes. These are asset sizes, not runtime memory requirements.

The packs contain model data, not WASM or WebGPU inference runtimes. Use them
with a compatible Sherpaw streaming Transducer runtime. FP32 WebGPU encoder
support is part of the sandbox integration in PR #15; loading this model pack
alone does not select a GPU backend.
