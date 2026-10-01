/** Two principal axes of a set of embeddings, and how much of their variance the plane keeps. */
export interface Projection {
  axes: [Float64Array, Float64Array]
  mean: Float64Array
  /** Share of the total variance on the two axes, from 0 to 1. */
  explained: number
}

function dotProduct(a: ArrayLike<number>, b: ArrayLike<number>) {
  let sum = 0

  for (let i = 0; i < a.length; i++)
    sum += a[i]! * b[i]!

  return sum
}

/** The largest eigenvector of a symmetric matrix by power iteration, and its eigenvalue. */
function leading(matrix: Float64Array[], start: Float64Array): { vector: Float64Array, value: number } {
  let vector = start.slice()
  let value = 0

  for (let iteration = 0; iteration < 100; iteration++) {
    const next = new Float64Array(vector.length)

    for (let row = 0; row < matrix.length; row++)
      next[row] = dotProduct(matrix[row]!, vector)

    const norm = Math.hypot(...next)

    if (norm === 0)
      break

    next.forEach((entry, i) => next[i] = entry / norm)

    const change = Math.abs(1 - Math.abs(dotProduct(next, vector)))

    vector = next
    value = norm

    if (change < 1e-10)
      break
  }

  return { vector, value }
}

/**
 * Principal component analysis of the embeddings. The signs of the axes follow `previous`, so that
 * the picture does not flip when a new utterance arrives.
 */
export function principalAxes(vectors: ArrayLike<number>[], previous?: Projection): Projection | undefined {
  const dimension = vectors[0]?.length ?? 0

  if (vectors.length < 3 || !dimension)
    return undefined

  // The previous axes only help when they come from embeddings of the same size.
  if (previous && previous.mean.length !== dimension)
    previous = undefined

  const mean = new Float64Array(dimension)

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i++)
      mean[i] = mean[i]! + vector[i]! / vectors.length
  }

  const covariance = Array.from({ length: dimension }, () => new Float64Array(dimension))

  for (const vector of vectors) {
    const centered = Float64Array.from({ length: dimension }, (_, i) => vector[i]! - mean[i]!)

    for (let row = 0; row < dimension; row++) {
      const scaled = centered[row]! / vectors.length
      const line = covariance[row]!

      for (let column = 0; column < dimension; column++)
        line[column] = line[column]! + scaled * centered[column]!
    }
  }

  const total = covariance.reduce((sum, line, i) => sum + line[i]!, 0)
  // Two different starting vectors for the power iterations when there are no previous axes.
  const first = leading(covariance, previous?.axes[0] ?? Float64Array.from({ length: dimension }, (_, i) => 1 + i / dimension))
  // Remove the first component, then find the second.
  const deflated = covariance.map((line, row) => line.map((entry, column) => entry - first.value * first.vector[row]! * first.vector[column]!))
  const second = leading(deflated, previous?.axes[1] ?? Float64Array.from({ length: dimension }, (_, i) => 2 - i / dimension))
  const axes: [Float64Array, Float64Array] = [first.vector, second.vector]

  axes.forEach((axis, k) => {
    if (previous && dotProduct(axis, previous.axes[k]!) < 0)
      axis.forEach((entry, i) => axis[i] = -entry)
  })

  return { axes, mean, explained: total > 0 ? (first.value + second.value) / total : 0 }
}

/** Coordinates of an embedding on the two axes. */
export function project(vector: ArrayLike<number>, projection: Projection): { x: number, y: number } {
  const centered = Float64Array.from({ length: vector.length }, (_, i) => vector[i]! - projection.mean[i]!)

  return { x: dotProduct(centered, projection.axes[0]), y: dotProduct(centered, projection.axes[1]) }
}

/** Cosine similarity of unit-length embeddings. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  return dotProduct(a, b)
}
