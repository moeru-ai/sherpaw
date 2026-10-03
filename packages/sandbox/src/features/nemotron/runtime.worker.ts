// cspell:ignore Nemotron nemotron diar
/// <reference types="@webgpu/types" />

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'
import ortWasmMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import * as ort from 'onnxruntime-web/webgpu'
import { fetchLocalModel } from 'virtual:local-models'

import { operation } from './protocol'
import { createNemotronStream, profiles } from './stream'

const { context } = createContext()
let stream: Awaited<ReturnType<typeof createNemotronStream>> | undefined
let queue: Promise<{ probabilities: Float32Array, computeMs: number }> = Promise.resolve({ probabilities: new Float32Array(0), computeMs: 0 })

async function load(profile: 'low' | 'veryLow') {
  const adapter = await navigator.gpu?.requestAdapter()

  if (!adapter || adapter.info.isFallbackAdapter)
    throw new Error('Hardware WebGPU is unavailable in this browser')

  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = { mjs: ortWasmMjs, wasm: ortWasm }

  const response = await fetchLocalModel('nemotron-3-diarization/nemotron3_diar_v3.w8.onnx')

  if (!response.ok)
    throw new Error(`Could not load the Nemotron model (${response.status}). Put nemotron3_diar_v3.w8.onnx in models/nemotron-3-diarization/.`)

  stream = await createNemotronStream(ort, new Uint8Array(await response.arrayBuffer()), {
    profile: profiles[profile],
    executionProviders: ['webgpu'],
  })
}

defineInvokeHandler(context, operation, (request) => {
  const run = async () => {
    if (request.kind === 'load') {
      if (stream)
        throw new Error('The worker already owns a diarization session')

      await load(request.profile)
      return { probabilities: new Float32Array(0), computeMs: 0 }
    }

    if (!stream)
      throw new Error('Model is not loaded')

    if (request.kind === 'dispose') {
      await stream.dispose()
      stream = undefined
      return { probabilities: new Float32Array(0), computeMs: 0 }
    }

    if (request.kind === 'reset') {
      stream.reset()
      return { probabilities: new Float32Array(0), computeMs: stream.computeMs }
    }

    const probabilities = request.kind === 'push' ? await stream.push(request.samples) : await stream.flush()

    return { probabilities, computeMs: stream.computeMs }
  }

  queue = queue.then(run, run)
  return queue
})
