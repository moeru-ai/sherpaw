export type SpeechDetection = 'silero' | 'segmentation'

export const speechDetectionOptions: Array<{ value: SpeechDetection, title: string, detail: string }> = [
  { value: 'silero', title: 'Silero VAD', detail: 'Reacts fast. Can miss speech under music or sound effects.' },
  { value: 'segmentation', title: 'Segmentation model', detail: 'Finds more speech in films and TV. Utterances end about 1 s later.' },
]
