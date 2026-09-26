import type { KeywordEntry } from './types'

export function readTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  const ids = new Set<number>()
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    const match = /^(\S+)\s+(\d+)$/u.exec(trimmed)
    if (!match)
      throw new Error('Expected a token followed by an integer ID')

    const [, token, rawId] = match
    const id = Number(rawId)
    if (id > 2147483647)
      throw new Error(`Token ID exceeds int32 range: ${rawId}`)
    if (tokens.has(token) || ids.has(id))
      throw new Error(`Duplicate token or ID: ${token} ${rawId}`)

    tokens.add(token)
    ids.add(id)
  }
  if (!tokens.size)
    throw new Error('Model tokens file is empty')
  return tokens
}

function validateSettings(score: number, threshold: number) {
  // std::stof rejects underflow as well as overflow. Exclude subnormal values.
  const minFloat = 2 ** -126
  if (!Number.isFinite(score) || score > 3.4028234663852886e38 || score < minFloat)
    throw new RangeError('score must be a positive finite float32 value')
  if (!Number.isFinite(threshold) || threshold < minFloat || threshold > 1)
    throw new RangeError('threshold must be in (0, 1]')
}

export function encodeKeywords(entries: readonly KeywordEntry[], vocabulary: Set<string>): { text: string, labels: Map<string, string> } {
  if (!Array.isArray(entries))
    throw new TypeError('keywords must be an array')
  const labels = new Map<string, string>()
  const sequences = new Set<string>()
  const lines = Array.from(entries, (entry: KeywordEntry, index) => {
    if (!entry || typeof entry.label !== 'string' || !entry.label.trim())
      throw new TypeError('Each keyword requires a nonempty label')
    if (!Array.isArray(entry.matches) || !entry.matches.length)
      throw new TypeError('Each keyword requires at least one match')
    const defaultScore = entry.score === undefined ? 1 : entry.score
    const defaultThreshold = entry.threshold === undefined ? 0.25 : entry.threshold
    validateSettings(defaultScore, defaultThreshold)

    // Only the generated identifier reaches the upstream parser. Every
    // pronunciation of this keyword maps back to the same caller label.
    let id = `sherpaw_${index}`
    // Upstream checks model tokens before interpreting @ as a label.
    while (vocabulary.has(`@${id}`))
      id += '_'
    labels.set(id, entry.label)

    return Array.from(entry.matches, (match) => {
      if (!match || !Array.isArray(match.tokens) || !match.tokens.length)
        throw new TypeError('Each match requires at least one token')
      for (const token of match.tokens) {
        if (typeof token !== 'string' || !token || /[\s\0]/u.test(token) || !vocabulary.has(token))
          throw new Error(`Invalid or unknown keyword token: ${String(token)}`)
      }
      const sequence = match.tokens.join(' ')
      if (sequences.has(sequence))
        throw new Error('Duplicate keyword token sequence')
      sequences.add(sequence)
      const score = match.score === undefined ? defaultScore : match.score
      const threshold = match.threshold === undefined ? defaultThreshold : match.threshold
      validateSettings(score, threshold)
      const scoreField = `:${score}`
      const thresholdField = `#${threshold}`
      if (vocabulary.has(scoreField) || vocabulary.has(thresholdField))
        throw new Error('Keyword settings conflict with model token syntax')
      return `${sequence} ${scoreField} ${thresholdField} @${id}`
    }).join('\n')
  })
  return { text: lines.join('\n'), labels }
}
