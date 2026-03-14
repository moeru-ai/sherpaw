import type { AudioProcessorDataMessage } from './audio-processor.protocol'

declare const sampleRate: number

class AudioProcessor extends AudioWorkletProcessor {
  private readonly outSampleRate = 16000

  private emitData(data: Float32Array) {
    this.port.postMessage({
      type: 'data',
      sampleRate: this.outSampleRate,
      frames: data.length,
      data: data.buffer,
    } as AudioProcessorDataMessage, [data.buffer as ArrayBuffer])
  }

  process(inputs: Float32Array[][], _outputs: Float32Array[][], _parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0]
    if (!input || input.length === 0)
      return true

    const channelData = input[0]
    if (!channelData || channelData.length === 0)
      return true

    if (!sampleRate || this.outSampleRate === sampleRate) {
      this.emitData(channelData)
      return true
    }

    const sampleRateRatio = sampleRate / this.outSampleRate
    const newLength = Math.round(channelData.length / sampleRateRatio)
    const result = new Float32Array(newLength)
    let offsetResult = 0
    let offsetBuffer = 0
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
      let value = 0
      let count = 0
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < channelData.length; i++) {
        value += channelData[i] ?? 0
        count++
      }
      result[offsetResult] = value / (count || 1)
      offsetResult++
      offsetBuffer = nextOffsetBuffer
    }
    this.emitData(result)

    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
