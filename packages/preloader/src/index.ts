import type { Data, Filename, LoadDataOptions, LoadVirtualDataOptions } from './types'
import { nanoid } from 'nanoid/non-secure'

export * from './types'

function dataToBytes(data: Data): Uint8Array {
  if (data instanceof Uint8Array)
    return data

  if (data instanceof ArrayBuffer)
    return new Uint8Array(data)

  return new TextEncoder().encode(String(data))
}

export function loadData(options: LoadDataOptions) {
  const {
    module,
    metadata,
    data,
    parent = '/',
    dependencyId = `load_data_${nanoid()}`,
  } = options

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
export function loadVirtualData<T extends Record<Filename, Data> = Record<Filename, Data>>(options: LoadVirtualDataOptions<T>): Record<keyof T, keyof T> {
  const {
    module,
    virtualData,
    parent = '/',
    dependencyId = `load_virtual_data_${nanoid()}`,
  } = options

  function createDataFiles() {
    for (const [filename, data] of Object.entries(virtualData)) {
      module.FS_createDataFile(parent, filename, dataToBytes(data), true, true, true)
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

  return Object.keys(virtualData).reduce((filenames, filename: keyof T) => {
    filenames[filename] = filename
    return filenames
  }, {} as Record<keyof T, keyof T>)
}
