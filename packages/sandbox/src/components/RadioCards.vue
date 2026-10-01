<script setup lang="ts" generic="T extends string">
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { useId } from 'vue'

defineProps<{
  label: string
  options: Array<{ value: T, title: string, detail: string }>
  description?: string
  disabled?: boolean
}>()

const value = defineModel<T>({ required: true })

const id = useId()
</script>

<template>
  <div flex="~ col gap-1.5">
    <span :id text-sm font-semibold>{{ label }}</span>
    <RadioGroupRoot :model-value="value" :disabled :aria-labelledby="id" grid gap-2 @update:model-value="selected => value = selected as T">
      <RadioGroupItem
        v-for="option in options" :key="option.value" :value="option.value"
        flex="~ items-start gap-2.5" rounded-lg p-2.5 text-left bg-white
        class="border border-neutral-300 outline-none hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-400
          data-[state=checked]:border-neutral-800 data-[state=checked]:bg-neutral-50
          data-[disabled]:cursor-not-allowed data-[disabled]:op-60"
      >
        <span mt-0.5 w-4 h-4 shrink-0 rounded-full flex="~ items-center justify-center" class="border border-neutral-500">
          <RadioGroupIndicator w-2 h-2 rounded-full bg-neutral-800 />
        </span>
        <span flex="~ col gap-0.5">
          <span text-sm font-semibold>{{ option.title }}</span>
          <span text-xs text-neutral-500>{{ option.detail }}</span>
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>
    <p v-if="description" text-xs text-neutral-500>
      {{ description }}
    </p>
  </div>
</template>
