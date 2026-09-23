export function validateName(name: string): void {
  if (typeof name !== 'string' || !name.trim() || name.includes('\0'))
    throw new Error('Speaker names and model paths must be nonempty strings without NUL bytes')
}

export function validateEmbedding(embedding: Float32Array, dimension: number): void {
  if (!(embedding instanceof Float32Array) || embedding.length !== dimension)
    throw new RangeError(`Expected a Float32Array with ${dimension} elements`)
  let norm = 0
  for (const value of embedding) {
    if (!Number.isFinite(value))
      throw new Error('Embedding contains nonfinite values')
    norm += value * value
  }
  if (!Number.isFinite(Math.fround(norm)) || Math.fround(norm) === 0)
    throw new Error('Embedding must have a finite, nonzero float32 norm')
}
