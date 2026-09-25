class KWSCapture extends AudioWorkletProcessor {
  buffer = new Float32Array(Math.round(sampleRate / 10))
  offset = 0

  /** Triggering workflow: AudioContext render -> process -> MessagePort `message` -> microphone.collect -> KWS client audio request. */
  process(inputs) {
    const samples = inputs[0]?.[0]
    if (!samples)
      return true
    for (const value of samples) {
      // Web Audio may exceed full scale; keep PCM inside the KWS input range.
      this.buffer[this.offset++] = Math.max(-1, Math.min(1, value))
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer])
        this.buffer = new Float32Array(Math.round(sampleRate / 10))
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('kws-capture', KWSCapture)
