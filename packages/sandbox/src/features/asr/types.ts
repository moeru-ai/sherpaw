export type AsrBackend = 'cpu' | 'webgpu' | 'webgpu-decoder' | 'webgpu-fp32' | 'webgpu-encoder'

export interface RecognizerOptions {
  modelId: string
  backend: AsrBackend
  /** Collect GPU dispatch counts for sandbox diagnostics; disabled by default. */
  diagnostics?: boolean
}

export interface RecognizerStats {
  decodedChunks: number
  gpuDispatches: number
}

/** A single recording session, accepting mono 16 kHz PCM in order. */
export interface Recognizer {
  accept: (samples: Float32Array) => Promise<string>
  finish: () => Promise<string>
  dispose: () => Promise<void>
  stats?: () => RecognizerStats
}

export interface RecognizerSnapshot extends RecognizerStats { text: string }
export type RecognizerRequest
  = | { id: number, kind: 'load', options: RecognizerOptions, baseUrl: string }
    | { id: number, kind: 'accept', samples: Float32Array }
    | { id: number, kind: 'finish' | 'dispose' }

export interface RecognizerReply {
  id: number
  status?: string
  error?: string
  snapshot?: RecognizerSnapshot
}
