<script setup lang="ts">
defineProps<{
  disabled?: boolean
}>()

defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <button

    :class="{
      'bg-neutral': disabled,
      'cursor-not-allowed': disabled,
      'bg-dark-500 hover:bg-dark-100': !disabled,
    }"
    transition="background-color 300"
    text="light"
    rounded-xl
    px-3 py-1
    @click="disabled ? undefined : $emit('click', $event)"
  >
    <slot />
  </button>
</template>
