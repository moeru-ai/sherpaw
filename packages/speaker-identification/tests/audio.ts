import { decodeWavPcm16 } from '../../asr/tests/helpers/wav'

// Resolve at runtime in the dev harness so Vite does not import every WAV eagerly.
const moduleUrl = import.meta.url
const fixturesUrl = new URL('./fixtures/', moduleUrl)

export function audioUrl(name: string): URL {
  return name.startsWith('/') ? new URL(name, location.origin) : new URL(`${encodeURIComponent(name)}.wav`, fixturesUrl)
}

export async function readAudio(name: string) {
  const response = await fetch(audioUrl(name))
  if (!response.ok)
    throw new Error(`Missing test audio ${name}: run test:prepare or generate the TTS fixtures`)
  return decodeWavPcm16(await response.arrayBuffer())
}

export const modelUrl = new URL('../../../models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced/model/normalized/speaker-embedding.onnx', import.meta.url)
