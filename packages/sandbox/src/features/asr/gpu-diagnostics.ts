/** Optional instrumentation scoped to an ASR worker, which owns all GPU work in its realm. */
export function countGpuDispatches(enabled: boolean) {
  let count = 0
  let dispose = () => {}
  if (enabled) {
    const prototype = GPUComputePassEncoder.prototype
    const original = prototype.dispatchWorkgroups
    /** Triggering workflow: ORT session.run -> dispatchWorkgroups -> diagnostic count in Recognizer.stats. */
    const dispatch: typeof original = function (this: GPUComputePassEncoder, ...args) {
      count++
      return original.apply(this, args)
    }
    prototype.dispatchWorkgroups = dispatch
    dispose = () => {
      if (prototype.dispatchWorkgroups === dispatch)
        prototype.dispatchWorkgroups = original
    }
  }
  return { read: () => count, dispose }
}
