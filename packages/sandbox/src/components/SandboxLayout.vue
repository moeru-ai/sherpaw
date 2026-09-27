<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div min-h-dvh w-full font-sans flex="~ col items-center justify-start">
    <header p-6 w-full flex="~ col md:row items-center justify-between gap-4 shrink-0">
      <div flex="~ col items-center md:items-start">
        <RouterLink to="/" text-xl md:text-3xl font-black aria-label="← Sandbox">
          Sherpa-ONNX WASM
        </RouterLink>
        <div font-semibold>
          {{ title }} Sandbox
        </div>
      </div>
      <slot name="setup" />
    </header>
    <slot />
  </div>
</template>
