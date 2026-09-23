import type { AudioClip } from './protocol'

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
  signal?.throwIfAborted()
  const context = new AudioContext()
  let stream: MediaStream | undefined
  /** Triggering workflow: route AbortController -> abortCapture -> stop device tracks and close the audio context. */
  function abortCapture() {
    stream?.getTracks().forEach(track => track.stop())
    if (context.state !== 'closed')
      void context.close().catch(() => {})
  }
  signal?.addEventListener('abort', abortCapture, { once: true })
  try {
    await context.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url))
    signal?.throwIfAborted()
    await context.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    } })
    signal?.throwIfAborted()
    const source = context.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(context, 'speaker-test-capture')
    const mute = context.createGain()
    mute.gain.value = 0
    const chunks: Float32Array[] = []
    let length = 0
    let reported = 0
    /** Triggering workflow: Capture.process -> collectAudio -> recording chunks and onDuration UI callback. */
    function collectAudio(event: MessageEvent<Float32Array>) {
      chunks.push(event.data)
      length += event.data.length
      const seconds = length / context.sampleRate
      if (seconds - reported >= 0.1) {
        reported = seconds
        onDuration(seconds)
      }
    }
    capture.port.onmessage = collectAudio
    source.connect(capture).connect(mute).connect(context.destination)
    onDuration(0)
    let stopped: Promise<AudioClip> | undefined
    return {
      stop() {
        stopped ??= (async () => {
          stream!.getTracks().forEach(track => track.stop())
          signal?.removeEventListener('abort', abortCapture)
          if (context.state !== 'closed')
            await context.close()
          capture.port.onmessage = null
          const samples = new Float32Array(length)
          let offset = 0
          for (const chunk of chunks) {
            samples.set(chunk, offset)
            offset += chunk.length
          }
          chunks.length = 0
          normalizeRecording(samples)
          return { samples, sampleRate: context.sampleRate }
        })()
        return stopped
      },
    }
  }
  catch (error) {
    stream?.getTracks().forEach(track => track.stop())
    signal?.removeEventListener('abort', abortCapture)
    if (context.state !== 'closed')
      await context.close()
    throw error
  }
}
