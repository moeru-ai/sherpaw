import type { FakemicWebPrepareContext } from '@sherpaw/vitest-plugin-fakemic'

import type { RealtimeEvent } from '../../src/features/webgpu-experiment/realtime-metrics'

declare global {
  interface Window {
    __asrRealtimeTest: { events: RealtimeEvent[], tracks: MediaStreamTrack[] }
  }
}

/** Triggering workflow: fakemic runtime launch -> prepare -> capture app telemetry and microphone lifetime -> realtime test session. */
export default async function prepare(context: FakemicWebPrepareContext) {
  const page = await context.context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(() => {
    window.__asrRealtimeTest = { events: [], tracks: [] }
    /** Triggering workflow: sandbox publishMetrics -> realtime CustomEvent -> captured test timeline. */
    window.addEventListener('sherpaw:asr-realtime', (event) => {
      window.__asrRealtimeTest.events.push((event as CustomEvent<RealtimeEvent>).detail)
    })
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    /** Triggering workflow: sandbox Start -> file-backed getUserMedia -> track cleanup assertions. */
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await getUserMedia(...args)
      window.__asrRealtimeTest.tracks.push(...stream.getTracks())
      return stream
    }
  })
  await page.goto(context.runtime.url)
  return {
    page,
    browser: context.browser.version(),
    errors,
    async stop() {
      await page.getByRole('button', { name: 'Stop transcription' }).click()
      await page.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 180000 })
    },
    snapshot: () => page.evaluate(() => ({
      events: window.__asrRealtimeTest.events,
      tracks: window.__asrRealtimeTest.tracks.map(track => track.readyState),
      error: document.querySelector('[role=alert]')?.textContent ?? '',
    })),
    close: context.close,
  }
}

export type RealtimeSession = Awaited<ReturnType<typeof prepare>>
