import type { TimedToken } from '@sherpaw/asr/tokens'

import { expect, it } from 'vitest'

import { createTokenTimeline } from '../../src/features/speaker-diarization/token-timeline'

// 100 samples per second keep the positions readable; the lag is 0.2 s, or 20 samples.
const rate = 100
const token = (text: string, time: number): TimedToken => ({ text, time })

it('maps recognizer time back to session positions across silence', () => {
  const timeline = createTokenTimeline(rate, 0.2)
  // The recognizer hears session audio 1-4 s, 2 s of silence, then session audio 6-8 s.
  timeline.hear(100, 300)
  timeline.pause(200)
  timeline.hear(600, 200)
  // ' c' falls in the silence after the first audio, so it belongs to the row before it.
  const tokens = [token(' a', 0.5), token(' b', 2.9), token(' ,', 3.1), token(' c', 3.5), token(' d', 5.4), token(' e', 6.9)]
  expect(timeline.place(tokens, [100, 200, 600]).rows).toEqual(['a', 'b, c', 'd e'])
  // Rows before the first given row keep their words: their tokens are left out.
  expect(timeline.place(tokens, [200, 600]).rows).toEqual(['b, c', 'd e'])
})

it('puts a punctuation mark with the word before it', () => {
  const timeline = createTokenTimeline(rate, 0.2)
  timeline.hear(0, 600)
  // The mark of the first sentence comes with the second sentence's audio.
  const tokens = [token(' 你', 1), token(' 好', 1.4), token(' 。', 3.3), token(' 再', 3.5), token(' 见', 3.8)]
  expect(timeline.place(tokens, [0, 300]).rows).toEqual(['你好。', '再见'])
})

it('puts the words from `liveFrom` on into the live text', () => {
  const timeline = createTokenTimeline(rate, 0.2)
  timeline.hear(0, 500)
  // A cut ended the row at 2.5 s, and the live part goes on from there.
  expect(timeline.place([token(' a', 1), token(' b', 2.8), token(' c', 4)], [0], 250)).toEqual({ rows: ['a'], live: 'b c' })
  expect(timeline.place([token(' a', 1)], [], 0)).toEqual({ rows: [], live: 'a' })
  expect(timeline.place([token(' a', 1)], [])).toEqual({ rows: [], live: '' })
})

it('leaves out tokens of earlier sessions and keeps the first words of a session', () => {
  const timeline = createTokenTimeline(rate, 0.2)
  timeline.hear(0, 300)
  timeline.pause(200)
  timeline.reset()
  timeline.hear(0, 300)
  // ' new' comes 0.1 s into the session: without the lag it is inside the session's first audio.
  const tokens = [token(' old', 2), token(' new', 5.1), token(' words', 6)]
  expect(timeline.place(tokens, [0]).rows).toEqual(['new words'])
})
