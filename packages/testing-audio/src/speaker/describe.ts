import type { AudioTestCase, AudioTestTask } from '@sherpaw/vitest-plugin-fakemic'

import { createAudioTestAPI, createAudioTestTask, runAudioTestSession, startFakemicRuntime } from '@sherpaw/vitest-plugin-fakemic'
import { fileURLToPath } from 'node:url'
import { inject } from 'vitest'

import type { SpeakerAudioSession } from './prepare'

const api = createAudioTestAPI<AudioTestCase, AudioTestTask, { audio: SpeakerAudioSession }>({
  createPlans(name, testCase) {
    const task = createAudioTestTask(name, testCase)
    return [{ name: task.name, definition: task, metadata: { input: fileURLToPath(task.input), runtime: inject('fakemicRuntime').name } }]
  },
  async execute({ plan, task, invokeHandler }) {
    await runAudioTestSession({
      start: () => startFakemicRuntime<SpeakerAudioSession>(fileURLToPath(plan.definition.input)),
      async execute(session) {
        Object.assign(task.context, { audio: session })
        await invokeHandler()
      },
    })
  },
})

export const { describe, it } = api
export { expect } from 'vitest'
