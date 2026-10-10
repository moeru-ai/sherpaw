import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as ort from 'onnxruntime-web'
import { describe, expect, it } from 'vitest'

import type { SortformerStream } from '../../src/sortformer/stream'

import { loadSortformer } from '../../src/sortformer/stream'

const modelPath = process.env.SHERPAW_MODELS_DIR
  ? `${process.env.SHERPAW_MODELS_DIR}/nemotron-3-diarization/nemotron3_diar_v3.w8.onnx`
  : fileURLToPath(new URL('../../../../models/nemotron-3-diarization/nemotron3_diar_v3.w8.onnx', import.meta.url))
const modelExists = existsSync(modelPath)
function configureRuntime() {
  ort.env.wasm.numThreads = 4
}

function audio() {
  const samples = new Float32Array(12 * 16000)
  let state = 0x12345678

  for (let index = 0; index < samples.length; index++) {
    state = (1664525 * state + 1013904223) >>> 0
    const seconds = index / 16000
    const tone = Math.sin(2 * Math.PI * 220 * seconds) * (0.2 + 0.15 * Math.sin(2 * Math.PI * 0.7 * seconds))
    const noise = (state / 0xFFFFFFFF - 0.5) * 0.05

    samples[index] = tone + noise
  }

  return samples
}

async function run(stream: SortformerStream, samples: Float32Array, blockSize: number) {
  const parts: Float32Array[] = []

  for (let offset = 0; offset < samples.length; offset += blockSize)
    parts.push(await stream.push(samples.subarray(offset, offset + blockSize)))

  parts.push(await stream.flush())
  const output = new Float32Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0

  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }

  return output
}

const describeStream = modelExists ? describe : describe.skip

describeStream(modelExists ? 'Sortformer stream' : `Sortformer stream (model not found: ${modelPath})`, () => {
  it('is deterministic across block sizes and streams', async () => {
    configureRuntime()
    const bytes = new Uint8Array(await readFile(modelPath))
    const model = await loadSortformer(ort, bytes, { executionProviders: ['wasm'] })
    const samples = audio()
    const first = await run(model.createStream(), samples, 1600)
    const second = await run(model.createStream(), samples, 997)
    const third = await run(model.createStream(), samples, 1600)

    expect(second).toEqual(first)
    expect(third).toEqual(first)
    await model.dispose()
  })

  it('benchmarks both profiles', async () => {
    configureRuntime()
    const bytes = new Uint8Array(await readFile(modelPath))
    const model = await loadSortformer(ort, bytes, { executionProviders: ['wasm'] })
    const speeds = await model.benchmark({ warmup: 1, runs: 1 })

    expect(speeds).toHaveLength(2)
    expect(speeds.every(speed => speed.stepMs > 0)).toBe(true)
    await model.dispose()
  })
})
