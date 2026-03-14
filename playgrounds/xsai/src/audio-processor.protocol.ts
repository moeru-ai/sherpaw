export interface AudioProcessorDataMessage {
  type: 'data'
  sampleRate: number
  frames: number
  data: ArrayBuffer
}

export type AudioProcessorMessage = AudioProcessorDataMessage
