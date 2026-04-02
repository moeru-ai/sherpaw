import type { FlexibleModelInput, WebAssemblyModule } from '@sherpaw/shared'

import { loadVirtualData } from '@sherpaw/preloader'
import { resolveModelFile } from '@sherpaw/shared'

import type {
  MoonshineModelConfig,
  OfflineModelConfig,
  OfflineRecognizerConfig,
  WhisperModelConfig,
} from './asr'
import type { VadConfig } from './vad'
import type { ASRModelConfig, ASRModelSpec, ModelsConfig } from './types'

export interface ModelMountResolver {
  resolvePath: (input: FlexibleModelInput) => Promise<string>
  commit: () => void
  mountedFiles: string[]
}

export function createModelMountResolver(module: WebAssemblyModule, sessionId: string): ModelMountResolver {
  const virtualData: Record<string, Uint8Array> = {}
  const mountedFiles: string[] = []
  const mountedNames = new Set<string>()

  async function resolvePath(input: FlexibleModelInput): Promise<string> {
    const resolved = await resolveModelFile(input)
    const prefix = `${sessionId}-${resolved.filename}`

    let mountedFilename = prefix
    let index = 1
    while (mountedNames.has(mountedFilename)) {
      mountedFilename = `${prefix}-${index}`
      index += 1
    }
    mountedNames.add(mountedFilename)
    mountedFiles.push(mountedFilename)
    virtualData[mountedFilename] = resolved.data
    return `./${mountedFilename}`
  }

  function commit() {
    if (Object.keys(virtualData).length === 0) {
      return
    }
    loadVirtualData({
      module,
      virtualData,
      dependencyId: `vadasr-model-${sessionId}`,
    })
  }

  return { resolvePath, commit, mountedFiles }
}

function normalizeASRModelConfig(config: ASRModelConfig): ASRModelSpec {
  if ('modelConfig' in config && config.modelConfig) {
    return config.modelConfig
  }
  return config as ASRModelSpec
}

async function resolveOptional(resolver: ModelMountResolver, input?: FlexibleModelInput): Promise<string | undefined> {
  if (input == null)
    return undefined
  return resolver.resolvePath(input)
}

async function resolveASRModelFiles(
  spec: ASRModelSpec,
  resolver: ModelMountResolver,
): Promise<Partial<OfflineModelConfig>> {
  if (spec.moonshine) {
    const m = spec.moonshine
    const moonshine: MoonshineModelConfig = {
      preprocessor: await resolveOptional(resolver, m.preprocessor),
      encoder: await resolver.resolvePath(m.encoder),
      uncachedDecoder: await resolveOptional(resolver, m.uncachedDecoder),
      cachedDecoder: await resolveOptional(resolver, m.cachedDecoder),
      mergedDecoder: await resolveOptional(resolver, m.mergedDecoder),
    }
    return { moonshine }
  }

  if (spec.whisper) {
    const w = spec.whisper
    const whisper: WhisperModelConfig = {
      encoder: await resolver.resolvePath(w.encoder),
      decoder: await resolver.resolvePath(w.decoder),
      language: w.language,
      task: w.task,
      tailPaddings: w.tailPaddings,
    }
    return { whisper }
  }

  if (spec.transducer) {
    const t = spec.transducer
    return {
      transducer: {
        encoder: await resolver.resolvePath(t.encoder),
        decoder: await resolver.resolvePath(t.decoder),
        joiner: await resolver.resolvePath(t.joiner),
      },
    }
  }

  if (spec.paraformer) {
    return {
      paraformer: {
        model: await resolver.resolvePath(spec.paraformer.model),
      },
    }
  }

  if (spec.zipformerCtc) {
    return {
      zipformerCtc: {
        model: await resolver.resolvePath(spec.zipformerCtc.model),
      },
    }
  }

  if (spec.zipformer2Ctc) {
    return {
      zipformer2Ctc: {
        model: await resolver.resolvePath(spec.zipformer2Ctc.model),
      },
    }
  }

  throw new Error('No ASR model type specified. Provide one of: moonshine, whisper, transducer, paraformer, zipformerCtc, zipformer2Ctc')
}

export async function resolveAllModels(
  models: ModelsConfig,
  resolver: ModelMountResolver,
): Promise<{ vadConfig: VadConfig, recognizerConfig: OfflineRecognizerConfig }> {
  const asrSpec = normalizeASRModelConfig(models.asr)

  const [sileroModelPath, tokensPath, modelFiles] = await Promise.all([
    resolver.resolvePath(models.vad.silero),
    resolver.resolvePath(asrSpec.tokens),
    resolveASRModelFiles(asrSpec, resolver),
  ])

  const vadConfig: VadConfig = {
    sileroVad: {
      model: sileroModelPath,
      threshold: models.vad.threshold,
      minSilenceDuration: models.vad.minSilenceDuration,
      minSpeechDuration: models.vad.minSpeechDuration,
      windowSize: models.vad.windowSize,
      maxSpeechDuration: models.vad.maxSpeechDuration,
    },
  }

  const recognizerConfig: OfflineRecognizerConfig = {
    modelConfig: {
      ...modelFiles,
      tokens: tokensPath,
      numThreads: asrSpec.numThreads,
      provider: asrSpec.provider,
      debug: asrSpec.debug,
      modelType: asrSpec.modelType,
    },
  }

  return { vadConfig, recognizerConfig }
}

export function unlinkMountedFiles(module: WebAssemblyModule, mountedFiles: string[]): void {
  const fsUnlink = (module as any).FS_unlink as undefined | ((path: string) => void)
  if (typeof fsUnlink !== 'function') {
    return
  }

  for (const file of mountedFiles) {
    try {
      fsUnlink(file)
    }
    catch {}
    try {
      fsUnlink(`/${file}`)
    }
    catch {}
  }
}
