import type { InMemoryDB } from '@sherpaw/speaker-identification'

// Sample identity and persistence belong to the application, not the native DB.
interface Sample { id: string, embedding: Float32Array }

/** Keeps original sample vectors so editing one sample rebuilds the correct centroid. */
export function createEnrollments(db: InMemoryDB) {
  const speakers = new Map<string, Sample[]>()

  function result(name: string) {
    const samples = speakers.get(name) ?? []
    return { name, sampleCount: samples.length, sampleIds: samples.map(sample => sample.id) }
  }

  function replace(name: string, samples: Sample[]) {
    const previous = speakers.get(name) ?? []
    if (previous.length)
      db.remove(name)
    try {
      if (samples.length && !db.enroll(name, samples.map(sample => sample.embedding)))
        throw new Error('声线更新失败，请重试。')
    }
    catch (error) {
      if (previous.length)
        db.enroll(name, previous.map(sample => sample.embedding))
      throw error
    }
    if (samples.length)
      speakers.set(name, samples)
    else
      speakers.delete(name)
    return result(name)
  }

  return {
    get size() { return speakers.size },
    append(name: string, embeddings: Float32Array[]) {
      return replace(name, [...(speakers.get(name) ?? []), ...embeddings.map(embedding => ({ id: crypto.randomUUID(), embedding }))])
    },
    rename(name: string, newName: string) {
      newName = newName.trim()
      if (!newName || newName.includes('\0'))
        throw new Error('请输入有效的名字。')
      const samples = speakers.get(name)
      if (!samples)
        throw new Error('声线不存在。')
      if (newName === name)
        return result(name)
      if (speakers.has(newName))
        throw new Error('这个名字已存在，请使用另一个名字。')
      // Register first so a failed rename leaves the old speaker intact.
      if (!db.enroll(newName, samples.map(sample => sample.embedding)))
        throw new Error('重命名失败，请重试。')
      db.remove(name)
      speakers.delete(name)
      speakers.set(newName, samples)
      return result(newName)
    },
    removeSpeaker(name: string) {
      db.remove(name)
      speakers.delete(name)
    },
    removeSample(name: string, sampleId: string) {
      const samples = speakers.get(name)
      if (!samples?.some(sample => sample.id === sampleId))
        throw new Error('录音样本不存在。')
      return replace(name, samples.filter(sample => sample.id !== sampleId))
    },
  }
}
