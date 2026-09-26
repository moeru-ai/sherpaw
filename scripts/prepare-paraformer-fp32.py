# /// script
# requires-python = ">=3.11"
# dependencies = ["onnx==1.19.0", "huggingface-hub==2.0.0"]
# ///
"""Fetch verified upstream FP32 Paraformer weights for the browser bridge.

Run: uv run scripts/prepare-paraformer-fp32.py
Artifacts are ignored under sandbox/public/asr-models/paraformer-fp32/.
"""
import hashlib
import json
from collections import Counter
from pathlib import Path

import onnx
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "packages/sandbox/public/asr-models"
REPO = "csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en"
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


def model_info(model):
    def tensors(values):
        return {v.name: {"type": v.type.tensor_type.elem_type,
                         "shape": [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim]}
                for v in values}
    return {"operators": dict(Counter(node.op_type for node in model.graph.node)),
            "inputs": tensors(model.graph.input), "outputs": tensors(model.graph.output),
            "metadata": {item.key: item.value for item in model.metadata_props}}


def main():
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
    manifest = {"repo": REPO, "revision": REVISION, "models": {}}
    for name in ("encoder.onnx", "decoder.onnx"):
        target = OUT / "paraformer-fp32" / name
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
        manifest["models"][f"paraformer-fp32/{name}"] = {"sha256": digest(target), "bytes": target.stat().st_size, **info}
        print(f"Verified FP32 {name}: {target.stat().st_size} bytes", flush=True)
    (OUT / "float-models.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
