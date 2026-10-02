/** A recognized token and the time of the audio that produced it. */
export interface TimedToken {
  /** The token as the model's vocabulary writes it, often with a leading space. `joinTokens` turns tokens into text. */
  text: string
  /**
   * Seconds from the first accepted sample to the frame that emitted the token. The token comes
   * after its speech. With X-ASR, the delay was 0.05-0.5 s. Other models can have a different delay.
   */
  time: number
}

/** True for the code points that sherpa-onnx treats as CJK (`IsCJK` in text-utils.cc). */
function isCjk(code: number) {
  return (code >= 0x1100 && code <= 0x11FF) || (code >= 0x2E80 && code <= 0xA4CF) || (code >= 0xA840 && code <= 0xD7AF)
    || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF65 && code <= 0xFFDC)
    || (code >= 0x20000 && code <= 0x2FFFF)
}

/** True for the code points that sherpa-onnx treats as punctuation (`IsPunct` in text-utils.cc). */
function isPunctuation(code: number) {
  return (code >= 0x21 && code <= 0x2F) || (code >= 0x3A && code <= 0x40) || (code >= 0x5B && code <= 0x60)
    || (code >= 0x7B && code <= 0x7E) || (code >= 0x3000 && code <= 0x303F) || (code >= 0xFF01 && code <= 0xFF0F)
    || (code >= 0xFF1A && code <= 0xFF20) || (code >= 0xFF3B && code <= 0xFF40) || (code >= 0xFF5B && code <= 0xFF65)
}

/** True when a token holds only punctuation and spaces, by the rule that `joinTokens` uses. */
export function isPunctuationToken(token: string): boolean {
  const chars = [...token.trim()]
  return chars.length > 0 && chars.every(char => isPunctuation(char.codePointAt(0)!))
}

/** A byte that sherpa-onnx writes as `<0xNN>`, for models with BPE byte fallback. */
const byteToken = /^<0x([0-9A-F]{2})>$/

/**
 * The text of transducer tokens, built as sherpa-onnx builds its result text. The function
 * concatenates the tokens, with `<0xNN>` tokens as raw bytes, and removes each space between two
 * CJK characters or before punctuation. It also trims the result.
 *
 * sherpa-onnx decodes the text of a byte-level BPE model with one more table. This function does not
 * use that table. It gives wrong text for such a model. For a CTC model, sherpa-onnx keeps the
 * spaces between CJK characters. The two texts can then differ in spaces.
 */
export function joinTokens(tokens: readonly string[]): string {
  const encoder = new TextEncoder()
  const bytes: number[] = []
  for (const token of tokens) {
    const byte = byteToken.exec(token)
    if (byte)
      bytes.push(Number.parseInt(byte[1]!, 16))
    else
      bytes.push(...encoder.encode(token))
  }
  const chars = [...new TextDecoder().decode(new Uint8Array(bytes))]
  return chars.filter((char, i) => {
    if (char !== ' ' || i === 0 || i === chars.length - 1)
      return true
    const previous = chars[i - 1]!.codePointAt(0)!
    const next = chars[i + 1]!.codePointAt(0)!
    return !((isCjk(previous) && isCjk(next)) || isPunctuation(next))
  }).join('').trim()
}

/** Recognizer samples [from, to) hold the session audio from position `at` on. */
interface Span {
  from: number
  to: number
  at: number
}

/** Puts timed tokens back on the timeline of a session that the recognizer heard in parts. */
export interface TokenTimeline {
  /**
   * The recognizer heard `length` samples of session audio from position `at` on, as its samples
   * from `from` on. Call in the recognizer's order. Silence between the calls has no position.
   */
  hear: (at: number, from: number, length: number) => void
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
 * audio produced it. Use it when the recognizer hears only parts of a session, for example the
 * speech of a conversation. A row can be a speaker turn. Positions and lengths count samples.
 *
 * A token comes after its speech. The timeline moves each token's time back by `lagSeconds`. The
 * value 0.2 s fits X-ASR. Measure the delay for another model. A token in the silence after a span
 * belongs to that span. A pause therefore keeps a late token in its row. Inside a span, a token
 * that comes more than `lagSeconds` after its speech can go to the next row. Each token goes to a
 * row by its own time. A cut inside a word of several tokens therefore splits the word between two
 * rows.
 */
export function createTokenTimeline(sampleRate: number, lagSeconds: number): TokenTimeline {
  const lag = Math.round(lagSeconds * sampleRate)
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
    hear(at, from, length) {
      const last = spans.at(-1)
      // Audio that continues the previous span extends it.
      if (last && last.to === from && last.at + last.to - last.from === at)
        last.to += length
      else
        spans.push({ from, to: from + length, at })
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
