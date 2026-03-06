export interface WavPcm16Data {
  sampleRate: number
  samples: Float32Array
}

function readString(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i))
  }
  return out
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, Math.round(clamped * 32767), true)
    offset += 2
  }

  return buffer
}

export function decodeWavPcm16(buffer: ArrayBuffer): WavPcm16Data {
  const view = new DataView(buffer)
  if (readString(view, 0, 4) !== 'RIFF' || readString(view, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV header')
  }

  let offset = 12
  let format: {
    audioFormat: number
    numChannels: number
    sampleRate: number
    bitsPerSample: number
  } | null = null
  let dataOffset = -1
  let dataSize = 0

  while (offset + 8 <= view.byteLength) {
    const chunkId = readString(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkDataOffset = offset + 8

    if (chunkId === 'fmt ') {
      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        numChannels: view.getUint16(chunkDataOffset + 2, true),
        sampleRate: view.getUint32(chunkDataOffset + 4, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true),
      }
    }
    else if (chunkId === 'data') {
      dataOffset = chunkDataOffset
      dataSize = chunkSize
      break
    }

    const paddedSize = chunkSize + (chunkSize % 2)
    offset = chunkDataOffset + paddedSize
  }

  if (!format) {
    throw new Error('Missing WAV fmt chunk')
  }
  if (dataOffset < 0) {
    throw new Error('Missing WAV data chunk')
  }
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16 || format.numChannels !== 1) {
    throw new Error('Unsupported WAV format')
  }

  const sampleCount = dataSize / 2
  const samples = new Float32Array(sampleCount)
  let sampleOffset = dataOffset
  for (let i = 0; i < sampleCount; i++) {
    const value = view.getInt16(sampleOffset, true)
    samples[i] = value / 32768
    sampleOffset += 2
  }

  return {
    sampleRate: format.sampleRate,
    samples,
  }
}
