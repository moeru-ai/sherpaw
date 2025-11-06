<template>
  <div
    rounded-2xl
    b="2 dark-300"
    flex="~ col items-center"
    pt-2 px-2
    w-full
  >
    <div text-sm uppercase font-bold text-dark-300 px-2>
      <slot name="title" />
    </div>

    <div py-2 w-full flex="~ col items-start justify-center">
      <slot />
    </div>
  </div>
</template>
