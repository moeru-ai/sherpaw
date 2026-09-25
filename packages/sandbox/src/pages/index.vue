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
    <RouterLink to="/speaker-identification" text-3xl underline>
      Speaker identification
    </RouterLink>
    <RouterLink to="/kws" text-3xl underline>
      Keyword spotting
    </RouterLink>
  </div>
</template>
