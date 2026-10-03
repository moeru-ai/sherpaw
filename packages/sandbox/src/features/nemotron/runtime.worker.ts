// cspell:ignore Nemotron nemotron diar
/// <reference types="@webgpu/types" />

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'
import ortWasmMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import * as ort from 'onnxruntime-web/webgpu'
import { fetchLocalModel } from 'virtual:local-models'

import type { NemotronModel, NemotronStream } from './stream'

import { operation } from './protocol'
import { loadNemotron, profiles } from './stream'

const sampleRate = 16000
const reportMs = 5000
const { context } = createContext()
let model: NemotronModel | undefined
let stream: NemotronStream | undefined
let profiling = false
let queue: Promise<{ probabilities: Float32Array, computeMs: number }> = Promise.resolve({ probabilities: new Float32Array(0), computeMs: 0 })
/** Samples of push requests that wait in the queue or run now. */
let waiting = 0
/** Samples that the stream handled since the last report. */
let handled = 0
let stopReports: (() => void) | undefined

/** Logs the adapter. With chrome://flags/#enable-webgpu-developer-features, Chrome adds fields such as backend, driver and memoryHeaps. */
function logAdapter(adapter: GPUAdapter) {
  const info = adapter.info as unknown as Record<string, unknown>
  const fields = ['vendor', 'architecture', 'device', 'description', 'backend', 'type', 'driver', 'memoryHeaps']

  // eslint-disable-next-line no-console -- `?profile` asks for these logs.
  console.info('[nemotron] WebGPU adapter', Object.fromEntries(fields.filter(field => info[field] !== undefined && info[field] !== '').map(field => [field, info[field]])))
}

/** Every 5 s, logs the step times that the stream measured, the real-time factor and the audio that waits. */
function startReports() {
  const times = new Map<string, number[]>()
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const stage = entry.name.startsWith('nemotron:') ? entry.name.slice('nemotron:'.length) : undefined

      if (stage)
        times.set(stage, [...(times.get(stage) ?? []), entry.duration])
    }
  })
  const sum = (values: number[] = []) => values.reduce((total, value) => total + value, 0)
  const timer = setInterval(() => {
    const run = [...(times.get('run') ?? [])].sort((a, b) => a - b)
    const busy = sum(run) + sum(times.get('features')) + sum(times.get('update'))

    if (run.length || waiting) {
      // eslint-disable-next-line no-console -- `?profile` asks for these logs.
      console.log(`[nemotron] last ${reportMs / 1000} s: ${run.length} steps, run mean ${(sum(run) / Math.max(1, run.length)).toFixed(0)} ms / p90 ${(run[Math.floor(0.9 * (run.length - 1))] ?? 0).toFixed(0)} ms / max ${(run.at(-1) ?? 0).toFixed(0)} ms, features ${sum(times.get('features')).toFixed(0)} ms, update ${sum(times.get('update')).toFixed(0)} ms, real-time factor ${handled ? (busy / 1000 / (handled / sampleRate)).toFixed(2) : '-'}, waiting audio ${(waiting / sampleRate).toFixed(1)} s`)
    }

    times.clear()
    handled = 0
    performance.clearMeasures()
  }, reportMs)

  observer.observe({ type: 'measure' })
  stopReports = () => {
    clearInterval(timer)
    observer.disconnect()
    performance.clearMeasures()
  }
}

async function load(enableProfiling: boolean) {
  const adapter = await navigator.gpu?.requestAdapter()

  if (!adapter || adapter.info.isFallbackAdapter)
    throw new Error('Hardware WebGPU is unavailable in this browser')

  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = { mjs: ortWasmMjs, wasm: ortWasm }

  if (enableProfiling) {
    // ONNX Runtime marks its calls with console.timeStamp, which the Performance panel shows.
    ort.env.trace = true
    logAdapter(adapter)
    startReports()
  }

  const response = await fetchLocalModel('nemotron-3-diarization/nemotron3_diar_v3.w8.onnx')

  if (!response.ok)
    throw new Error(`Could not load the Nemotron model (${response.status}). Put nemotron3_diar_v3.w8.onnx in models/nemotron-3-diarization/.`)

  model = await loadNemotron(ort, new Uint8Array(await response.arrayBuffer()), {
    executionProviders: ['webgpu'],
  })
  profiling = enableProfiling
}

defineInvokeHandler(context, operation, (request) => {
  const run = async () => {
    if (request.kind === 'load') {
      if (model)
        throw new Error('The worker already owns a diarization session')

      await load(request.profiling)
      return { probabilities: new Float32Array(0), computeMs: 0 }
    }

    if (!model)
      throw new Error('Model is not loaded')

    if (request.kind === 'dispose') {
      stopReports?.()
      stopReports = undefined
      await stream?.dispose()
      stream = undefined
      await model.dispose()
      model = undefined
      return { probabilities: new Float32Array(0), computeMs: 0 }
    }

    if (request.kind === 'benchmark')
      return { probabilities: new Float32Array(0), computeMs: 0, speeds: await model.benchmark() }

    if (request.kind === 'start') {
      await stream?.dispose()
      stream = model.createStream({ profile: profiles[request.profile], profiling })
      return { probabilities: new Float32Array(0), computeMs: 0 }
    }

    if (!stream)
      throw new Error('Stream is not started')

    if (request.kind === 'reset') {
      stream.reset()
      return { probabilities: new Float32Array(0), computeMs: stream.computeMs }
    }

    const probabilities = request.kind === 'push' ? await stream.push(request.samples) : await stream.flush()

    return { probabilities, computeMs: stream.computeMs }
  }

  const samples = request.kind === 'push' ? request.samples.length : 0
  const counted = async () => {
    try {
      return await run()
    }
    finally {
      waiting -= samples
      handled += samples
    }
  }

  waiting += samples
  queue = queue.then(counted, counted)
  return queue
})
