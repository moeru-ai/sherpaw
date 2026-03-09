import type { WordBoundary, WordExtractionResult } from './types'

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function extractTimeMs(result: Record<string, unknown>): number | undefined {
  const keys = ['time', 'timeMs', 'currentTime', 'end', 'endTime', 'timestamp']
  for (const key of keys) {
    const value = asNumber(result[key])
    if (value != null) {
      return value
    }
  }

  return undefined
}

function extractNativeWords(result: Record<string, unknown>): WordBoundary[] | undefined {
  const candidateKeys = ['words', 'tokens']

  for (const key of candidateKeys) {
    const value = result[key]
    if (!Array.isArray(value)) {
      continue
    }

    const words: WordBoundary[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const textCandidate = (item as Record<string, unknown>).word ?? (item as Record<string, unknown>).text ?? (item as Record<string, unknown>).token
      if (typeof textCandidate !== 'string' || textCandidate.length === 0) {
        continue
      }

      words.push({
        text: textCandidate,
        startMs: asNumber((item as Record<string, unknown>).startTime ?? (item as Record<string, unknown>).start),
        endMs: asNumber((item as Record<string, unknown>).endTime ?? (item as Record<string, unknown>).end),
        estimated: false,
      })
    }

    if (words.length > 0) {
      return words
    }
  }

  return undefined
}

export function extractText(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const text = (result as Record<string, unknown>).text
  return typeof text === 'string' ? text : ''
}

function estimateWords(text: string): WordBoundary[] | undefined {
  const tokens = text
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    return undefined
  }

  return tokens.map(token => ({ text: token, estimated: true }))
}

export function extractWordsAndTime(result: unknown, text: string): WordExtractionResult {
  if (!result || typeof result !== 'object') {
    return { words: estimateWords(text), timeMs: undefined }
  }

  const record = result as Record<string, unknown>

  return {
    words: extractNativeWords(record) ?? estimateWords(text),
    timeMs: extractTimeMs(record),
  }
}
