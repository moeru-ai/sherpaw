import { describe, expect, it } from '../../src'
import { sherpawAudioModels } from '../../src/models'

describe('Sherpaw paused Chinese browser transcription', () => {
  for (const model of sherpawAudioModels) {
    it(`continues Chinese transcription after silence with ${model.id}`, {
      input: new URL('./input.test.wav', import.meta.url),
    }, async ({ audio }) => {
      await audio.start(model)

      // ROOT CAUSE:
      //
      // The streaming Paraformer can drop the last character before a silent
      // endpoint. Its stable prefixes end at "你" and "再", while both
      // Transducer models emit both complete sentences.
      const expectedFirstSentence = model.recognizer === 'paraformer'
        ? '第一句话是你'
        : '第一句话是你好'
      const expectedSecondSentence = model.recognizer === 'paraformer'
        ? '第二句话是再'
        : '第二句话是再见'

      await expect.poll(async () => (await audio.snapshot()).transcription, {
        timeout: 120_000,
      }).toContain(expectedFirstSentence)

      await expect.poll(async () => (await audio.snapshot()).transcription, {
        timeout: 120_000,
      }).toContain(expectedSecondSentence)

      await audio.stop()
      const snapshot = await audio.snapshot()
      const firstSentencePosition = snapshot.transcription.indexOf(expectedFirstSentence)
      const secondSentencePosition = snapshot.transcription.indexOf(expectedSecondSentence)

      expect(snapshot.error).toBe('')
      expect(snapshot.status).toBe('stopped')
      expect(firstSentencePosition).toBeGreaterThanOrEqual(0)
      expect(secondSentencePosition).toBeGreaterThan(firstSentencePosition)
    })
  }
})
