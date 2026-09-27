// Capture keeps the AudioContext's actual sample rate and render clock.
class Capture extends AudioWorkletProcessor {
  /**
   * Triggering workflow:
   * AudioContext rendering -> process -> MessagePort.postMessage
   * -> microphone.collect -> caller PCM callback.
   */
  process(inputs) {
    const channel = inputs[0]?.[0]

    if (channel?.length) {
      const samples = channel.slice()

      this.port.postMessage({ samples, audioEndTime: currentTime + samples.length / sampleRate }, [samples.buffer])
    }

    return true
  }
}
registerProcessor('microphone-capture', Capture)
