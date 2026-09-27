import { loadModelPack } from '../models'

/** Sandbox policy: try a local pack in dev, then download the pinned HF model. */
export function loadKWSModel() {
  return loadModelPack('sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20', '1770a4b22db32184c110ac43c601db17cc9c93f8')
}
