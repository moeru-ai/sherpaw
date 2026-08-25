import type { AudioTestTask } from '@sherpaw/vitest-plugin-fakemic'

import { createAudioTestAPI, createAudioTestTask, runAudioTestSession, startFakemicRuntime } from '@sherpaw/vitest-plugin-fakemic'
import { fileURLToPath } from 'node:url'
import { expect, inject } from 'vitest'

import type { SherpawAudioSession, SherpawAudioTestCase } from './types'

const audioTestAPI = createAudioTestAPI<
  SherpawAudioTestCase,
  AudioTestTask,
  { audio: SherpawAudioSession }
>({
  createPlans(name, testCase) {
    const task = createAudioTestTask(name, testCase)
    return [{
      name: task.name,
      definition: task,
      metadata: {
        input: fileURLToPath(task.input),
        runtime: inject('fakemicRuntime').name,
      },
    }]
  },
  async execute({ plan, task, invokeHandler }) {
    await runAudioTestSession({
      start: () => startFakemicRuntime<SherpawAudioSession>(fileURLToPath(plan.definition.input)),
      async execute(session) {
        Object.assign(task.context, { audio: session })
        await invokeHandler()
      },
    })
  },
})

/** Groups Sherpaw audio tests in the Vitest task tree. */
export const describe = audioTestAPI.describe

/** Defines one Sherpaw fake-microphone test. */
export const it = audioTestAPI.it

export { expect }
