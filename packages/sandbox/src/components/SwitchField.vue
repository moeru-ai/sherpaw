<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { useId } from 'vue'

defineProps<{
  label: string
  description?: string
  disabled?: boolean
}>()

const value = defineModel<boolean>({ required: true })

const id = useId()
</script>

<template>
  <div flex="~ col gap-1.5">
    <div flex="~ items-center justify-between gap-3">
      <label :for="id" text-sm font-semibold>{{ label }}</label>
      <SwitchRoot
        :id v-model="value" :disabled
        relative w-9 h-5 shrink-0 rounded-full bg-neutral-300 transition-colors
        class="outline-none focus-visible:ring-2 focus-visible:ring-neutral-400
          data-[state=checked]:bg-neutral-800 data-[disabled]:cursor-not-allowed data-[disabled]:op-60"
      >
        <SwitchThumb
          block w-4 h-4 rounded-full bg-white shadow transition-transform
          class="translate-x-0.5 data-[state=checked]:translate-x-4.5"
        />
      </SwitchRoot>
    </div>
    <p v-if="description" text-xs text-neutral-500>
      {{ description }}
    </p>
  </div>
</template>
