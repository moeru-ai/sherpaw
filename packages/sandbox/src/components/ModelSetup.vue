<script setup lang="ts">
import { useDropZone } from '@vueuse/core'
import prettyBytes from 'pretty-bytes'
import { computed, useTemplateRef } from 'vue'
import { readFileAsArrayBuffer, readFileAsText } from '../helpers'
import { useASRStore } from '../store'
import Button from './Button.vue'

const { metadata, data, init: initASR, asrModule } = useASRStore()

const metadataStringified = computed(() => JSON.stringify(metadata.value, null, 2))

const metadataDropZoneRef = useTemplateRef<HTMLDivElement>('metadataDropZone')
const dataDropZoneRef = useTemplateRef<HTMLDivElement>('dataDropZone')

const metadataFileInputRef = useTemplateRef('metadataFileInput')
const dataFileInputRef = useTemplateRef('dataFileInput')

const { isOverDropZone: isOverMetadataDropZone } = useDropZone(metadataDropZoneRef, {
  onDrop: (files: File[] | null) => {
    if (!files || files.length === 0 || !files[0])
      return

    readMetadataFile(files[0])
  },
  multiple: false,
  preventDefaultForUnhandled: false,
})

const { isOverDropZone: isOverDataDropZone } = useDropZone(dataDropZoneRef, {
  onDrop: (files: File[] | null) => {
    if (!files || files.length === 0 || !files[0])
      return

    readDataFile(files[0])
  },
  multiple: false,
  preventDefaultForUnhandled: false,
})

async function readMetadataFile(file: File) {
  const text = await readFileAsText(file)
  metadata.value = JSON.parse(text)
}

async function readDataFile(file: File) {
  const arrayBuffer = await readFileAsArrayBuffer(file)
  data.value = arrayBuffer
}

function handleMetadataFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  readMetadataFile(file)
}

function handleDataFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  readDataFile(file)
}
</script>

<template>
  <div font-sans flex="~ col items-center" w-full p-4>
    <div flex="~ col items-center" w-full>
      <div
        ref="metadataDropZone"
        flex="~ col items-center gap-2"
        p-4
        w-full
      >
        <div
          font-bold uppercase text-2xl
          :class="{
            'text-neutral': !isOverMetadataDropZone,
            'text-dark': isOverMetadataDropZone,
          }"
          transition="color 150"
        >
          (Metadata)
        </div>

        <div
          v-if="metadata"
          w-full h-48
          b="1 neutral-300"
          rounded-xl overflow-hidden
        >
          <textarea
            id="metadata"
            :value="metadataStringified"
            readonly
            w-full font-mono
            vertical-bottom
            p-3
            outline-none
            text-xs
            h-full
          />
        </div>

        <div text-sm text-center>
          <template v-if="!isOverMetadataDropZone">
            Drop a metadata file here, or
            <span
              text-dark underline mt-2
              role="button"
              @click="metadataFileInputRef?.click()"
            >choose a file</span><span v-if="metadata"> to replace</span>.
          </template>
          <template v-else>
            Release to use this file.
          </template>
        </div>

        <input
          ref="metadataFileInput"
          type="file"
          hidden
          @change="handleMetadataFileInput"
        >
      </div>

      <div
        ref="dataDropZone"
        flex="~ col items-center gap-2"
        p-4
        rounded-2xl
        w-full
      >
        <div
          font-bold uppercase text-2xl
          :class="{
            'text-neutral': !isOverDataDropZone,
            'text-dark': isOverDataDropZone,
          }"
          transition="color 150"
        >
          (Data)
        </div>

        <div v-if="data" text-center>
          <div text-4xl font-semibold>
            {{ prettyBytes(data.byteLength) }}
          </div>
          <div text-lg>
            loaded
          </div>
        </div>

        <div text-sm text-center>
          <template v-if="!isOverDataDropZone">
            Drop a data file here, or
            <span
              text-dark underline mt-2
              role="button"
              @click="dataFileInputRef?.click()"
            >choose a file</span><span v-if="data"> to replace</span>.
          </template>
          <template v-else>
            Release to use this file.
          </template>
        </div>

        <input
          ref="dataFileInput"
          type="file"
          hidden
          @change="handleDataFileInput"
        >
      </div>
    </div>

    <Button
      self-end
      :disabled="!metadata || !data"
      @click="initASR()"
    >
      <template v-if="!asrModule">
        Initialize
      </template>
      <template v-else>
        Re-initialize
      </template>
    </Button>
  </div>
</template>
