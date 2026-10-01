<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed, useId } from 'vue'

const props = defineProps<{
  label: string
  help?: string
  min: number
  max: number
  step: number
  /** The value that the reset button restores. A tick on the track marks it. */
  defaultValue?: number
  unit?: string
  disabled?: boolean
  /** The slider shows this text instead of the help text while `disabled` is true. */
  disabledReason?: string
}>()

const value = defineModel<number>({ required: true })

const id = useId()
const decimals = computed(() => (String(props.step).split('.')[1] ?? '').length)
const changed = computed(() => props.defaultValue !== undefined && Math.abs(value.value - props.defaultValue) > 1e-9)
const tick = computed(() => (props.defaultValue === undefined ? undefined : (props.defaultValue - props.min) / (props.max - props.min) * 100))

function format(number: number) {
  return `${number.toFixed(decimals.value)}${props.unit ?? ''}`
}
</script>

<template>
  <div flex="~ col gap-1.5" :class="{ 'op-60': disabled }">
    <div flex="~ items-center justify-between gap-2" text-sm>
      <span :id="`${id}-label`">{{ label }}</span>
      <span flex="~ items-center gap-1.5">
        <TooltipRoot v-if="changed && !disabled">
          <TooltipTrigger
            :aria-label="`Reset ${label} to ${format(defaultValue!)}`"
            flex="~ items-center" text-neutral-500 hover:text-neutral-900 rounded
            @click="value = defaultValue!"
          >
            <div i-ri:arrow-go-back-line />
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="top" :side-offset="4" rounded bg-neutral-900 text-white text-xs px-2 py-1 z-50>
              Reset to the default, {{ format(defaultValue!) }}
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
        <span tabular-nums font-semibold :class="changed ? 'text-amber-700' : 'text-neutral-800'">{{ format(value) }}</span>
      </span>
    </div>
    <SliderRoot
      :id :model-value="[value]" :min :max :step :disabled
      relative flex="~ items-center" h-5 w-full select-none touch-none
      @update:model-value="values => values && (value = values[0]!)"
    >
      <SliderTrack relative grow h-1.5 rounded-full bg-neutral-200>
        <SliderRange absolute h-full rounded-full bg-neutral-700 />
        <span
          v-if="tick !== undefined" aria-hidden="true"
          absolute w-0.5 h-2.5 rounded-full bg-neutral-400 class="-top-0.5"
          :style="{ left: `calc(${tick}% - 1px)` }"
        />
      </SliderTrack>
      <SliderThumb
        :aria-labelledby="`${id}-label`"
        block w-4 h-4 rounded-full bg-white shadow
        class="border border-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        :class="disabled ? 'cursor-not-allowed' : 'cursor-grab'"
      />
    </SliderRoot>
    <p v-if="disabled && disabledReason" text-xs text-neutral-500>
      {{ disabledReason }}
    </p>
    <p v-else-if="help" text-xs text-neutral-500>
      {{ help }}
    </p>
  </div>
</template>
