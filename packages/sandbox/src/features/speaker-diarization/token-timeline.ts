import type { TimedToken } from '@sherpaw/asr/tokens'

import { isPunctuationToken, joinTokens } from '@sherpaw/asr/tokens'

/** Recognizer samples [from, to) hold the session audio from position `at` on. */
interface Span {
  from: number
  to: number
  at: number
}

export interface TokenTimeline {
  /** The recognizer hears `length` samples of session audio from position `at` next. */
  hear: (at: number, length: number) => void
  /** The recognizer hears `length` samples of silence next. */
  pause: (length: number) => void
  /** Starts a new session. Tokens of earlier sessions go to no row. */
  reset: () => void
  /**
   * The words of each row, and the words from `liveFrom` on. `rowStarts` holds the session position
   * where each row starts, in order. Tokens before the first row are left out.
   */
  place: (tokens: readonly TimedToken[], rowStarts: readonly number[], liveFrom?: number) => { rows: string[], live: string }
}

/** The index of the last item whose key is at or before `value`, or -1. The keys must not decrease. */
function lastAtOrBefore(count: number, key: (index: number) => number, value: number) {
  let low = 0
  let high = count

  while (low < high) {
    const middle = (low + high) >> 1

    if (key(middle) <= value)
      low = middle + 1
    else
      high = middle
  }

  return low - 1
}

/**
 * Maps the recognizer's time back to session positions, so that each token goes to the row whose
 * audio produced it. Positions and lengths count samples.
 */
export function createTokenTimeline(sampleRate: number, lagSeconds: number): TokenTimeline {
  const lag = Math.round(lagSeconds * sampleRate)
  let heard = 0
  let spans: Span[] = []

  /** The session position of a token's audio, or undefined for audio before this session. */
  function positionOf(token: TimedToken) {
    const time = Math.round(token.time * sampleRate)
    // The last span that starts at or before the audio. A token in silence after a span belongs to it.
    const span = spans[lastAtOrBefore(spans.length, i => spans[i]!.from, time - lag)]

    if (span)
      return span.at + Math.min(time - lag - span.from, span.to - span.from - 1)

    // A token from the first moments of the session: without the lag, it falls inside the first span.
    return spans[0] && time >= spans[0].from ? spans[0].at : undefined
  }

  return {
    hear(at, length) {
      const last = spans.at(-1)

      // Audio that continues the previous span extends it.
      if (last && last.to === heard && last.at + last.to - last.from === at)
        last.to += length
      else
        spans.push({ from: heard, to: heard + length, at })

      heard += length
    },

    pause(length) {
      heard += length
    },

    reset() {
      spans = []
    },

    place(tokens, rowStarts, liveFrom) {
      const rows = rowStarts.map((): string[] => [])
      const live: string[] = []
      const start = rowStarts[0] ?? liveFrom

      if (start === undefined)
        return { rows: [], live: '' }

      // Token times do not decrease, so neither do their positions: skip the tokens before `start`.
      const first = lastAtOrBefore(tokens.length, i => positionOf(tokens[i]!) ?? Number.NEGATIVE_INFINITY, start - 1) + 1
      let target: string[] | undefined

      for (const token of tokens.slice(first)) {
        // A punctuation mark goes with the word before it.
        if (!isPunctuationToken(token.text)) {
          const position = positionOf(token)!

          target = liveFrom !== undefined && position >= liveFrom ? live : rows[lastAtOrBefore(rowStarts.length, i => rowStarts[i]!, position)]
        }

        target?.push(token.text)
      }

      return { rows: rows.map(words => joinTokens(words)), live: joinTokens(live) }
    },
  }
}
