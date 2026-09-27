import { parentPort } from 'node:worker_threads'

import { createWorkerHandler } from './worker-runtime'

if (!parentPort)
  throw new Error('The keyword worker entry must run in a worker thread')

const port = parentPort
const handle = createWorkerHandler(reply => port.postMessage(reply))

port.on('message', handle)
