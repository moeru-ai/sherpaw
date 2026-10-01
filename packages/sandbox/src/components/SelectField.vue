<script setup lang="ts" generic="T extends string">
import { SelectContent, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui'
import { useId } from 'vue'

defineProps<{
  label: string
  options: Array<{ value: T, label: string }>
  description?: string
  disabled?: boolean
}>()

const value = defineModel<T>({ required: true })

const id = useId()
</script>

<template>
  <div flex="~ col gap-1.5">
    <label :for="id" text-sm font-semibold>{{ label }}</label>
    <SelectRoot :model-value="value" :disabled @update:model-value="selected => value = selected as T">
      <SelectTrigger
        :id
        flex="~ items-center justify-between gap-2" w-full rounded-lg px-3 py-2 text-sm text-left bg-white
        class="border border-neutral-300 outline-none hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-400
          data-[disabled]:cursor-not-allowed data-[disabled]:op-60 data-[disabled]:hover:border-neutral-300"
      >
        <SelectValue />
        <SelectIcon flex="~ items-center">
          <div i-ri:arrow-down-s-line />
        </SelectIcon>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent
          position="popper" :side-offset="4" z-50 rounded-lg bg-white shadow-lg
          class="border border-neutral-200 w-[var(--reka-select-trigger-width)] max-h-[var(--reka-select-content-available-height)]"
        >
          <SelectViewport p-1>
            <SelectItem
              v-for="option in options" :key="option.value" :value="option.value"
              flex="~ items-center justify-between gap-2" rounded px-2 py-1.5 text-sm cursor-pointer select-none
              class="outline-none data-[highlighted]:bg-neutral-100 data-[state=checked]:font-semibold"
            >
              <SelectItemText>{{ option.label }}</SelectItemText>
              <SelectItemIndicator flex="~ items-center">
                <div i-ri:check-line />
              </SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
    <p v-if="description" text-xs text-neutral-500>
      {{ description }}
    </p>
  </div>
</template>
