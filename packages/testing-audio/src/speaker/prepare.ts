import type { AudioTestSession, FakemicWebPrepareContext } from '@sherpaw/vitest-plugin-fakemic'
import type { Page } from 'playwright'

import { resolve } from 'node:path'
import { createServer } from 'vite'

export interface SpeakerAudioSession extends AudioTestSession {
  page: Page
}

/** Starts the shared demo Worker/recorder harness on an isolated port for this audio case. */
export default async function prepare(context: FakemicWebPrepareContext): Promise<SpeakerAudioSession> {
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, '../../../../playgrounds/speaker-identification'),
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [resolve(import.meta.dirname, '../../../..')] } },
  })
  try {
    await server.listen()
    const page = await context.context.newPage()
    // No provider or font request is allowed in the regression suite.
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
    })
    await page.goto(`${server.resolvedUrls!.local[0]}tests/index.html`)
    await page.waitForFunction(() => Boolean(window.speakerTest))
    return {
      page,
      async close() {
        try {
          await page.evaluate(() => window.speakerTest.dispose())
        }
        finally {
          await context.close()
          await server.close()
        }
      },
    }
  }
  catch (error) {
    await server.close()
    throw error
  }
}
