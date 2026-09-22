import { defineConfig } from 'vitest/config'

import { speakerAudioProject } from './src/speaker/project'

export default defineConfig({ test: { projects: [speakerAudioProject] } })
