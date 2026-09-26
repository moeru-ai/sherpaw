import { afterEach, expect, it, vi } from 'vitest'

import { countGpuDispatches } from '../../src/features/asr/gpu-diagnostics'

afterEach(() => vi.unstubAllGlobals())

it('disabled diagnostics do not require a GPU API', () => {
  vi.stubGlobal('GPUComputePassEncoder', undefined)
  const counter = countGpuDispatches(false)
  expect(counter.read()).toBe(0)
  counter.dispose()
})

it('counts dispatches without changing their arguments or receiver, then restores the API', () => {
  const dispatch = vi.fn()
  class ComputePass {
    dispatchWorkgroups(...args: number[]) { dispatch.apply(this, args) }
  }
  const original = ComputePass.prototype.dispatchWorkgroups
  vi.stubGlobal('GPUComputePassEncoder', ComputePass)
  const counter = countGpuDispatches(true)
  try {
    const pass = new ComputePass()
    pass.dispatchWorkgroups(3, 2, 1)
    expect(dispatch).toHaveBeenCalledWith(3, 2, 1)
    expect(dispatch.mock.contexts).toEqual([pass])
    expect(counter.read()).toBe(1)
  }
  finally { counter.dispose() }
  expect(ComputePass.prototype.dispatchWorkgroups).toBe(original)
})
