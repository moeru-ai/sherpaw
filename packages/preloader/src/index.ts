import type { WasmModule } from '@sherpa-onnx-wasm/shared'
import type { Metadata } from './types'

export * from './types'

export function loadData(module: WasmModule, metadata: Metadata, data: ArrayBuffer, dependencyId: string, parent: string | FS.FSNode = '/') {
  function createDataFiles() {
    const bytes = new Uint8Array(data)
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
