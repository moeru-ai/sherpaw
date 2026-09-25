import type { KeywordEntry } from './types'

export function readTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const ids = new Set<number>()
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim())
      continue
    const match = /^(\S+)\s+(\d+)$/u.exec(line.trim())
    if (!match || tokens.has(match[1]) || ids.has(Number(match[2])) || Number(match[2]) > 2147483647)
      throw new Error('Invalid or duplicate entry in model tokens file')
    tokens.add(match[1])
    ids.add(Number(match[2]))
  }
  if (!tokens.size)
    throw new Error('Model tokens file is empty')
  return tokens
}

export function encodeKeywords(entries: readonly KeywordEntry[], vocabulary: Set<string>): { text: string, labels: Map<string, string> } {
  if (!Array.isArray(entries))
    throw new TypeError('keywords must be an array')
  const labels = new Map<string, string>()
  const sequences = new Set<string>()
  const lines = Array.from(entries, (entry, index) => {
    if (!entry || typeof entry.label !== 'string' || !entry.label.trim())
      throw new TypeError('Each keyword requires a nonempty label')
    if (!Array.isArray(entry.tokens) || !entry.tokens.length)
      throw new TypeError('Each keyword requires at least one token')
    for (const token of entry.tokens) {
      if (typeof token !== 'string' || !token || /[\s\0]/u.test(token) || !vocabulary.has(token))
        throw new Error(`Invalid or unknown keyword token: ${String(token)}`)
    }
    const sequence = entry.tokens.join(' ')
    if (sequences.has(sequence))
      throw new Error('Duplicate keyword token sequence')
    sequences.add(sequence)
    const score = entry.score === undefined ? 1 : entry.score
    const threshold = entry.threshold === undefined ? 0.25 : entry.threshold
    // std::stof rejects underflow as well as overflow. Exclude subnormal values.
    const minFloat = 2 ** -126
    if (!Number.isFinite(score) || score > 3.4028234663852886e38 || score < minFloat)
      throw new RangeError('score must be a positive finite float32 value')
    if (!Number.isFinite(threshold) || threshold < minFloat || threshold > 1)
      throw new RangeError('threshold must be in (0, 1]')
    // Labels may contain spaces, newlines and syntax characters. Only the
    // generated identifier reaches the upstream text parser and JSON writer.
    let id = `sherpaw_${index}`
    while (vocabulary.has(`@${id}`))
      id += '_'
    labels.set(id, entry.label)
    const scoreField = `:${score}`
    const thresholdField = `#${threshold}`
    if (vocabulary.has(scoreField) || vocabulary.has(thresholdField))
      throw new Error('Keyword settings conflict with model token syntax')
    return `${sequence} ${scoreField} ${thresholdField} @${id}`
  })
  return { text: lines.join('\n'), labels }
}
