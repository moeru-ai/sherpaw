import type { Command } from './worker-protocol'

import { createWorkerHandler } from './worker-runtime'

const handle = createWorkerHandler(reply => globalThis.postMessage(reply))

/** Triggering workflow: browser Worker message -> onMessage -> serialized keyword runtime. */
function onMessage(event: MessageEvent<Command>) {
  handle(event.data)
}

globalThis.addEventListener('message', onMessage)
