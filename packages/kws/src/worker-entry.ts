import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import { registerWorkerHandlers } from './worker-runtime'

const { context } = createContext()

registerWorkerHandlers(context)
