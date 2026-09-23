import type { SpeakerIdentificationModule } from '../types'

declare const init: (options: { locateFile: (path: string) => string }) => Promise<SpeakerIdentificationModule>
export default init
