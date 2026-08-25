/** Recognizer family required by a locally packaged Sherpaw model. */
export type SherpawAudioRecognizer = 'paraformer' | 'transducer'

/** One local model that the browser audio test can load. */
export interface SherpawAudioModel {
  /** Directory name under the repository's `models` directory. */
  id: string
  /** Sherpa-ONNX recognizer family used to interpret the packaged files. */
  recognizer: SherpawAudioRecognizer
}

/**
 * Models maintained by this repository and covered by the browser audio matrix.
 *
 * @example
 * for (const model of sherpawAudioModels)
 *   await audio.start(model)
 */
export const sherpawAudioModels = [
  {
    id: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    recognizer: 'paraformer',
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    recognizer: 'transducer',
  },
  {
    id: 'sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10',
    recognizer: 'transducer',
  },
] as const satisfies readonly SherpawAudioModel[]
