import fakemic, { web } from '@sherpaw/vitest-plugin-fakemic'

export const speakerAudioProject = fakemic({
  name: 'speaker-audio-web',
  include: ['cases/speaker-identification/case.audio.test.ts'],
  runtime: web({
    name: 'speaker-web',
    prepare: new URL('./prepare.ts', import.meta.url).href,
    url: 'http://127.0.0.1/',
    context: { permissions: ['microphone'] },
  }),
})
