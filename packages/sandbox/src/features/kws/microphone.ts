/** Capture lives until its AbortSignal fires, including during a permission prompt. */
export async function startMicrophone(signal: AbortSignal, onAudio: (samples: Float32Array, sampleRate: number) => void) {
  signal.throwIfAborted()
  const context = new AudioContext()
  let stream: MediaStream | undefined
  let capture: AudioWorkletNode | undefined

  /** Triggering workflow: page.stopMicrophone / route unmount -> AbortSignal `abort` -> {@link release} -> device tracks and AudioContext.close. */
  function release() {
    stream?.getTracks().forEach(track => track.stop())
    if (capture) {
      capture.port.onmessage = null
      capture.disconnect()
    }
    if (context.state !== 'closed')
      void context.close().catch(() => {})
  }

  /** Triggering workflow: KWSCapture.process -> MessagePort `message` -> {@link collect} -> {@link onAudio}. */
  function collect(event: MessageEvent<Float32Array>) {
    if (!signal.aborted)
      onAudio(event.data, context.sampleRate)
  }

  signal.addEventListener('abort', release, { once: true })
  try {
    await context.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url))
    signal.throwIfAborted()
    await context.resume()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    signal.throwIfAborted()
    const source = context.createMediaStreamSource(stream)
    capture = new AudioWorkletNode(context, 'kws-capture')
    capture.port.onmessage = collect
    const mute = context.createGain()
    mute.gain.value = 0
    source.connect(capture).connect(mute).connect(context.destination)
  }
  catch (error) {
    signal.removeEventListener('abort', release)
    release()
    throw error
  }
}
