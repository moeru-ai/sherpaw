import type { KWSModule } from '../types'

export default function init(options: { locateFile: (path: string) => string }): Promise<KWSModule>
