import { icons } from '@iconify-json/svg-spinners'

import type { LoadingProgress } from './protocol'

import { speakerClient } from './client'
import { startRecording } from './recorder'
import { renderResult } from './result-view'

const model = document.querySelector<HTMLSelectElement>('#model')!
const load = document.querySelector<HTMLButtonElement>('#load')!
const modelStatus = document.querySelector<HTMLParagraphElement>('#model-status')!
const modelLoading = document.querySelector<HTMLDivElement>('#model-loading')!
const modelProgress = document.querySelector<HTMLProgressElement>('#model-progress')!
const enroll = document.querySelector<HTMLButtonElement>('#enroll')!
const record = document.querySelector<HTMLButtonElement>('#record')!
const speakerName = document.querySelector<HTMLInputElement>('#speaker-name')!
const enrollStatus = document.querySelector<HTMLParagraphElement>('#enroll-status')!
const voices = document.querySelector<HTMLDivElement>('#voices')!
const recordings = document.querySelector<HTMLTableSectionElement>('#recordings')!
const models: Record<string, { name: string, url: string }> = {
  cam: { name: 'CAM++', url: new URL('../../../models/huggingface/sherpaw-campplus-zh-en-advanced/install/bin/wasm/preload.data', import.meta.url).href },
  eres: { name: 'ERes2NetV2', url: new URL('../../../models/huggingface/sherpaw-eres2netv2-zh-cn/install/bin/wasm/preload.data', import.meta.url).href },
}
const registered = new Set<string>()
interface SpeakerGroup {
  name: string
  element: HTMLElement
  samples: HTMLElement
  append: HTMLButtonElement
  count: HTMLElement
  renameForm: HTMLFormElement
  renameInput: HTMLInputElement
  nextSample: number
}
const speakerGroups = new Map<string, SpeakerGroup>()
let loadedModel: string | undefined
let loading = false
let capturing = false
let managing = false
let jobs = 0
let recordingNumber = 0

function spinner() {
  const span = document.createElement('span')
  span.className = 'spinner'
  span.setAttribute('aria-hidden', 'true')
  // Trusted SVG from the installed Iconify icon collection, never user input.
  span.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${icons.icons['180-ring-with-bg'].body}</svg>`
  return span
}
load.querySelector('.spinner')!.replaceWith(spinner())
const loadSpinner = load.querySelector<HTMLElement>('.spinner')!

/** Triggering workflow: model change / recording or management completion -> updateControls -> available recording and database actions. */
function updateControls() {
  // Inference only locks model replacement. The next recording can start immediately.
  model.disabled = load.disabled = loading || capturing || jobs > 0
  enroll.disabled = !loadedModel || loading || capturing || managing
  record.disabled = !loadedModel || loading || capturing || managing || registered.size === 0
  loadSpinner.hidden = !loading
  load.querySelector('.button-label')!.textContent = loading ? '加载中' : loadedModel === model.value ? '重新加载' : '加载模型'
  document.querySelector('#voice-count')!.textContent = String(registered.size)
  for (const group of speakerGroups.values()) {
    group.append.disabled = enroll.disabled
    group.element.querySelectorAll<HTMLButtonElement>('.manage-action').forEach((button) => {
      button.disabled = !loadedModel || loading || capturing || jobs > 0
    })
  }
}

/** Triggering workflow: speakerClient.init progress -> showModelProgress -> model panel progress bar. */
function showModelProgress(update: LoadingProgress) {
  modelStatus.textContent = update.message
  if (update.total)
    modelProgress.value = (update.completed ?? 0) / update.total
  else
    modelProgress.removeAttribute('value')
}

/** Triggering workflow: load button click -> loadModel -> speakerClient.init -> model readiness and empty voice list. */
async function loadModel() {
  const selected = model.value
  loading = true
  loadedModel = undefined
  registered.clear()
  speakerGroups.clear()
  voices.replaceChildren()
  document.querySelector<HTMLElement>('#voices-empty')!.hidden = false
  modelLoading.hidden = false
  modelProgress.removeAttribute('value')
  modelStatus.classList.remove('error')
  document.querySelector('#model-badge')!.textContent = '加载中'
  document.querySelector('#model-badge')!.removeAttribute('data-ready')
  updateControls()
  try {
    await speakerClient.init(models[selected].url, showModelProgress)
    loadedModel = selected
    modelProgress.value = 1
    modelStatus.textContent = `${models[selected].name} 已就绪，可以注册声线。`
    document.querySelector('#model-badge')!.textContent = models[selected].name
    document.querySelector('#model-badge')!.setAttribute('data-ready', '')
  }
  catch (error) {
    modelStatus.textContent = errorMessage(error)
    modelStatus.classList.add('error')
    document.querySelector('#model-badge')!.textContent = '加载失败'
  }
  finally {
    loading = false
    modelLoading.hidden = true
    updateControls()
  }
}

function errorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return '无法访问麦克风，请在浏览器中允许麦克风权限后重试。'
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('at least'))
    return '录音太短，请至少说 1 秒后再停止。'
  if (message.includes('silence'))
    return '没有收到声音，请检查麦克风后重试。'
  return message
}

function removeGroup(group: SpeakerGroup) {
  registered.delete(group.name)
  speakerGroups.delete(group.name)
  group.element.remove()
  document.querySelector<HTMLElement>('#voices-empty')!.hidden = speakerGroups.size > 0
}

function updateGroupLabels(group: SpeakerGroup) {
  group.element.querySelector('.speaker-title')!.textContent = group.name
  group.element.querySelector('.avatar')!.textContent = Array.from(group.name)[0].toUpperCase()
  group.append.setAttribute('aria-label', `给 ${group.name} 追加录音`)
  group.element.querySelector('.speaker-menu summary')!.setAttribute('aria-label', `${group.name} 的声线操作`)
}

async function manageSpeaker(group: SpeakerGroup, action: () => Promise<void>) {
  if (capturing || jobs > 0 || !loadedModel)
    return
  const message = group.element.querySelector<HTMLElement>('.group-message')!
  message.hidden = true
  managing = true
  jobs++
  updateControls()
  try {
    await action()
  }
  catch (error) {
    message.textContent = errorMessage(error)
    message.hidden = false
  }
  finally {
    managing = false
    jobs--
    updateControls()
  }
}

function getSpeakerGroup(name: string) {
  const existing = speakerGroups.get(name)
  if (existing)
    return existing
  const template = document.querySelector<HTMLTemplateElement>('#speaker-template')!
  const element = template.content.firstElementChild!.cloneNode(true) as HTMLElement
  const group: SpeakerGroup = {
    name,
    element,
    samples: element.querySelector<HTMLElement>('.voice-samples')!,
    append: element.querySelector<HTMLButtonElement>('.append')!,
    count: element.querySelector<HTMLElement>('.sample-count')!,
    renameForm: element.querySelector<HTMLFormElement>('.rename-form')!,
    renameInput: element.querySelector<HTMLInputElement>('.rename-input')!,
    nextSample: 1,
  }
  updateGroupLabels(group)
  /** Triggering workflow: speaker append click -> appendRecording -> beginRecording -> another sample for this speaker. */
  function appendRecording() {
    if (!group.append.disabled)
      void beginRecording('voice', group.name)
  }
  group.append.addEventListener('click', appendRecording)
  /** Triggering workflow: rename menu click -> editName -> inline name editor. */
  function editName() {
    element.querySelector<HTMLDetailsElement>('.speaker-menu')!.open = false
    group.renameInput.value = group.name
    group.renameForm.hidden = false
    group.renameInput.focus()
    group.renameInput.select()
  }
  /** Triggering workflow: inline editor cancel -> cancelRename -> hide the editor without mutating the database. */
  function cancelRename() {
    group.renameForm.hidden = true
  }
  /** Triggering workflow: inline editor submit -> renameSpeaker -> Worker rename -> group labels and lookup key. */
  async function renameSpeaker(event: SubmitEvent) {
    event.preventDefault()
    const newName = group.renameInput.value.trim()
    await manageSpeaker(group, async () => {
      if (!newName || newName.includes('\0'))
        throw new Error('请输入有效的名字。')
      if (newName !== group.name && speakerGroups.has(newName))
        throw new Error('这个名字已存在，请使用另一个名字。')
      const oldName = group.name
      if (registered.has(oldName)) {
        await speakerClient.rename(oldName, newName)
        registered.delete(oldName)
        registered.add(newName)
      }
      speakerGroups.delete(oldName)
      group.name = newName
      speakerGroups.set(newName, group)
      updateGroupLabels(group)
      group.renameForm.hidden = true
    })
  }
  /** Triggering workflow: delete voice menu click -> deleteSpeaker -> Worker removal -> remove the complete group. */
  async function deleteSpeaker() {
    await manageSpeaker(group, async () => {
      if (registered.has(group.name))
        await speakerClient.removeSpeaker(group.name)
      removeGroup(group)
    })
  }
  element.querySelector('.rename')!.addEventListener('click', editName)
  element.querySelector('.cancel-rename')!.addEventListener('click', cancelRename)
  group.renameForm.addEventListener('submit', renameSpeaker)
  element.querySelector('.remove-speaker')!.addEventListener('click', deleteSpeaker)
  speakerGroups.set(name, group)
  voices.append(element)
  document.querySelector<HTMLElement>('#voices-empty')!.hidden = true
  return group
}

function createRow(kind: 'voice' | 'record', name: string) {
  const template = document.querySelector<HTMLTemplateElement>(`#${kind}-template`)!
  const element = template.content.firstElementChild!.cloneNode(true) as HTMLElement
  element.querySelector('.row-name')!.textContent = name
  const row = {
    element,
    stop: element.querySelector<HTMLButtonElement>('.stop')!,
    status: element.querySelector<HTMLElement>('.row-status')!,
    progress: element.querySelector<HTMLProgressElement>('.row-progress')!,
    duration: element.querySelector<HTMLElement>('.row-duration')!,
  }
  if (kind === 'record') {
    element.querySelector('.row-meta')!.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · ${models[loadedModel!].name}`
    const remove = element.querySelector<HTMLButtonElement>('.remove-record')!
    remove.setAttribute('aria-label', `删除${name}`)
    /** Triggering workflow: record delete click -> deleteRecording -> remove this result row and refresh the count/empty state. */
    function deleteRecording() {
      if (remove.disabled)
        return
      element.remove()
      document.querySelector('#record-count')!.textContent = String(recordings.children.length)
      document.querySelector<HTMLElement>('#recording-empty')!.hidden = recordings.children.length > 0
    }
    remove.addEventListener('click', deleteRecording)
    recordings.prepend(element)
    document.querySelector<HTMLElement>('#recording-empty')!.hidden = true
    document.querySelector('#record-count')!.textContent = String(recordings.children.length)
  }
  else {
    const group = getSpeakerGroup(name)
    const sampleLabel = `样本 ${group.nextSample++}`
    element.querySelector('.row-name')!.textContent = sampleLabel
    const remove = element.querySelector<HTMLButtonElement>('.remove-sample')!
    remove.setAttribute('aria-label', `删除${sampleLabel}`)
    /** Triggering workflow: sample delete click -> deleteSample -> Worker centroid rebuild -> sample/group removal. */
    async function deleteSample() {
      await manageSpeaker(group, async () => {
        const sampleId = element.dataset.sampleId
        if (sampleId) {
          const result = await speakerClient.removeSample(group.name, sampleId)
          group.count.textContent = `${result.sampleCount} 段录音`
          if (!result.sampleCount)
            removeGroup(group)
        }
        element.remove()
        if (!group.samples.children.length && !registered.has(group.name))
          removeGroup(group)
      })
    }
    remove.addEventListener('click', deleteSample)
    group.element.querySelector<HTMLDetailsElement>('.samples')!.open = true
    group.samples.append(element)
  }
  return row
}

type Row = ReturnType<typeof createRow>

function setRowStatus(row: Row, state: string, message: string, busy = false) {
  row.element.dataset.state = state
  const remove = row.element.querySelector<HTMLButtonElement>('.remove-record')
  if (remove) {
    remove.disabled = state !== 'done' && state !== 'error'
    remove.title = remove.disabled ? '录制结束并处理完成后可删除' : '删除记录'
  }
  row.status.replaceChildren()
  if (busy)
    row.status.append(spinner())
  row.status.append(document.createTextNode(message))
  row.progress.hidden = !busy
}

async function beginRecording(kind: 'voice' | 'record', name: string) {
  capturing = true
  const row = createRow(kind, name)
  setRowStatus(row, 'permission', '等待麦克风权限…', true)
  updateControls()
  try {
    const recording = await startRecording((seconds) => {
      row.duration.textContent = `${seconds.toFixed(1)} 秒`
    })
    setRowStatus(row, 'recording', '正在录制')
    row.stop.disabled = false
    /** Triggering workflow: row stop click -> stopRecording -> recorder.stop -> enqueue this row's enrollment or identification. */
    async function stopRecording() {
      row.stop.disabled = true
      row.stop.hidden = true
      jobs++
      let released = false
      setRowStatus(row, 'queued', '等待处理…', true)
      try {
        const audio = await recording.stop()
        row.duration.textContent = `${(audio.samples.length / audio.sampleRate).toFixed(1)} 秒`
        capturing = false
        released = true
        updateControls()
        /** Triggering workflow: Worker progress -> updateRowProgress -> only this row's processing indicator. */
        function updateRowProgress(progress: LoadingProgress) {
          setRowStatus(row, 'processing', progress.message, true)
        }
        if (kind === 'voice') {
          const result = await speakerClient.enroll(name, [audio], updateRowProgress)
          registered.add(name)
          row.element.dataset.sampleId = result.sampleIds.at(-1)!
          getSpeakerGroup(name).count.textContent = `${result.sampleCount} 段录音`
          setRowStatus(row, 'done', '已加入')
        }
        else {
          renderResult(row.element, await speakerClient.identify(audio, updateRowProgress))
          setRowStatus(row, 'done', '完成')
        }
      }
      catch (error) {
        setRowStatus(row, 'error', errorMessage(error))
      }
      finally {
        // Only this recording owns the mic until stop() resolves; later jobs must not release a newer recording's lock.
        if (!released)
          capturing = false
        jobs--
        updateControls()
      }
    }
    row.stop.addEventListener('click', stopRecording, { once: true })
  }
  catch (error) {
    capturing = false
    row.stop.hidden = true
    setRowStatus(row, 'error', errorMessage(error))
    updateControls()
  }
}

/** Triggering workflow: enrollment-form submit -> enrollVoice -> named recording row -> manual stop and enrollment. */
function enrollVoice(event: SubmitEvent) {
  event.preventDefault()
  const name = speakerName.value.trim()
  if (!name || name.includes('\0')) {
    enrollStatus.textContent = '请输入声线名字。'
    speakerName.focus()
    return
  }
  if (enroll.disabled)
    return
  enrollStatus.textContent = '同名录音自动合并；也可以点击声线旁的「＋ 录音」。'
  speakerName.value = ''
  void beginRecording('voice', name)
}

/** Triggering workflow: record click -> createRecording -> independent result row -> manual stop and identification. */
function createRecording() {
  if (record.disabled)
    return
  recordingNumber++
  void beginRecording('record', `录制 ${String(recordingNumber).padStart(2, '0')}`)
}

load.addEventListener('click', loadModel)
model.addEventListener('change', updateControls)
document.querySelector('#enrollment-form')!.addEventListener('submit', event => enrollVoice(event as SubmitEvent))
record.addEventListener('click', createRecording)
updateControls()
