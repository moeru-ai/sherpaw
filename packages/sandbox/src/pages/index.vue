<template>
  <div
    h-dvh w-full font-sans
    flex="~ col items-center justify-center gap-8"
  >
    <div flex="~ col items-center justify-center gap-2">
      <div font-black text-4xl>
        Sherpa-ONNX WASM
      </div>
      <div font-bold text-xl>
        Sandbox
      </div>
    </div>
    <div text-5xl>
      <RouterLink to="/asr">
        <div underline>
          ASR
        </div>
      </RouterLink>
    </div>
  </div>
</template>
