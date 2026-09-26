/** Capture raw mono PCM at the device rate. The caller owns any batching or normalization. */
export async function startMicrophone(signal: AbortSignal, onAudio: (samples: Float32Array, sampleRate: number) => void) {
  signal.throwIfAborted()
  const context = new AudioContext()
  let stream: MediaStream | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let capture: AudioWorkletNode | undefined
  let closed: Promise<void> | undefined

  /** Triggering workflow: caller stop / AbortSignal `abort` -> {@link release} -> tracks.stop, port detach and AudioContext.close. */
  function release() {
    stream?.getTracks().forEach(track => track.stop())
    if (capture) {
      capture.port.onmessage = null
      capture.disconnect()
    }
    source?.disconnect()
    signal.removeEventListener('abort', abort)
    closed ??= context.close()
    return closed
  }

  /** Triggering workflow: caller AbortController.abort -> {@link abort} -> {@link release}. */
  function abort() {
    void release().catch(() => {})
  }

  /** Triggering workflow: Capture.process -> MessagePort `message` -> {@link collect} -> {@link onAudio}. */
  function collect(event: MessageEvent<Float32Array>) {
    if (!signal.aborted)
      onAudio(event.data, context.sampleRate)
  }

  signal.addEventListener('abort', abort, { once: true })
  try {
    await context.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url))
    signal.throwIfAborted()
    await context.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    signal.throwIfAborted()
    source = context.createMediaStreamSource(stream)
    capture = new AudioWorkletNode(context, 'microphone-capture')
    capture.port.onmessage = collect
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(capture).connect(mute).connect(context.destination)
    return { sampleRate: context.sampleRate, stop: release }
  }
  catch (error) {
    await release().catch(() => {})
    throw error
  }
}
