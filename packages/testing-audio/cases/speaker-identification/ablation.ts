import { loadVirtualData } from '@sherpaw/preloader'
import { createExtractor, createInMemoryDB, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'

import { normalizeRecording } from '../../../../playgrounds/speaker-identification/src/recorder'
import { decodeWavPcm16 } from '../../../asr/tests/helpers/wav'
import manifest from './fixtures/manifest.json'

const voices = [...new Set(manifest.files.map(file => file.voice))]
const enrollmentConditions = [
  { name: 'one-zh', takes: [1] },
  { name: 'two-mixed', takes: [1, 3] },
]

/** Evaluates fixed embeddings with one factor changed at a time; never generates TTS. */
export async function runAblation(model: string, fixtureBase: string) {
  const module = await initSpeakerIdentificationModule()
  const response = await fetch(model)
  if (!response.ok)
    throw new Error(`Model HTTP ${response.status}`)
  loadVirtualData({ module, virtualData: { 'speaker.onnx': new Uint8Array(await response.arrayBuffer()) } })
  const extractor = createExtractor(module, { model: 'speaker.onnx' })
  const embeddings = new Map<string, Float32Array>()
  const audio = new Map<string, { samples: Float32Array, sampleRate: number }>()
  const extractionTimes: number[] = []
  function extract(samples: Float32Array, sampleRate: number) {
    const start = performance.now()
    const embedding = extractor.extract(samples, sampleRate)
    extractionTimes.push(performance.now() - start)
    return embedding
  }
  const rows: { condition: string, expected: string | null, voice: string, language: string, scores: { name: string, score: number }[], error?: string }[] = []
  try {
    for (const entry of [...manifest.files, ...manifest.unknowns]) {
      const response = await fetch(`${fixtureBase}${entry.file}`)
      if (!response.ok)
        throw new Error(`Fixture HTTP ${response.status}: ${entry.file}`)
      const clip = decodeWavPcm16(await response.arrayBuffer())
      audio.set(entry.file, clip)
      embeddings.set(entry.file, extract(clip.samples, clip.sampleRate))
    }
    for (const condition of enrollmentConditions) {
      const db = createInMemoryDB(module, { dimension: extractor.dimension })
      try {
        for (const voice of voices)
          db.enroll(voice, condition.takes.map(take => embeddings.get(`${voice}-enroll-${take}.wav`)!))
        for (const voice of voices) {
          for (const language of ['zh', 'en']) {
            rows.push({ condition: condition.name, expected: voice, voice, language, scores: db.matches(embeddings.get(`${voice}-query-${language}.wav`)!, -1, voices.length) })
          }
        }
        for (const entry of manifest.unknowns)
          rows.push({ condition: condition.name, expected: null, voice: entry.speaker, language: 'zh', scores: db.matches(embeddings.get(entry.file)!, -1, voices.length) })
        if (condition.name !== 'two-mixed')
          continue
        // Queries alone change here. Enrollment always uses the original Chinese and English utterances.
        for (const variant of ['first-3-seconds', 'quiet-0.1', 'over-range-raw', 'over-range-normalized']) {
          for (const voice of voices) {
            for (const language of ['zh', 'en']) {
              const clip = audio.get(`${voice}-query-${language}.wav`)!
              let samples = clip.samples.slice()
              if (variant === 'first-3-seconds')
                samples = samples.slice(0, 3 * clip.sampleRate)
              if (variant === 'quiet-0.1')
                samples = samples.map(value => value * 0.1)
              if (variant.startsWith('over-range')) {
                const peak = samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)
                samples = samples.map(value => value * 1.25 / peak)
                if (variant === 'over-range-normalized')
                  normalizeRecording(samples)
              }
              try {
                rows.push({ condition: variant, expected: voice, voice, language, scores: db.matches(extract(samples, clip.sampleRate), -1, voices.length) })
              }
              catch (error) {
                rows.push({ condition: variant, expected: voice, voice, language, scores: [], error: String(error) })
              }
            }
          }
        }
        // Rotate every synthetic voice out of enrollment, instead of testing only easy natural negatives.
        for (const voice of voices) {
          db.remove(voice)
          for (const language of ['zh', 'en'])
            rows.push({ condition: 'leave-one-voice-out', expected: null, voice, language, scores: db.matches(embeddings.get(`${voice}-query-${language}.wav`)!, -1, voices.length - 1) })
          db.enroll(voice, condition.takes.map(take => embeddings.get(`${voice}-enroll-${take}.wav`)!))
        }
      }
      finally {
        db.dispose()
      }
    }
    return { dimension: extractor.dimension, extractionTimes, rows }
  }
  finally {
    extractor.dispose()
  }
}
