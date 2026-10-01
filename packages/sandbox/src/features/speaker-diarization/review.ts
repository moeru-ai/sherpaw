/** Speaker names a reviewer can assign. The exact mapping search below is exponential in their count. */
export const reviewerNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const

export interface ReviewRow {
  /** Speaker number reported when the utterance ended. */
  emitted: number | null
  /** Speaker number after later revisions. */
  final: number | null
  /** Who the reviewer says spoke. */
  truth: string
}

export interface Review {
  labeled: number
  /** Utterances whose label matches the reviewer under the best one-to-one mapping. */
  emittedCorrect: number
  finalCorrect: number
  /** Labeled utterances that a revision corrected, or broke. */
  fixed: number
  broken: number
  /** Final speaker number -> reviewer name. */
  mapping: Map<number, string>
}

/** One-to-one mapping from speaker numbers to reviewer names that agrees on the most utterances. */
export function bestMapping(pairs: Array<[speaker: number | null, truth: string]>): Map<number, string> {
  const speakers = [...new Set(pairs.flatMap(([speaker]) => (speaker === null ? [] : [speaker])))]
  const truths = [...new Set(pairs.map(([, truth]) => truth))]
  const counts = speakers.map(speaker => truths.map(truth => pairs.filter(([a, b]) => a === speaker && b === truth).length))
  const memo = new Map<number, number>()

  // Best agreement for speakers[i..] when the names in `used` are taken.
  function best(i: number, used: number): number {
    if (i === speakers.length)
      return 0

    const key = i * 2 ** truths.length + used

    if (!memo.has(key)) {
      let value = best(i + 1, used)

      truths.forEach((_, j) => {
        if (!(used & (1 << j)))
          value = Math.max(value, counts[i]![j]! + best(i + 1, used | (1 << j)))
      })

      memo.set(key, value)
    }

    return memo.get(key)!
  }

  const mapping = new Map<number, string>()
  let used = 0

  speakers.forEach((speaker, i) => {
    const target = best(i, used)
    const j = truths.findIndex((_, j) => !(used & (1 << j)) && counts[i]![j]! + best(i + 1, used | (1 << j)) === target)

    if (j >= 0 && counts[i]![j]! > 0) {
      mapping.set(speaker, truths[j]!)
      used |= 1 << j
    }
  })

  return mapping
}

export function review(rows: ReviewRow[]): Review {
  const emitted = bestMapping(rows.map(row => [row.emitted, row.truth]))
  const final = bestMapping(rows.map(row => [row.final, row.truth]))
  const emittedRight = rows.map(row => row.emitted !== null && emitted.get(row.emitted) === row.truth)
  const finalRight = rows.map(row => row.final !== null && final.get(row.final) === row.truth)

  return {
    labeled: rows.length,
    emittedCorrect: emittedRight.filter(Boolean).length,
    finalCorrect: finalRight.filter(Boolean).length,
    fixed: rows.filter((row, i) => row.emitted !== row.final && !emittedRight[i] && finalRight[i]).length,
    broken: rows.filter((row, i) => row.emitted !== row.final && emittedRight[i] && !finalRight[i]).length,
    mapping: final,
  }
}
