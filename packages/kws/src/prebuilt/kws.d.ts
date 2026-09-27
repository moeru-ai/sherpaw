import type { KWSModule } from '../wasm'

export default function init(options: { locateFile: (path: string) => string }): Promise<KWSModule>
