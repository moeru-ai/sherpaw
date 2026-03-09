import type { ASRModule } from '@sherpaw/asr'
import type { DataMetadata } from '@sherpaw/preloader'

import { initASRModule } from '@sherpaw/asr'
import { loadData } from '@sherpaw/preloader'
import { createInjectionState } from '@vueuse/core'
import { shallowRef } from 'vue'

const [provideASRStore, _useASRStore] = createInjectionState(() => {
  const metadata = shallowRef<DataMetadata>()
  const data = shallowRef<ArrayBuffer>()

  const asrModule = shallowRef<ASRModule>()

  async function init() {
    if (!metadata.value || !data.value)
      return

    const asr = await initASRModule()
    loadData({
      module: asr,
      metadata: metadata.value,
      data: data.value,
    })
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
