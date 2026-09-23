import type { Page } from 'playwright'

import { beforeAll } from 'vitest'

import { describe, expect, it } from '../../src/speaker/describe'
import { fixturePath, fixtureRoot, modelPath, models, verifyCorpus, voices } from './corpus'
import manifest from './fixtures/manifest.json'

// Uses the same Worker and capture adapter as the demo, without loading its UI.
import '../../../sandbox/tests/speaker-identification/protocol'

beforeAll(verifyCorpus)

async function enrollCorpus(page: Page, model: string) {
  await page.evaluate(async ({ model, enrollments }) => {
    await window.speakerTest.init(model)
    for (const entry of enrollments)
      await window.speakerTest.enrollFiles(entry.voice, entry.files)
  }, {
    model: modelPath(model),
    enrollments: voices.map(voice => ({ voice, files: [1, 3].map(take => fixturePath(`${voice}-enroll-${take}.wav`)) })),
  })
}

describe('Compact speaker identification regression corpus', () => {
  for (const model of models) {
    it(`recognizes held-out Chinese/English sentences with ${model}`, {
      input: new URL('alloy-query-zh.wav', fixtureRoot),
    }, async ({ audio }) => {
      await enrollCorpus(audio.page, model)
      for (const voice of voices) {
        for (const language of ['zh', 'en']) {
          const result = await audio.page.evaluate(file => window.speakerTest.file(file), fixturePath(`${voice}-query-${language}.wav`))
          expect.soft(result.match?.name, `${voice}/${language}`).toBe(voice)
        }
      }
      for (const unknown of manifest.unknowns) {
        const result = await audio.page.evaluate(file => window.speakerTest.file(file), fixturePath(unknown.file))
        expect.soft(result.match, unknown.speaker).toBeNull()
      }
    })

    for (const voice of voices) {
      it(`identifies ${voice} through the fake microphone with ${model}`, {
        input: new URL(`${voice}-query-zh.wav`, fixtureRoot),
      }, async ({ audio }) => {
        await enrollCorpus(audio.page, model)
        const result = await audio.page.evaluate(() => window.speakerTest.microphone(12))
        expect(result.match?.name).toBe(voice)
      })
    }
  }
})
