import type { SpeakerDiarizationModule } from '../wasm'

export default function init(options: { locateFile: (path: string) => string }): Promise<SpeakerDiarizationModule>
