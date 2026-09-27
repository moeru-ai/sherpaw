import { createContext } from '@moeru/eventa/adapters/worker-threads/worker'

import { registerWorkerHandlers } from '../worker/runtime'

const { context } = createContext()

registerWorkerHandlers(context)
