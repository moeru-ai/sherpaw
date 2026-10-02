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
