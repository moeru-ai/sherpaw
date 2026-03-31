<script setup lang="ts">
import type { OnlineRecognizerType } from '@sherpaw/asr'

import { errorMessageFrom } from '@moeru/std'
import { OnlineRecognizerTypes } from '@sherpaw/asr'
import { computed, ref } from 'vue'
import { readFileAsArrayBuffer, readFileAsText } from '../helpers'
import Button from './Button.vue'

type MetadataJson = Record<string, unknown>

defineProps<{
  detectedRecognizerLabel?: string
  initializing: boolean
}>()

const emit = defineEmits<{
  initialize: []
}>()
const metadata = defineModel<MetadataJson | null>('metadata', { default: null })
const data = defineModel<ArrayBuffer | null>('data', { default: null })
const recognizerType = defineModel<OnlineRecognizerType>('recognizerType', { default: OnlineRecognizerTypes.Paraformer })

const errorMessage = ref('')
const recognizerOptions = [
  { label: 'Transducer', value: OnlineRecognizerTypes.Transducer },
  { label: 'Paraformer', value: OnlineRecognizerTypes.Paraformer },
  { label: 'Zipformer2CTC', value: OnlineRecognizerTypes.Zipformer2CTC },
  { label: 'NemoCTC', value: OnlineRecognizerTypes.NemoCTC },
  { label: 'ToneCTC', value: OnlineRecognizerTypes.ToneCTC },
]

const metadataStringified = computed(() => {
  if (!metadata.value)
    return ''
  return JSON.stringify(metadata.value, null, 2)
})

const dataSize = computed(() => {
  if (!data.value)
    return 'No data loaded'
  const mb = data.value.byteLength / 1024 / 1024
  return `${mb.toFixed(2)} MB loaded`
})

const recognizerHint = computed(() => {
  switch (recognizerType.value) {
    case OnlineRecognizerTypes.Transducer:
      return 'Expected files: encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt'
    case OnlineRecognizerTypes.Paraformer:
      return 'Expected files: encoder.onnx, decoder.onnx, tokens.txt'
    case OnlineRecognizerTypes.Zipformer2CTC:
      return 'Expected files: encoder.onnx, tokens.txt'
    case OnlineRecognizerTypes.NemoCTC:
      return 'Expected files: nemo-ctc.onnx, tokens.txt'
    case OnlineRecognizerTypes.ToneCTC:
      return 'Expected files: tone-ctc.onnx, tokens.txt'
    default:
      return ''
  }
})

async function handleMetadataFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return

  errorMessage.value = ''
  try {
    const text = await readFileAsText(file)
    metadata.value = JSON.parse(text) as MetadataJson
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) || 'An unknown error occurred while loading the metadata file.'
  }
}

async function handleDataFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return

  errorMessage.value = ''
  try {
    const arrayBuffer = await readFileAsArrayBuffer(file)
    data.value = arrayBuffer
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) || 'An unknown error occurred while loading the metadata file.'
  }
}
</script>

<template>
  <div font-sans flex="~ col items-center" w-full p-4 gap-4>
    <div w-full flex="~ col gap-3">
      <label text-sm font-semibold>Recognizer type</label>
      <select
        v-model="recognizerType"
        p-2 rounded-xl
        border="1 neutral-300"
      >
        <option
          v-for="option in recognizerOptions"
          :key="option.label"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
      <div text-sm text-neutral-600>
        {{ recognizerHint }}
      </div>
      <div
        v-if="detectedRecognizerLabel"
        text-xs text-neutral-500
      >
        Detected from metadata: {{ detectedRecognizerLabel }}
      </div>
    </div>
    <div w-full flex="~ col gap-3">
      <label text-sm font-semibold>Metadata JSON</label>
      <input type="file" accept=".json,application/json" @change="handleMetadataFileInput">
      <textarea
        v-if="metadata"
        :value="metadataStringified"
        readonly
        w-full font-mono text-xs
        h-40 p-3
        border="1 neutral-300"
        rounded-xl
        outline-none
      />
    </div>

    <div w-full flex="~ col gap-3">
      <label text-sm font-semibold>Data binary</label>
      <input type="file" @change="handleDataFileInput">
      <div text-sm text-neutral-600>
        {{ dataSize }}
      </div>
    </div>

    <p v-if="errorMessage" text-red-600 text-sm w-full>
      {{ errorMessage }}
    </p>

    <Button
      self-end
      :disabled="!metadata || !data || initializing"
      @click="emit('initialize')"
    >
      {{ initializing ? 'Initializing...' : 'Initialize' }}
    </Button>
  </div>
</template>
