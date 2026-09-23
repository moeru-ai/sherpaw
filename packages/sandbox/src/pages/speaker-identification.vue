<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

import { mountSpeakerPage } from '../features/speaker-identification/page'
import template from '../features/speaker-identification/page.html?raw'

const page = useTemplateRef<HTMLDivElement>('page')
let dispose: (() => void) | undefined

/** Triggering workflow: RouterView mounts speaker-identification -> mountPage -> initialize page controls. */
function mountPage() {
  dispose = mountSpeakerPage(page.value!)
}

/** Triggering workflow: RouterView leaves speaker-identification -> disposePage -> stop capture and terminate inference. */
function disposePage() {
  dispose?.()
}
onMounted(mountPage)
onBeforeUnmount(disposePage)
</script>

<template>
  <div class="speaker-identification">
    <RouterLink class="sandbox-back" to="/">
      ← Sandbox
    </RouterLink>
    <!-- Trusted static markup; this subtree is owned by the page controller. -->
    <div ref="page" v-html="template" />
  </div>
</template>

<style src="../features/speaker-identification/style.css"></style>
