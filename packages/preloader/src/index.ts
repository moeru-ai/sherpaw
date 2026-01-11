import type { WebAssemblyModule } from '@sherpaw/shared'
import type { Data, DataMetadata, VirtualData } from './types'

export * from './types'

function dataToBytes(data: Data): Uint8Array {
  if (data instanceof Uint8Array)
    return data

  if (data instanceof ArrayBuffer)
    return new Uint8Array(data)

  return new TextEncoder().encode(String(data))
}

export function loadData(
  module: WebAssemblyModule,
  metadata: DataMetadata,
  data: Data,
  dependencyId: string,
  parent: string | FS.FSNode = '/',
) {
  function createDataFiles() {
    const bytes = dataToBytes(data)
    for (const { filename, start, end } of metadata.files) {
      const data = bytes.subarray(start, end)
      module.FS_createDataFile(parent, filename, data, true, true, true)
    }
    module.removeRunDependency(dependencyId)
  }

  module.addRunDependency(dependencyId)
  if (module.calledRun) {
    createDataFiles()
  }
  else {
    if (!module.preRun)
      module.preRun = []
    module.preRun.push(createDataFiles) // FS is not initialized yet, wait for it
  }
}

/**
 * Load "virtual" data without the need to pre-pack it with emsdk.
 */
export function loadVirtualData(
  module: WebAssemblyModule,
  virtualData: VirtualData,
  dependencyId: string,
  parent: string | FS.FSNode = '/',
) {
  function createDataFiles() {
    for (const vf of virtualData.files) {
      module.FS_createDataFile(parent, vf.filename, dataToBytes(vf.data), true, true, true)
    }
    module.removeRunDependency(dependencyId)
  }

  module.addRunDependency(dependencyId)
  if (module.calledRun) {
    createDataFiles()
  }
  else {
    if (!module.preRun)
      module.preRun = []
    module.preRun.push(createDataFiles) // FS is not initialized yet, wait for it
  }
}
