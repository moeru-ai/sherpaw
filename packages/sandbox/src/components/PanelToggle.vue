<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

defineProps<{
  /** The id of the panel that the button shows and hides. */
  controls: string
  side: 'left' | 'right'
  /** What the panel holds, for the button's name. */
  label: string
}>()

const open = defineModel<boolean>({ required: true })
</script>

<template>
  <TooltipRoot>
    <TooltipTrigger
      :aria-expanded="open" :aria-controls="controls" :aria-label="`${open ? 'Hide' : 'Show'} ${label}`"
      flex="~ items-center justify-center" w-8 h-8 shrink-0 rounded-lg text-lg transition-colors
      class="outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
      :class="open ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-500 hover:bg-neutral-100'"
      @click="open = !open"
    >
      <div :class="side === 'left' ? 'i-ri:layout-left-2-line' : 'i-ri:layout-right-2-line'" />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent side="bottom" :side-offset="4" rounded bg-neutral-900 text-white text-xs px-2 py-1 z-50>
        {{ open ? 'Hide' : 'Show' }} {{ label }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
