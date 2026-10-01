/** Unit-length copy of a vector. Zero vectors stay zero. */
export function normalize(vector: ArrayLike<number>): Float32Array {
  let norm = 0

  for (let i = 0; i < vector.length; i++)
    norm += vector[i]! * vector[i]!

  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0
  const result = new Float32Array(vector.length)

  for (let i = 0; i < vector.length; i++)
    result[i] = vector[i]! * scale

  return result
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0

  for (let i = 0; i < a.length; i++)
    sum += a[i]! * b[i]!

  return sum
}

/** Normalized sum of the selected unit vectors: the direction of their mean. */
export function centroid(vectors: readonly Float32Array[], members: Iterable<number>): Float32Array {
  const sum = new Float64Array(vectors[0]!.length)

  for (const member of members) {
    const vector = vectors[member]!

    for (let i = 0; i < sum.length; i++)
      sum[i]! += vector[i]!
  }

  return normalize(sum)
}

export interface ClusteringOptions {
  /** Below this many embeddings, spectral clustering is unreliable and AHC is used. */
  ahcLimit: number
  /** AHC stops when the average cosine between the closest clusters drops below this. */
  ahcThreshold: number
  /** Fraction of the most similar neighbors that each row keeps before the Laplacian. */
  pruning: number
  /** Minimum number of neighbors that each row keeps. */
  minNeighbors: number
  maxSpeakers: number
  /** Clusters whose centroids reach this cosine are merged afterwards. */
  mergeThreshold: number
}

/**
 * Clusters unit-length embeddings like 3D-Speaker's CommonClustering, without
 * its minor-cluster filter: average-linkage AHC for few embeddings, otherwise
 * p-pruned spectral clustering that counts speakers by the largest gap between
 * Laplacian eigenvalues, then centroid merging.
 */
export function clusterEmbeddings(embeddings: readonly Float32Array[], options: ClusteringOptions): Int32Array {
  const n = embeddings.length
  const similarity = new Float64Array(n * n)

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++)
      similarity[i * n + j] = similarity[j * n + i] = dot(embeddings[i]!, embeddings[j]!)
  }

  const labels = n < 2
    ? new Int32Array(n)
    : n < options.ahcLimit
      ? averageLinkage(similarity, n, options.ahcThreshold)
      : spectral(similarity, n, options)

  return mergeClose(embeddings, labels, options.mergeThreshold)
}

function averageLinkage(similarity: Float64Array, n: number, threshold: number): Int32Array {
  const members = Array.from({ length: n }, (_, i) => [i])
  // Summed similarity between clusters; the average divides by both sizes.
  const sums = Float64Array.from(similarity)
  const alive = new Set(members.keys())

  while (alive.size > 1) {
    let best = -Infinity
    let a = -1
    let b = -1

    for (const p of alive) {
      for (const q of alive) {
        if (q <= p)
          continue

        const average = sums[p * n + q]! / (members[p]!.length * members[q]!.length)

        if (average > best) {
          best = average
          a = p
          b = q
        }
      }
    }

    if (best < threshold)
      break

    for (const r of alive) {
      sums[a * n + r] = sums[r * n + a] = sums[a * n + r]! + sums[b * n + r]!
    }

    members[a]!.push(...members[b]!)
    alive.delete(b)
  }

  const labels = new Int32Array(n)
  let label = 0

  for (const cluster of alive) {
    for (const member of members[cluster]!)
      labels[member] = label

    label++
  }

  return labels
}

function spectral(similarity: Float64Array, n: number, options: ClusteringOptions): Int32Array {
  const affinity = Float64Array.from(similarity)
  const dropped = Math.min(Math.floor((1 - options.pruning) * n), n - options.minNeighbors)
  const order = new Int32Array(n)

  // Keep only each row's strongest neighbors, then symmetrize.
  for (let i = 0; i < n; i++) {
    const row = affinity.subarray(i * n, i * n + n)

    for (let j = 0; j < n; j++)
      order[j] = j

    order.sort((a, b) => row[a]! - row[b]!)

    for (let j = 0; j < dropped; j++)
      row[order[j]!] = 0
  }

  const laplacian = new Float64Array(n * n)

  for (let i = 0; i < n; i++) {
    let degree = 0

    for (let j = 0; j < n; j++) {
      const value = i === j ? 0 : (affinity[i * n + j]! + affinity[j * n + i]!) / 2

      laplacian[i * n + j] = -value
      degree += Math.abs(value)
    }

    laplacian[i * n + i] = degree
  }

  const { values, vectors } = symmetricEigen(laplacian, n)
  const count = Math.min(options.maxSpeakers + 1, n - 1)
  let k = 1
  let gap = -Infinity

  for (let i = 0; i + 1 < count; i++) {
    if (values[i + 1]! - values[i]! > gap) {
      gap = values[i + 1]! - values[i]!
      k = i + 1
    }
  }

  const points = Array.from({ length: n }, (_, i) => Float64Array.from({ length: k }, (_, j) => vectors[i * n + j]!))

  return kMeans(points, k)
}

/** Eigenvalues in ascending order; eigenvectors are the columns of `vectors` (row-major). Port of JAMA's symmetric solver. */
function symmetricEigen(matrix: Float64Array, n: number): { values: Float64Array, vectors: Float64Array } {
  const V = Float64Array.from(matrix)
  const d = new Float64Array(n)
  const e = new Float64Array(n)

  // Householder reduction.
  for (let j = 0; j < n; j++)
    d[j] = V[(n - 1) * n + j]!

  for (let i = n - 1; i > 0; i--) {
    let scale = 0
    let h = 0

    for (let k = 0; k < i; k++)
      scale += Math.abs(d[k]!)

    if (scale === 0) {
      e[i] = d[i - 1]!

      for (let j = 0; j < i; j++) {
        d[j] = V[(i - 1) * n + j]!
        V[i * n + j] = 0
        V[j * n + i] = 0
      }
    }
    else {
      for (let k = 0; k < i; k++) {
        d[k]! /= scale
        h += d[k]! * d[k]!
      }

      let f = d[i - 1]!
      let g = f > 0 ? -Math.sqrt(h) : Math.sqrt(h)

      e[i] = scale * g
      h -= f * g
      d[i - 1] = f - g

      for (let j = 0; j < i; j++)
        e[j] = 0

      for (let j = 0; j < i; j++) {
        f = d[j]!
        V[j * n + i] = f
        g = e[j]! + V[j * n + j]! * f

        for (let k = j + 1; k <= i - 1; k++) {
          g += V[k * n + j]! * d[k]!
          e[k]! += V[k * n + j]! * f
        }

        e[j] = g
      }

      f = 0

      for (let j = 0; j < i; j++) {
        e[j]! /= h
        f += e[j]! * d[j]!
      }

      const hh = f / (h + h)

      for (let j = 0; j < i; j++)
        e[j]! -= hh * d[j]!

      for (let j = 0; j < i; j++) {
        f = d[j]!
        g = e[j]!

        for (let k = j; k <= i - 1; k++)
          V[k * n + j]! -= f * e[k]! + g * d[k]!

        d[j] = V[(i - 1) * n + j]!
        V[i * n + j] = 0
      }
    }

    d[i] = h
  }

  // Accumulate transformations.
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i]!
    V[i * n + i] = 1

    const h = d[i + 1]!

    if (h !== 0) {
      for (let k = 0; k <= i; k++)
        d[k] = V[k * n + i + 1]! / h

      for (let j = 0; j <= i; j++) {
        let g = 0

        for (let k = 0; k <= i; k++)
          g += V[k * n + i + 1]! * V[k * n + j]!

        for (let k = 0; k <= i; k++)
          V[k * n + j]! -= g * d[k]!
      }
    }

    for (let k = 0; k <= i; k++)
      V[k * n + i + 1] = 0
  }

  for (let j = 0; j < n; j++) {
    d[j] = V[(n - 1) * n + j]!
    V[(n - 1) * n + j] = 0
  }

  V[(n - 1) * n + n - 1] = 1
  e[0] = 0

  // Implicit QL iterations.
  for (let i = 1; i < n; i++)
    e[i - 1] = e[i]!

  e[n - 1] = 0

  let f = 0
  let tst1 = 0
  const eps = 2 ** -52

  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]!) + Math.abs(e[l]!))

    let m = l

    while (m < n && Math.abs(e[m]!) > eps * tst1)
      m++

    if (m > l) {
      do {
        let g = d[l]!
        let p = (d[l + 1]! - g) / (2 * e[l]!)
        let r = Math.hypot(p, 1)

        if (p < 0)
          r = -r

        d[l] = e[l]! / (p + r)
        d[l + 1] = e[l]! * (p + r)

        const dl1 = d[l + 1]!
        let h = g - d[l]!

        for (let i = l + 2; i < n; i++)
          d[i]! -= h

        f += h
        p = d[m]!

        let c = 1
        let c2 = c
        let c3 = c
        const el1 = e[l + 1]!
        let s = 0
        let s2 = 0

        for (let i = m - 1; i >= l; i--) {
          c3 = c2
          c2 = c
          s2 = s
          g = c * e[i]!
          h = c * p
          r = Math.hypot(p, e[i]!)
          e[i + 1] = s * r
          s = e[i]! / r
          c = p / r
          p = c * d[i]! - s * g
          d[i + 1] = h + s * (c * g + s * d[i]!)

          for (let k = 0; k < n; k++) {
            h = V[k * n + i + 1]!
            V[k * n + i + 1] = s * V[k * n + i]! + c * h
            V[k * n + i] = c * V[k * n + i]! - s * h
          }
        }

        p = -s * s2 * c3 * el1 * e[l]! / dl1
        e[l] = s * p
        d[l] = c * p
      } while (Math.abs(e[l]!) > eps * tst1)
    }

    d[l]! += f
    e[l] = 0
  }

  // Sort ascending with the corresponding vectors.
  for (let i = 0; i < n - 1; i++) {
    let k = i
    let p = d[i]!

    for (let j = i + 1; j < n; j++) {
      if (d[j]! < p) {
        k = j
        p = d[j]!
      }
    }

    if (k !== i) {
      d[k] = d[i]!
      d[i] = p

      for (let j = 0; j < n; j++) {
        p = V[j * n + i]!
        V[j * n + i] = V[j * n + k]!
        V[j * n + k] = p
      }
    }
  }

  return { values: d, vectors: V }
}

/** k-means++ with a fixed seed so that repeated calls on the same data agree. */
function kMeans(points: Float64Array[], k: number): Int32Array {
  const n = points.length
  const labels = new Int32Array(n)

  if (k === 1)
    return labels

  let seed = 0x9E3779B9

  // mulberry32
  function random() {
    seed = (seed + 0x6D2B79F5) | 0

    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  function distance(a: Float64Array, b: Float64Array) {
    let sum = 0

    for (let i = 0; i < a.length; i++)
      sum += (a[i]! - b[i]!) ** 2

    return sum
  }

  const centers = [Float64Array.from(points[Math.floor(random() * n)]!)]
  const nearest = points.map(point => distance(point, centers[0]!))

  while (centers.length < k) {
    const total = nearest.reduce((sum, value) => sum + value, 0)
    let target = random() * total
    let pick = n - 1

    for (let i = 0; i < n; i++) {
      target -= nearest[i]!

      if (target <= 0) {
        pick = i
        break
      }
    }

    centers.push(Float64Array.from(points[pick]!))
    points.forEach((point, i) => nearest[i] = Math.min(nearest[i]!, distance(point, centers.at(-1)!)))
  }

  for (let iteration = 0; iteration < 50; iteration++) {
    let changed = iteration === 0

    points.forEach((point, i) => {
      let best = 0
      let bestDistance = distance(point, centers[0]!)

      for (let c = 1; c < k; c++) {
        const candidate = distance(point, centers[c]!)

        if (candidate < bestDistance) {
          best = c
          bestDistance = candidate
        }
      }

      if (labels[i] !== best) {
        labels[i] = best
        changed = true
      }
    })

    if (!changed)
      break

    // An empty cluster keeps its previous center.
    for (let c = 0; c < k; c++) {
      const members = points.filter((_, i) => labels[i] === c)

      if (members.length)
        centers[c] = Float64Array.from({ length: members[0]!.length }, (_, j) => members.reduce((sum, point) => sum + point[j]!, 0) / members.length)
    }
  }

  return labels
}

/** Merges the two closest clusters while their centroid cosine reaches `threshold`. */
function mergeClose(embeddings: readonly Float32Array[], labels: Int32Array, threshold: number): Int32Array {
  while (true) {
    const ids = [...new Set(labels)]

    if (ids.length < 2)
      return labels

    const members = ids.map((): number[] => [])

    labels.forEach((label, i) => members[ids.indexOf(label)]!.push(i))

    const centers = members.map(list => centroid(embeddings, list))
    let best = -Infinity
    let a = 0
    let b = 0

    for (let p = 0; p < ids.length; p++) {
      for (let q = p + 1; q < ids.length; q++) {
        const cosine = dot(centers[p]!, centers[q]!)

        if (cosine > best) {
          best = cosine
          a = p
          b = q
        }
      }
    }

    if (best < threshold)
      return labels

    labels.forEach((label, i) => {
      if (label === ids[b])
        labels[i] = ids[a]!
    })
  }
}

/** Hungarian algorithm: row/column pairs that maximize the total score. Rectangular inputs are padded with zeros. */
export function maximumAssignment(scores: readonly (readonly number[])[]): Array<[row: number, column: number]> {
  const rows = scores.length
  const columns = scores[0]?.length ?? 0
  const size = Math.max(rows, columns)

  if (!rows || !columns)
    return []

  const cost = (i: number, j: number) => (i < rows && j < columns ? -scores[i]![j]! : 0)
  // Potentials formulation with 1-based indices.
  const u = new Float64Array(size + 1)
  const v = new Float64Array(size + 1)
  const match = new Int32Array(size + 1)
  const way = new Int32Array(size + 1)

  for (let i = 1; i <= size; i++) {
    match[0] = i

    let column = 0
    const min = new Float64Array(size + 1).fill(Infinity)
    const used = new Uint8Array(size + 1)

    do {
      used[column] = 1

      const row = match[column]!
      let delta = Infinity
      let next = 0

      for (let j = 1; j <= size; j++) {
        if (used[j])
          continue

        const reduced = cost(row - 1, j - 1) - u[row]! - v[j]!

        if (reduced < min[j]!) {
          min[j] = reduced
          way[j] = column
        }

        if (min[j]! < delta) {
          delta = min[j]!
          next = j
        }
      }

      for (let j = 0; j <= size; j++) {
        if (used[j]) {
          u[match[j]!]! += delta
          v[j]! -= delta
        }
        else {
          min[j]! -= delta
        }
      }

      column = next
    } while (match[column] !== 0)

    do {
      const previous = way[column]!

      match[column] = match[previous]!
      column = previous
    } while (column)
  }

  const pairs: Array<[number, number]> = []

  for (let j = 1; j <= size; j++) {
    if (match[j]! - 1 < rows && j - 1 < columns)
      pairs.push([match[j]! - 1, j - 1])
  }

  return pairs
}
