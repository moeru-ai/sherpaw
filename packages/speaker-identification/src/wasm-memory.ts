import type { SpeakerIdentificationModule } from './types'

/** Temporary native allocations are released even when the caller throws. */
export function createWasmMemory(module: SpeakerIdentificationModule) {
  function withMemory<T>(bytes: number, use: (ptr: number) => T): T {
    const ptr = module._malloc(bytes)
    if (!ptr)
      throw new Error(`Unable to allocate ${bytes} bytes in WASM`)
    try {
      return use(ptr)
    }
    finally {
      module._free(ptr)
    }
  }

  function withString<T>(value: string, use: (ptr: number) => T): T {
    const size = module.lengthBytesUTF8(value) + 1
    return withMemory(size, (ptr) => {
      module.stringToUTF8(value, ptr, size)
      return use(ptr)
    })
  }

  return { withMemory, withString }
}
