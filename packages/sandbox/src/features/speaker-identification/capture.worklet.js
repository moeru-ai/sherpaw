// Capture keeps the AudioContext's actual sample rate; sherpa resamples.
class Capture extends AudioWorkletProcessor {
  /**
   * Triggering workflow:
   * AudioContext rendering -> process -> MessagePort.postMessage
   * -> recorder.collectAudio -> manual stop -> speakerClient enrollment / identification.
   */
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel?.length) {
      const samples = channel.slice()
      this.port.postMessage(samples, [samples.buffer])
    }
    return true
  }
}
registerProcessor('speaker-test-capture', Capture)
