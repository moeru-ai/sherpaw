import type { Detection, KeywordEntry } from '@sherpaw/kws'

import { computed, onBeforeUnmount, ref } from 'vue'

import { createKWSClient } from './client'
import { startMicrophone } from './microphone'
import { modelURLs } from './models'
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
  const message = ref('先加载模型，再开始监听或选择音频文件。')
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
      tokens: entry.tokens.join(' '),
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
      message.value = '已选择预设，加载模型后开始检测。'
  }

  function entries(): KeywordEntry[] {
    return drafts.value.map(row => ({
      label: row.label,
      tokens: row.tokens.trim() ? row.tokens.trim().split(/\s+/u) : [],
      score: String(row.score).trim() ? Number(row.score) : undefined,
      threshold: String(row.threshold).trim() ? Number(row.threshold) : undefined,
    }))
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
      await client.request({ type: 'load', urls: modelURLs, keywords })
      ready.value = true
      activeLabels.value = keywords.map(entry => entry.label)
      message.value = '模型已就绪，可以开始监听。'
    }
    catch (cause) {
      reportError(cause)
      message.value = '模型未加载，请检查词表或重试。'
    }
    finally {
      busy.value = ''
    }
  }

  async function replace(keywords: KeywordEntry[]) {
    busy.value = 'update'
    error.value = ''
    try {
      await client.request({ type: 'keywords', keywords })
      activeLabels.value = keywords.map(entry => entry.label)
      seconds.value = 0
      message.value = keywords.length ? '词表已更新，音频状态已重置。' : '检测已暂停；应用词表后恢复。'
    }
    catch (cause) {
      reportError(cause)
      message.value = '更新失败，继续使用原词表。'
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
    message.value = '监听已停止，麦克风已释放。'
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
          record(hits, '麦克风')
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
      await startMicrophone(controller.signal, processMicrophone)
      message.value = '正在监听，命中后会自动继续检测。'
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
      message.value = `正在读取 ${file.name}…`
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
        message.value = `正在检测 ${file.name} · ${seconds.value.toFixed(1)} / ${decoded.duration.toFixed(1)} 秒`
      }
      message.value = `${file.name} 检测完成。`
    }
    catch (cause) {
      if (!disposed) {
        reportError(cause)
        message.value = '文件检测未完成，请检查音频后重试。'
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
