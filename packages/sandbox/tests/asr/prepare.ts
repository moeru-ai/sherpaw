/// <reference types="@webgpu/types" />
import type { FakemicWebPrepareContext } from '@sherpaw/vitest-plugin-fakemic'
import type { Worker as BrowserWorker } from 'playwright'

import { operation } from '../../src/features/asr/protocol'

interface Observation {
  received: number
  processed: number
  started: number | null
  firstTextMs: number | null
  maxOutstandingSeconds: number
  acceptMs: number[]
  finishRpcMs: number | null
  text: string
  events: { receivedAudioSeconds: number, text: string }[]
  tracks: MediaStreamTrack[]
  gpuDispatch?: GPUComputePassEncoder['dispatchWorkgroups']
}

declare global {
  interface Window { __asrRealtimeTest: Observation }
}

/** Triggering workflow: fakemic launch -> Playwright observers -> measurements of the unmodified app. */
export default async function prepare(context: FakemicWebPrepareContext) {
  const page = await context.context.newPage()
  const errors: string[] = []
  let worker: BrowserWorker | undefined
  let gpuDispatches = 0
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(({ sendId, receiveId }) => {
    const state: Observation = window.__asrRealtimeTest = {
      received: 0,
      processed: 0,
      started: null,
      firstTextMs: null,
      maxOutstandingSeconds: 0,
      acceptMs: [],
      finishRpcMs: null,
      text: '',
      events: [],
      tracks: [],
      gpuDispatch: globalThis.GPUComputePassEncoder?.prototype.dispatchWorkgroups,
    }
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    /** Triggering workflow: app capture -> file-backed getUserMedia -> track lifetime assertions. */
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getUserMedia(...args)
      state.tracks.push(...stream.getTracks())
      return stream
    }
    const Worklet = AudioWorkletNode
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
        super(...args)
        if (args[1] !== 'microphone-capture')
          return
        /** Triggering workflow: capture port message -> test-only PCM count before app delivery. */
        this.port.addEventListener('message', (event: MessageEvent<Float32Array>) => {
          if (this.context.state !== 'running' || !state.tracks.some(track => track.readyState === 'live'))
            return
          state.started ??= performance.now()
          state.received += event.data.length
          state.maxOutstandingSeconds = Math.max(state.maxOutstandingSeconds, (state.received - state.processed) / 16000)
        })
      }
    }
    const requests = new Map<string, { kind: string, samples: number, start: number }>()
    const observed = new WeakSet<Worker>()
    const postMessage = Worker.prototype.postMessage
    /** Triggering workflow: Eventa request/response -> correlated test-only sample counts and RPC timings. */
    Worker.prototype.postMessage = function (message, options) {
      const event = message?.eventa
      if (event?.id === sendId) {
        const { invokeId, content } = event.body
        // Read the length before the original postMessage transfers/detaches PCM.
        requests.set(invokeId, { kind: content.kind, samples: content.samples?.length ?? 0, start: performance.now() })
        if (!observed.has(this)) {
          observed.add(this)
          this.addEventListener('message', ({ data }) => {
            const reply = data?.eventa
            const request = requests.get(reply?.body?.invokeId)
            if (!request || reply.id !== `${receiveId}-${reply.body.invokeId}`)
              return
            requests.delete(reply.body.invokeId)
            const ms = performance.now() - request.start
            if (request.kind === 'accept') {
              state.processed += request.samples
              state.acceptMs.push(ms)
            }
            if (request.kind === 'finish')
              state.finishRpcMs = ms
            if (request.kind !== 'accept' && request.kind !== 'finish')
              return
            state.text = reply.body.content
            if (state.text && state.started !== null)
              state.firstTextMs ??= performance.now() - state.started
            if (state.text !== state.events.at(-1)?.text)
              state.events.push({ receivedAudioSeconds: state.received / 16000, text: state.text })
          })
        }
      }
      return postMessage.call(this, message, options as StructuredSerializeOptions)
    }
  }, { sendId: operation.sendEvent.id, receiveId: operation.receiveEvent.id })
  await page.goto(context.runtime.url)
  return {
    page,
    browser: context.browser.version(),
    errors,
    /** Install after model initialization, before Start; no app instrumentation or warmup dispatches. */
    async monitorGpu() {
      worker = page.workers()[0]!
      await worker.evaluate(() => {
        let count = 0
        const prototype = globalThis.GPUComputePassEncoder?.prototype
        if (prototype) {
          const original = prototype.dispatchWorkgroups
          prototype.dispatchWorkgroups = function (...args) {
            count++
            return original.apply(this, args)
          }
        }
        Object.assign(globalThis, { __asrTestGpuDispatches: () => count })
      })
    },
    async stop() {
      // The worker is destroyed on Stop. This count covers live input, excluding final drain.
      gpuDispatches = await worker!.evaluate(() => (globalThis as unknown as { __asrTestGpuDispatches: () => number }).__asrTestGpuDispatches())
      await page.getByRole('button', { name: 'Stop transcription' }).click()
      await page.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 180000 })
    },
    snapshot: () => page.evaluate((gpuDispatches) => {
      const state = window.__asrRealtimeTest
      const sorted = [...state.acceptMs].sort((a, b) => a - b)
      return {
        receivedAudioSeconds: state.received / 16000,
        processedAudioSeconds: state.processed / 16000,
        firstTextMs: state.firstTextMs,
        maxOutstandingSeconds: state.maxOutstandingSeconds,
        acceptRpcMs: state.acceptMs.reduce((sum, ms) => sum + ms, 0),
        acceptRpcP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
        finishRpcMs: state.finishRpcMs,
        gpuDispatches,
        text: state.text,
        events: state.events,
        mainThreadGpuUntouched: state.gpuDispatch === globalThis.GPUComputePassEncoder?.prototype.dispatchWorkgroups,
        tracks: state.tracks.map(track => track.readyState),
        error: document.querySelector('[role=alert]')?.textContent ?? '',
      }
    }, gpuDispatches),
    close: context.close,
  }
}

export type RealtimeSession = Awaited<ReturnType<typeof prepare>>
