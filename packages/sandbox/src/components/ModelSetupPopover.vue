<script setup lang="ts">
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

defineProps<{ ready?: boolean, disabled?: boolean }>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      :disabled="disabled"
      flex="~ row items-center gap-2"
      bg="transparent hover:neutral/10"
      rounded-2xl p-2 md:p-4
      transition="background-color 300"
      text-sm lg:text-base
    >
      <div uppercase>
        Model setup
      </div>
      <div i-ri:ai-generate-3d-line text-xl :class="{ 'op-50': !ready }" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        :side-offset="0"
        rounded-lg bg-white shadow-sm b m-4
        class="max-w-[calc(100dvw-var(--spacing)*4*2)] w-[460px] will-change-[transform,opacity]
          data-[state=open]:animate-[fade-in_150ms_linear_1]
          data-[state=closed]:animate-[fade-out_150ms_linear_1]"
      >
        <slot />
        <PopoverArrow class="fill-white stroke-gray-200" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>
