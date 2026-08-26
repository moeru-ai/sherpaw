interface AudioProcessorDataMessage {
  type: 'data'
  sampleRate: number
  data: ArrayBufferLike
}

class AudioProcessor extends AudioWorkletProcessor {
  private readonly outputSampleRate = 16000

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel?.length)
      return true

    const data = sampleRate === this.outputSampleRate
      ? channel.slice()
      : this.downsample(channel)
    const message = {
      type: 'data',
      sampleRate: this.outputSampleRate,
      data: data.buffer,
    } satisfies AudioProcessorDataMessage

    this.port.postMessage(message, [data.buffer])
    return true
  }

  private downsample(input: Float32Array): Float32Array {
    const ratio = sampleRate / this.outputSampleRate
    const output = new Float32Array(Math.round(input.length / ratio))
    let inputOffset = 0

    for (let outputOffset = 0; outputOffset < output.length; outputOffset++) {
      const nextInputOffset = Math.round((outputOffset + 1) * ratio)
      let sum = 0
      let count = 0

      for (let index = inputOffset; index < nextInputOffset && index < input.length; index++) {
        sum += input[index] ?? 0
        count++
      }

      output[outputOffset] = sum / (count || 1)
      inputOffset = nextInputOffset
    }

    return output
  }
}

registerProcessor('sherpaw-testing-audio-processor', AudioProcessor)
