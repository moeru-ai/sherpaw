<script setup lang="ts">
import { useTemplateRef } from 'vue'
import Button from '../components/Button.vue'
import ModelSetupPopover from '../components/ModelSetupPopover.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import { useKWSPlayground } from '../features/kws/page'

const audioFile = useTemplateRef<HTMLInputElement>('audioFile')
const { ready, busy, listening, paused, error, message, seconds, activeLabels, drafts, history, preset, keywordPresets, selectPreset, loadModel, applyKeywords, pauseDetection, addKeyword, removeKeyword, listen, stopMicrophone, testFile, clearHistory } = useKWSPlayground()
</script>

<template>
  <SandboxLayout title="KWS" h-dvh>
    <template #setup>
      <ModelSetupPopover :ready="ready">
        <div p-4 flex="~ col gap-4" overflow-y-auto class="max-h-[70dvh]" aria-label="Model settings">
          <div flex="~ col items-center gap-2" p-4>
            <div font-bold uppercase text-2xl text-neutral>
              Zipformer 3M
            </div>
            <p text-sm text-center>
              Chinese / English · 13 MB
            </p>
          </div>
          <Button :disabled="ready || !!busy" self-end @click="loadModel">
            {{ busy === 'load' ? 'Loading…' : ready ? 'Initialized' : 'Initialize' }}
          </Button>
          <details b="t neutral-200" pt-4>
            <summary cursor-pointer font-semibold>
              Keywords
            </summary>
            <div flex="~ col gap-4" pt-4>
              <label text-sm flex="~ col gap-2">
                Preset
                <select aria-label="Preset" :value="preset.id" :disabled="!!busy" b="1 neutral-300" rounded-xl p-2 @change="selectPreset(($event.target as HTMLSelectElement).value)">
                  <option v-for="option in keywordPresets" :key="option.id" :value="option.id">{{ option.name }}</option>
                </select>
              </label>
              <p text-xs text-neutral-500>
                {{ preset.note }} Presets apply immediately once the model is ready.
              </p>
              <div v-for="(row, index) in drafts" :key="row.id" class="keyword-row" flex="~ col gap-3" b="1 neutral-300" rounded-xl p-3>
                <label text-sm>Label<input v-model="row.label" :aria-label="`Keyword ${index + 1} label`" :disabled="!!busy" placeholder="Hey Iru" w-full b="1 neutral-300" rounded-xl p-2 mt-1></label>
                <label text-sm min-w-0>Tokens<textarea v-model="row.tokens" :aria-label="`Keyword ${index + 1} tokens`" :rows="Math.min(4, row.tokens.split('\n').length)" :disabled="!!busy" spellcheck="false" w-full b="1 neutral-300" rounded-xl p-2 mt-1 font-mono text-xs /></label>
                <div flex="~ items-end gap-3">
                  <label text-sm flex-1 min-w-0>Score<input v-model="row.score" :aria-label="`Keyword ${index + 1} score`" :disabled="!!busy" type="number" min="0" step="any" placeholder="1" w-full b="1 neutral-300" rounded-xl p-2 mt-1></label>
                  <label text-sm flex-1 min-w-0>Threshold<input v-model="row.threshold" :aria-label="`Keyword ${index + 1} threshold`" :disabled="!!busy" type="number" min="0" max="1" step="any" placeholder="0.25" w-full b="1 neutral-300" rounded-xl p-2 mt-1></label>
                  <Button :aria-label="`Remove keyword ${index + 1}`" :disabled="!!busy" @click="removeKeyword(row.id)">
                    Remove
                  </Button>
                </div>
              </div>
              <p v-if="!drafts.length" text-sm text-neutral-500>
                Applying an empty list pauses detection.
              </p>
              <div flex="~ wrap gap-3">
                <Button :disabled="!!busy" @click="addKeyword">
                  Add keyword
                </Button>
                <Button :disabled="!ready || !!busy" @click="applyKeywords">
                  {{ busy === 'update' ? 'Applying…' : 'Apply' }}
                </Button>
                <Button :disabled="!ready || paused || !!busy" @click="pauseDetection">
                  Pause detection
                </Button>
              </div>
              <p text-xs text-neutral-500>
                Separate tokens with spaces and pronunciations with new lines. Apply manual edits to update the active keywords.
              </p>
            </div>
          </details>
        </div>
      </ModelSetupPopover>
    </template>

    <main p-4 w-full relative min-h-0 flex="~ col items-center justify-center gap-4 grow-1">
      <div v-if="!listening && !history.length" flex="~ col items-center gap-6" w-full p-4>
        <h1 text-4xl md:text-6xl lg:text-8xl font-semibold text-center>
          Keyword spotting
        </h1>
        <Button :disabled="!ready || paused || !!busy" @click="listen">
          Start
        </Button>
      </div>
      <div v-else flex="~ col items-center justify-end gap-6" w-full absolute h-full p-6>
        <div class="history" w-full min-h-0 overflow-y-auto flex="~ col items-center gap-6 grow-1" aria-label="Detections">
          <p v-if="!history.length" text-4xl font-semibold text-center my-auto>
            Listening<span font-normal animate-pulse>|</span>
          </p>
          <article v-for="(hit, index) in history" :key="hit.id" class="hit" text-center shrink-0>
            <strong :class="index === 0 ? 'text-4xl font-bold' : 'text-3xl op-70'">{{ hit.label }}</strong>
            <p text-xs text-neutral-500 mt-2>
              {{ hit.source }} · {{ (hit.timestamps[0] ?? 0).toFixed(2) }} s
            </p>
            <details text-xs text-neutral-500 mt-2>
              <summary cursor-pointer>
                Token timestamps
              </summary>
              <p>Segment start: {{ hit.startTime.toFixed(2) }} s</p>
              <div class="token-times" flex="~ wrap justify-center gap-2" mt-2>
                <span v-for="(token, tokenIndex) in hit.tokens" :key="tokenIndex">{{ token }} {{ (hit.timestamps[tokenIndex] ?? 0).toFixed(2) }} s</span>
              </div>
              <p mt-2>
                Times are relative to the decoder segment.
              </p>
            </details>
          </article>
        </div>
        <div flex="~ col items-center gap-3 shrink-0">
          <p class="time" text-sm text-neutral-500 tabular-nums>
            {{ seconds.toFixed(1) }} s · {{ paused ? 'Paused' : listening ? 'Listening' : 'Idle' }}
          </p>
          <Button v-if="listening" @click="stopMicrophone">
            Stop listening
          </Button>
          <Button v-else :disabled="!ready || paused || !!busy" @click="listen">
            Start
          </Button>
        </div>
      </div>
    </main>
    <footer w-full p-4 flex="~ col items-center gap-3 shrink-0" text-sm>
      <div class="active-words" flex="~ wrap justify-center gap-3" text-neutral-500 aria-label="Active keywords">
        <span v-for="(label, index) in activeLabels" :key="index" class="word">{{ label }}</span>
      </div>
      <div flex="~ wrap justify-center gap-3">
        <Button :disabled="!ready || paused || listening || !!busy" @click="audioFile?.click()">
          Test audio file
        </Button>
        <Button v-if="history.length" @click="clearHistory">
          Clear detections
        </Button>
        <input ref="audioFile" type="file" hidden accept="audio/*" aria-label="Test audio file" :disabled="!ready || paused || listening || !!busy" @change="testFile">
      </div>
      <p role="status" text-neutral-500 text-center>
        {{ message }}
      </p>
      <p v-if="error" role="alert" text-red-600 text-center>
        {{ error }}
      </p>
    </footer>
  </SandboxLayout>
</template>
