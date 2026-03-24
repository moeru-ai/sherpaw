import type { ASRModule } from '@sherpaw/asr'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import type {
  PushAudioInvokeRequest,
  TranscriptionEvent,
} from '../stream-transcription/types'
import type { ResolvedSherpawSpeechModel } from '../types'

import { createSession, initTranscriptionModule, loadModelFiles } from '../core'
import {
  streamTranscriptionDisposeInvoke,
  streamTranscriptionEvent,
  streamTranscriptionFinishInvoke,
  streamTranscriptionInitInvoke,
  streamTranscriptionPushInvoke,
  streamTranscriptionResetInvoke,
} from '../events'

const { context } = createContext()

let moduleRef: ASRModule | null = null
let sessionRef: ReturnType<typeof createSession> | null = null
let unsubscribeHandlers: Array<() => void> = []

export type WorkerInvokeCommand = keyof WorkerInvokePayloadMap

interface WorkerInvokePayloadMap {
  load: ResolvedSherpawSpeechModel
  push: PushAudioInvokeRequest
  finish: void
  reset: void
  dispose: void
}

interface WorkerInvokeResultMap {
  load: void
  push: ReturnType<NonNullable<typeof sessionRef>['pushAudio']>
  finish: ReturnType<NonNullable<typeof sessionRef>['finish']>
  reset: void
  dispose: void
}

function clearBinds(): void {
  for (const unsubscribe of unsubscribeHandlers) {
    unsubscribe()
  }
  unsubscribeHandlers = []
}

function subscribeSessionEvents(emit: (event: TranscriptionEvent) => void): Array<() => void> {
  if (!sessionRef) {
    return []
  }

  const eventTypes = [
    'transcription.started',
    'sentence.begin',
    'transcription.partial',
    'word',
    'sentence.end',
    'transcription.completed',
  ] as const

  const subscriptions: Array<() => void> = []
  for (const type of eventTypes) {
    subscriptions.push(sessionRef.on(type, emit))
  }

  return subscriptions
}

function bindEvents(): void {
  clearBinds()
  unsubscribeHandlers = subscribeSessionEvents((event) => {
    context.emit(streamTranscriptionEvent, event)
  })
}

function isPushPayload(value: unknown): value is PushAudioInvokeRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as { samples?: unknown, sampleRate?: unknown }
  if (!Array.isArray(payload.samples) || !payload.samples.every(sample => typeof sample === 'number')) {
    return false
  }

  return payload.sampleRate === undefined || typeof payload.sampleRate === 'number'
}

async function runCommand(
  command: WorkerInvokeCommand,
  payload: WorkerInvokePayloadMap[typeof command],
): Promise<WorkerInvokeResultMap[typeof command]> {
  switch (command) {
    case 'load': {
      const model = payload as ResolvedSherpawSpeechModel
      moduleRef = model.module ?? moduleRef ?? await initTranscriptionModule()
      await loadModelFiles(moduleRef, {
        metadata: model.metadata,
        data: model.data,
      })

      if (sessionRef) {
        sessionRef.dispose()
        clearBinds()
      }

      sessionRef = createSession(moduleRef, {
        sampleRate: model.sampleRate,
        recognizerConfig: model.recognizerConfig,
      })
      bindEvents()
      return undefined
    }

    case 'push': {
      if (!sessionRef) {
        throw new Error('Session not initialized.')
      }
      if (!isPushPayload(payload)) {
        throw new TypeError('Invalid push invoke payload.')
      }
      const samples = new Float32Array(payload.samples)
      return sessionRef.pushAudio(samples, { sampleRate: payload.sampleRate })
    }

    case 'finish': {
      if (!sessionRef) {
        throw new Error('Session not initialized.')
      }
      return sessionRef.finish()
    }

    case 'reset': {
      if (!sessionRef) {
        throw new Error('Session not initialized.')
      }
      sessionRef.reset()
      return undefined
    }

    case 'dispose': {
      if (sessionRef) {
        sessionRef.dispose()
        sessionRef = null
      }

      clearBinds()
      return undefined
    }
  }
}

defineInvokeHandler(context, streamTranscriptionInitInvoke, async (payload) => {
  await runCommand('load', payload)
})

defineInvokeHandler(context, streamTranscriptionPushInvoke, async (payload) => {
  return await runCommand('push', payload)
})

defineInvokeHandler(context, streamTranscriptionFinishInvoke, async () => {
  return await runCommand('finish', undefined)
})

defineInvokeHandler(context, streamTranscriptionResetInvoke, async () => {
  await runCommand('reset', undefined)
})

defineInvokeHandler(context, streamTranscriptionDisposeInvoke, async () => {
  await runCommand('dispose', undefined)
})
