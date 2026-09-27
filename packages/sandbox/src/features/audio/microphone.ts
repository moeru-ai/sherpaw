import { useDevicesList, useUserMedia } from '@vueuse/core'
import { computed, effectScope, ref } from 'vue'

/** Capture mono PCM. Web Audio resamples when a rate is requested; callers own batching. */
export async function startMicrophone(signal: AbortSignal, onAudio: (samples: Float32Array, sampleRate: number) => void, options: { sampleRate?: number, onError?: () => void } = {}) {
  signal.throwIfAborted()

  const context = new AudioContext({ sampleRate: options.sampleRate })
  // Recording starts in event handlers, outside Vue setup. Own the VueUse
  // watchers/devicechange listener for exactly this capture's lifetime.
  const scope = effectScope(true)
  const { media, selectedAudioInput, audioInputs } = scope.run(() => {
    const { audioInputs } = useDevicesList({ constraints: { audio: true }, requestPermissions: false })
    const selectedAudioInput = ref('')
    const constraints = computed<MediaStreamConstraints>(() => ({
      audio: {
        ...(selectedAudioInput.value ? { deviceId: { exact: selectedAudioInput.value } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    }))
    // Keep the input fixed for one recording; switching streams mid-capture
    // would also require reconnecting the graph and resetting decoder state.
    const media = useUserMedia({ constraints, enabled: false, autoSwitch: false })

    return { media, selectedAudioInput, audioInputs }
  })!
  let source: MediaStreamAudioSourceNode | undefined
  let capture: AudioWorkletNode | undefined
  let closed: Promise<void> | undefined

  /** Triggering workflow: ASR stopRecording / KWS stopMicrophone / recorder.stop / AbortSignal `abort` -> release -> VueUse stop, scope disposal and AudioContext.close. */
  function release() {
    // Also stop a stream whose permission request completed after scope disposal.
    media.stop()
    scope.stop()

    if (capture) {
      capture.port.onmessage = null
      capture.disconnect()
    }

    source?.disconnect()
    signal.removeEventListener('abort', abort)
    closed ??= context.close()

    return closed
  }

  /** Triggering workflow: KWS stopMicrophone / speaker disposePage -> AbortController.abort -> release. */
  function abort() {
    void release().catch(() => {})
  }

  /** Triggering workflow: Capture.process -> MessagePort `message` -> collect -> onAudio. */
  function collect(event: MessageEvent<Float32Array>) {
    if (!signal.aborted)
      onAudio(event.data, context.sampleRate)
  }

  signal.addEventListener('abort', abort, { once: true })

  try {
    await context.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url))
    signal.throwIfAborted()
    await context.resume()
    selectedAudioInput.value = audioInputs.value.find(device => device.deviceId === 'default')?.deviceId
      || audioInputs.value[0]?.deviceId || ''

    let stream: MediaStream | undefined

    try {
      stream = await media.start()
    }
    catch (error) {
      signal.throwIfAborted()

      // Retry the browser default if the enumerated input is no longer available.
      if (!selectedAudioInput.value || !(error instanceof DOMException)
        || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) {
        throw error
      }

      selectedAudioInput.value = ''
      stream = await media.start()
    }

    signal.throwIfAborted()

    if (!stream)
      throw new Error('This browser does not support microphone capture.')

    source = context.createMediaStreamSource(stream)
    capture = new AudioWorkletNode(context, 'microphone-capture')
    capture.port.onmessage = collect
    capture.onprocessorerror = options.onError ?? null

    const mute = context.createGain()

    mute.gain.value = 0
    source.connect(capture).connect(mute).connect(context.destination)

    return {
      sampleRate: context.sampleRate,
      stop: release,
    }
  }
  catch (error) {
    await release().catch(() => {})

    throw error
  }
}
