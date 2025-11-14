import type { ASRModule } from '@sherpa-onnx-wasm/asr'
import type { Metadata } from '@sherpa-onnx-wasm/preloader'
import { initASRModule } from '@sherpa-onnx-wasm/asr'
import wasmUrl from '@sherpa-onnx-wasm/asr/module.wasm?url'
import { loadData } from '@sherpa-onnx-wasm/preloader'
import { createInjectionState } from '@vueuse/core'
import { shallowRef } from 'vue'

const [provideASRStore, _useASRStore] = createInjectionState(() => {
  const metadata = shallowRef<Metadata>()
  const data = shallowRef<ArrayBuffer>()

  const asrModule = shallowRef<ASRModule>()

  async function init() {
    if (!metadata.value || !data.value)
      return

    const asr = await initASRModule({ locateFile: () => wasmUrl })
    loadData(asr, metadata.value, data.value, 'asr')
    asrModule.value = asr

    return asr
  }

  return {
    metadata,
    data,
    init,
    asrModule,
  }
})

function useASRStore() {
  const store = _useASRStore()
  if (!store) {
    throw new Error('Call provideASRStore first before calling useASRStore.')
  }
  return store
}

export { provideASRStore, useASRStore }
