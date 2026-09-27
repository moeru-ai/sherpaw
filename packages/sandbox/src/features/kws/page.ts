import type { Detection, KeywordEntry } from '@sherpaw/kws'

import { computed, onBeforeUnmount, ref } from 'vue'

import { startMicrophone } from '../audio/microphone'
import { createKWSClient } from './client'
import { keywordPresets } from './presets'

interface Draft {
  id: number
  label: string
  tokens: string
  score: string | number
  threshold: string | number
}

export function useKWSPlayground() {
  const ready = ref(false)
  const busy = ref('')
  const listening = ref(false)
  const error = ref('')
  const message = ref('Load a model to start listening or test an audio file.')

  const seconds = ref(0)
  const activeLabels = ref<string[]>([])
  const history = ref<(Detection & { id: number, source: string })[]>([])

  const preset = ref(keywordPresets[0]!)
  let rowId = 0
  const drafts = ref<Draft[]>(createDrafts(preset.value.entries))

  let hitId = 0
  let disposed = false
  let inputGeneration = 0
  let microphone: AbortController | undefined
  let fileContext: AudioContext | undefined

  const paused = computed(() => ready.value && activeLabels.value.length === 0)

  /** Triggering workflow: KWS Worker progress -> client.complete -> {@link showProgress} -> message status. */
  function showProgress(progress: string) {
    message.value = progress
  }

  const client = createKWSClient(showProgress)

  function createDrafts(keywords: KeywordEntry[]): Draft[] {
    return keywords.map(entry => ({
      id: ++rowId,
      label: entry.label,
      tokens: entry.matches.map(match => match.tokens.join(' ')).join('\n'),
      score: String(entry.score ?? 1),
      threshold: String(entry.threshold ?? 0.25),
    }))
  }

  /** Triggering workflow: kws.vue preset button `click` -> {@link selectPreset} -> draft replacement and {@link applyKeywords} when loaded. */
  async function selectPreset(id: string) {
    const selected = keywordPresets.find(preset => preset.id === id)

    if (!selected)
      return

    preset.value = selected
    drafts.value = createDrafts(selected.entries)
    error.value = ''

    if (ready.value)
      await applyKeywords()
    else
      message.value = 'Preset selected. Load the model to begin.'
  }

  function entries(): KeywordEntry[] {
    return drafts.value.map((row) => {
      const lines = row.tokens.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)

      return {
        label: row.label,
        matches: lines.map(line => ({ tokens: line.split(/\s+/u) })),
        score: String(row.score).trim() ? Number(row.score) : undefined,
        threshold: String(row.threshold).trim() ? Number(row.threshold) : undefined,
      }
    })
  }

  function reportError(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }

  function record(hits: Detection[], source: string) {
    for (const hit of hits)
      history.value.unshift({ ...hit, id: ++hitId, source })

    history.value = history.value.slice(0, 100)
  }

  /** Triggering workflow: kws.vue load button `click` -> {@link loadModel} -> client.request `load` -> model/keyword status. */
  async function loadModel() {
    busy.value = 'load'
    error.value = ''

    try {
      const keywords = entries()

      await client.request({ type: 'load', keywords, maxActivePaths: preset.value.maxActivePaths })
      ready.value = true
      activeLabels.value = [...new Set(keywords.map(entry => entry.label))]
      message.value = 'Model ready.'
    }
    catch (cause) {
      reportError(cause)
      message.value = 'Could not load the model. Check your keywords and try again.'
    }
    finally {
      busy.value = ''
    }
  }

  async function replace(keywords: KeywordEntry[]) {
    busy.value = 'update'
    error.value = ''

    try {
      await client.request({ type: 'keywords', keywords, maxActivePaths: preset.value.maxActivePaths })
      activeLabels.value = [...new Set(keywords.map(entry => entry.label))]
      seconds.value = 0
      message.value = keywords.length ? 'Keywords updated. Audio state reset.' : 'Detection paused. Apply keywords to resume.'
    }
    catch (cause) {
      reportError(cause)
      message.value = 'Update failed. The previous keywords remain active.'
    }
    finally {
      busy.value = ''
    }
  }

  /** Triggering workflow: kws.vue apply button `click` -> {@link applyKeywords} -> {@link replace} -> client.request `keywords`. */
  async function applyKeywords() {
    await replace(entries())
  }

  /** Triggering workflow: kws.vue pause button `click` -> {@link pauseDetection} -> {@link replace} with an empty vocabulary. */
  async function pauseDetection() {
    await replace([])
  }

  /** Triggering workflow: kws.vue add button `click` -> {@link addKeyword} -> editable draft row. */
  function addKeyword() {
    drafts.value.push({ id: ++rowId, label: '', tokens: '', score: '1', threshold: '0.25' })
  }

  /** Triggering workflow: kws.vue remove button `click` -> {@link removeKeyword} -> draft removal; {@link applyKeywords} commits it. */
  function removeKeyword(id: number) {
    drafts.value = drafts.value.filter(row => row.id !== id)
  }

  /** Triggering workflow: kws.vue stop button / capture failure / {@link dispose} -> {@link stopMicrophone} -> AbortController.abort. */
  function stopMicrophone() {
    inputGeneration++
    microphone?.abort()
    microphone = undefined
    listening.value = false
    message.value = 'Listening stopped. Microphone released.'
  }

  /** Triggering workflow: kws.vue start button `click` -> {@link listen} -> client.request `reset` -> {@link startMicrophone}. */
  async function listen() {
    busy.value = 'start'
    error.value = ''
    seconds.value = 0
    listening.value = true

    const controller = new AbortController()

    microphone = controller

    const generation = ++inputGeneration

    /** Triggering workflow: microphone.collect -> {@link processMicrophone} -> client.request `audio` -> {@link record}. */
    function processMicrophone(samples: Float32Array, sampleRate: number) {
      if (disposed || generation !== inputGeneration)
        return

      seconds.value += samples.length / sampleRate

      if (paused.value)
        return

      void client.request({ type: 'audio', samples, sampleRate }).then((hits) => {
        if (!disposed && generation === inputGeneration)
          record(hits, 'Microphone')
      }).catch((cause: unknown) => {
        if (!disposed && generation === inputGeneration) {
          stopMicrophone()
          reportError(cause)
        }
      })
    }

    try {
      await client.request({ type: 'reset' })
      controller.signal.throwIfAborted()

      let batch: Float32Array | undefined
      let offset = 0

      // Keep 100 ms requests without making the shared recorder clip speaker audio.
      await startMicrophone(controller.signal, (samples, sampleRate) => {
        batch ??= new Float32Array(Math.round(sampleRate / 10))

        for (const value of samples) {
          batch[offset++] = Math.max(-1, Math.min(1, value))

          if (offset === batch.length) {
            const completed = batch

            batch = new Float32Array(batch.length)
            processMicrophone(completed, sampleRate)
            offset = 0
          }
        }
      })
      message.value = 'Listening for keywords.'
    }
    catch (cause) {
      if (!controller.signal.aborted && !disposed) {
        stopMicrophone()
        reportError(cause)
      }
    }
    finally {
      busy.value = ''
    }
  }

  /** Triggering workflow: kws.vue audio file input `change` -> {@link testFile} -> decodeAudioData -> client.request `audio` -> {@link record}. */
  async function testFile(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]

    input.value = ''

    if (!file)
      return

    busy.value = 'file'
    error.value = ''
    seconds.value = 0

    const generation = ++inputGeneration
    const context = new AudioContext({ sampleRate: 16000 })

    fileContext = context

    try {
      message.value = `Reading ${file.name}…`

      const decoded = await context.decodeAudioData(await file.arrayBuffer())

      if (disposed)
        return

      await client.request({ type: 'reset' })

      // Downmix to mono and add one second of trailing silence for streaming KWS.
      const samples = new Float32Array(decoded.length + decoded.sampleRate)

      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const values = decoded.getChannelData(channel)

        for (let i = 0; i < values.length; i++)
          samples[i] = samples[i]! + values[i]! / decoded.numberOfChannels
      }

      for (let i = 0; i < samples.length; i++)
        samples[i] = Math.max(-1, Math.min(1, samples[i]!))

      for (let offset = 0; offset < samples.length; offset += 1600) {
        if (disposed || generation !== inputGeneration)
          return

        const hits = await client.request({ type: 'audio', samples: samples.slice(offset, offset + 1600), sampleRate: decoded.sampleRate })

        if (disposed)
          return

        record(hits, file.name)
        seconds.value = Math.min((offset + 1600) / decoded.sampleRate, decoded.duration)
        message.value = `Processing ${file.name} · ${seconds.value.toFixed(1)} / ${decoded.duration.toFixed(1)} s`
      }

      message.value = `${file.name} complete.`
    }
    catch (cause) {
      if (!disposed) {
        reportError(cause)
        message.value = 'Could not process this audio file. Check the file and try again.'
      }
    }
    finally {
      if (context.state !== 'closed')
        await context.close()

      fileContext = undefined
      busy.value = ''
    }
  }

  /** Triggering workflow: kws.vue clear button `click` -> {@link clearHistory} -> history rows cleared. */
  function clearHistory() {
    history.value = []
  }

  /** Triggering workflow: Vue route onBeforeUnmount -> {@link dispose} -> capture abort, AudioContext.close and client.dispose. */
  function dispose() {
    disposed = true
    stopMicrophone()

    if (fileContext && fileContext.state !== 'closed')
      void fileContext.close().catch(() => {})

    client.dispose()
  }

  onBeforeUnmount(dispose)

  return { ready, busy, listening, paused, error, message, seconds, activeLabels, drafts, history, preset, keywordPresets, selectPreset, loadModel, applyKeywords, pauseDetection, addKeyword, removeKeyword, listen, stopMicrophone, testFile, clearHistory }
}
