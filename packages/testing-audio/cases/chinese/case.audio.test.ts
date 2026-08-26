import { describe, expect, it } from '../../src'
import { sherpawAudioModels } from '../../src/models'

describe('Sherpaw Chinese browser transcription', () => {
  for (const model of sherpawAudioModels) {
    it(`transcribes Chinese speech with ${model.id}`, {
      input: new URL('./input.test.wav', import.meta.url),
    }, async ({ audio }) => {
      await audio.start(model)

      await expect.poll(async () => (await audio.snapshot()).transcription, {
        timeout: 120_000,
      }).toMatch(/语音识别测试/)

      await audio.stop()
      const snapshot = await audio.snapshot()
      expect(snapshot.error).toBe('')
      expect(snapshot.status).toBe('stopped')
      expect(snapshot.transcription).toMatch(/语音识别测试/)
    })
  }
})
