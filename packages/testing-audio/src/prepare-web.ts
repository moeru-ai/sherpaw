import type { FakemicWebPrepareContext } from '@sherpaw/vitest-plugin-fakemic'

import type { SherpawAudioSession } from './types'

/** Adapts the Fakemic Chromium process into a Sherpaw audio session. */
export default async function prepareWebRuntime(context: FakemicWebPrepareContext): Promise<SherpawAudioSession> {
  const page = await context.context.newPage()
  await page.goto(context.runtime.url)

  return {
    page,
    loadAudioWorklet: () => page.evaluate(() => window.__sherpawAudioTest.loadAudioWorklet()),
    snapshot: () => page.evaluate(() => window.__sherpawAudioTest.snapshot()),
    start: model => page.evaluate(selectedModel => window.__sherpawAudioTest.start(selectedModel), model),
    async stop() {
      await page.evaluate(() => window.__sherpawAudioTest.stop())
    },
    async close() {
      await page.evaluate(() => window.__sherpawAudioTest.stop()).catch(() => undefined)
      await context.close()
    },
  }
}
