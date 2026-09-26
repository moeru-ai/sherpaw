export interface AudioProcessorDataMessage {
  type: 'data'
  sampleRate: number
  /** End of this PCM chunk on the AudioContext clock, in seconds. */
  audioEndTime: number
  frames: number
  data: ArrayBuffer
}

export type AudioProcessorMessage = AudioProcessorDataMessage
