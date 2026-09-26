# /// script
# requires-python = ">=3.11"
# dependencies = ["onnx==1.19.0", "packaging==25.0", "huggingface-hub==2.0.0"]
# ///
"""Fetch verified upstream FP32 Paraformer weights and derive FP16 with FP32 IO.

Run: uv run scripts/prepare-float-asr.py [--fp32-only]
Artifacts are ignored under sandbox/public/webgpu-experiment/{fp32,fp16}.
"""
import argparse
import hashlib
import importlib.util
import json
import urllib.request
from collections import Counter
from pathlib import Path

import onnx
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "packages/sandbox/public/webgpu-experiment"
REPO = "csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en"
CONVERTER_URL = "https://raw.githubusercontent.com/microsoft/onnxruntime/v1.23.2/onnxruntime/python/tools/transformers/float16.py"
CONVERTER_SHA256 = "9dfd1f1ee6c2e2a7ab35e18b617b9396762b52c797e6c0b1f0beff137dbbf7c4"
REVISION = "8e40c43232a1c5c66c82111efc5820d3accca11b"
SHA256 = {
    "encoder.onnx": "832c8e8d3f758f4ab0fcfc011eec91154ecd129b7305564a7b461b20064ebcc6",
    "decoder.onnx": "e178f5a7dd4efbf5905a797807006d773b12116eb39fed3d16758e68f9f50921",
    "encoder.int8.onnx": "81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a",
    "decoder.int8.onnx": "f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f",
}


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def load_converter():
    # Use the pinned upstream conversion module without installing the native
    # inference wheel; browser inference still uses ORT Web 1.27.0.
    path = ROOT / ".cache/asr-float/ort-float16.py"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or digest(path) != CONVERTER_SHA256:
        with urllib.request.urlopen(CONVERTER_URL, timeout=30) as response:
            source = response.read()
        assert hashlib.sha256(source).hexdigest() == CONVERTER_SHA256
        path.write_bytes(source)
    spec = importlib.util.spec_from_file_location("sherpaw_ort_float16", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.convert_float_to_float16


def model_info(model):
    def tensors(values):
        return {v.name: {"type": v.type.tensor_type.elem_type,
                         "shape": [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim]}
                for v in values}
    return {"operators": dict(Counter(node.op_type for node in model.graph.node)),
            "inputs": tensors(model.graph.input), "outputs": tensors(model.graph.output),
            "metadata": {item.key: item.value for item in model.metadata_props}}


def sort_nodes(graph):
    """Place converter-inserted Cast nodes before their consumers for ONNX validation."""
    available = {v.name for v in graph.input} | {v.name for v in graph.initializer} | {""}
    pending = list(graph.node)
    ordered = []
    while pending:
        remaining = []
        for node in pending:
            if all(name in available for name in node.input):
                ordered.append(node)
                available.update(node.output)
            else:
                remaining.append(node)
        assert len(remaining) < len(pending), "Converted graph has missing inputs or a cycle"
        pending = remaining
    del graph.node[:]
    graph.node.extend(ordered)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fp32-only", action="store_true")
    args = parser.parse_args()
    pack_root = ROOT / "models/huggingface/sherpaw-paraformer-zh-en/install/bin/wasm"
    entries = json.loads((pack_root / "preload.js.metadata").read_text())["files"]
    native_info = {}
    with (pack_root / "preload.data").open("rb") as pack:
        for entry in entries:
            if not entry["filename"].endswith(".onnx"):
                continue
            pack.seek(entry["start"])
            data = pack.read(entry["end"] - entry["start"])
            name = entry["filename"][1:]
            assert hashlib.sha256(data).hexdigest() == SHA256[name.replace(".onnx", ".int8.onnx")]
            native_info[name] = model_info(onnx.load_model_from_string(data))
    manifest = {"repo": REPO, "revision": REVISION, "onnx": onnx.__version__,
                "converter": {"url": CONVERTER_URL, "sha256": CONVERTER_SHA256},
                "conversion": {"keep_io_types": True}, "models": {}}
    convert = None if args.fp32_only else load_converter()
    for name in ("encoder.onnx", "decoder.onnx"):
        target = OUT / "fp32" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or digest(target) != SHA256[name]:
            url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
            print(f"Downloading {url}", flush=True)
            hf_hub_download(REPO, name, revision=REVISION, local_dir=target.parent)
            assert digest(target) == SHA256[name], f"Hash mismatch: {name}"
        model = onnx.load(target)
        info = model_info(model)
        for key in ("inputs", "outputs"):
            assert info[key] == native_info[name][key], (name, key, "Native bridge contract differs")
        # Quantizer provenance is not a frontend/model configuration field.
        native_metadata = {k: v for k, v in native_info[name]["metadata"].items() if k != "onnx.infer"}
        assert info["metadata"] == native_metadata, (name, "Frontend metadata differs")
        assert not {"DynamicQuantizeLinear", "MatMulInteger"} & info["operators"].keys()
        manifest["models"][f"fp32/{name}"] = {"sha256": digest(target), "bytes": target.stat().st_size, **info}
        print(f"Verified FP32 {name}: {target.stat().st_size} bytes", flush=True)
        if args.fp32_only:
            continue
        converted = convert(model, keep_io_types=True)
        sort_nodes(converted.graph)
        onnx.checker.check_model(converted, full_check=True)
        half = OUT / "fp16" / name
        half.parent.mkdir(parents=True, exist_ok=True)
        onnx.save(converted, half)
        manifest["models"][f"fp16/{name}"] = {"sha256": digest(half), "bytes": half.stat().st_size, **model_info(converted)}
        print(f"Generated FP16 {name}: {half.stat().st_size} bytes", flush=True)
    (OUT / "float-models.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
