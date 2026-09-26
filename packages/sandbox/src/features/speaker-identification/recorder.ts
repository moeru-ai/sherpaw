import type { AudioClip } from './protocol'

import { startMicrophone } from '../audio/microphone'

export interface Recording {
  stop: () => Promise<AudioClip>
}

/** Adapts owned Web Audio samples to the extractor's normalized PCM contract in place. */
export function normalizeRecording(samples: Float32Array): void {
  let peak = 0
  for (const value of samples) {
    if (!Number.isFinite(value))
      throw new Error('麦克风音频包含无效数值，请重新录制或更换输入设备。')
    peak = Math.max(peak, Math.abs(value))
  }
  // Web Audio floats may exceed full scale. Apply one gain to the whole clip,
  // preserving its waveform instead of clipping peaks or changing gain per chunk.
  if (peak > 1) {
    for (let i = 0; i < samples.length; i++)
      samples[i] = samples[i]! / peak
  }
}

/** Starts one manual recording. The caller controls when to stop and releases the microphone through stop(). */
export async function startRecording(onDuration: (seconds: number) => void, signal?: AbortSignal): Promise<Recording> {
  const chunks: Float32Array[] = []
  let length = 0
  let reported = 0
  /** Triggering workflow: microphone.collect -> {@link collectAudio} -> recording chunks and {@link onDuration}. */
  function collectAudio(samples: Float32Array, sampleRate: number) {
    chunks.push(samples)
    length += samples.length
    const seconds = length / sampleRate
    if (seconds - reported >= 0.1) {
      reported = seconds
      onDuration(seconds)
    }
  }
  const capture = await startMicrophone(signal ?? new AbortController().signal, collectAudio)
  onDuration(0)
  let stopped: Promise<AudioClip> | undefined
  return {
    stop() {
      stopped ??= (async () => {
        await capture.stop()
        const samples = new Float32Array(length)
        let offset = 0
        for (const chunk of chunks) {
          samples.set(chunk, offset)
          offset += chunk.length
        }
        chunks.length = 0
        normalizeRecording(samples)
        return { samples, sampleRate: capture.sampleRate }
      })()
      return stopped
    },
  }
}
