import type { Metadata, Module } from './types'

export * from './types'

export function loadData(module: Module, metadata: Metadata, data: ArrayBuffer, dependencyId: string) {
  function createDataFiles() {
    const bytes = new Uint8Array(data)
    for (const { filename, start, end } of metadata.files) {
      const data = bytes.subarray(start, end)
      module.FS_createDataFile(filename, null, data, true, true, true)
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
