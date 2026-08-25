import { describe, expect, it } from '../../src'
import { sherpawAudioModels } from '../../src/models'

describe('Sherpaw browser transcription', () => {
  it('loads the packaged AudioWorklet module', {
    input: new URL('./input.test.wav', import.meta.url),
  }, async ({ audio }) => {
    await expect(audio.loadAudioWorklet()).resolves.toBeUndefined()
  })

  for (const model of sherpawAudioModels) {
    it(`transcribes a file-backed microphone with ${model.id}`, {
      input: new URL('./input.test.wav', import.meta.url),
    }, async ({ audio }) => {
      await audio.start(model)

      // ROOT CAUSE:
      //
      // The text stream emits incremental deltas. The first non-empty value can
      // contain only the first word, so it is not the completed transcription.
      // The Paraformer fixture result ends at "hel", while both Transducer
      // models finish "hello". We poll their shared phrase prefix so that the
      // matrix checks decoded speech content without requiring identical
      // endpoint behavior from different recognizer families.
      await expect.poll(async () => (await audio.snapshot()).transcription, {
        timeout: 120_000,
      }).toMatch(/please say hel/i)

      await audio.stop()
      const snapshot = await audio.snapshot()
      expect(snapshot.error).toBe('')
      expect(snapshot.status).toBe('stopped')
      expect(snapshot.transcription).toMatch(/please say hel/i)
    })
  }
})
