import type { SpeechSegment } from './speech-detector'
import type { SpeakerGuess, SpeakerTracker, SpeakerTurn } from './types'
import type { UtteranceDetector } from './utterances'

import { createEventHub } from './event-hub'

export type { SileroVad, UtteranceDetector } from './utterances'

export { segmentationUtterances, sileroUtterances } from './utterances'

const SAMPLE_RATE = 16000
// With embeddings, peek compares the last two 1.5 s windows. So a check every 0.75 s finds only a
// change more than 0.75 s back.
const CHECK = 0.75 * SAMPLE_RATE
/** Audio kept for a detector that finds the start of speech late, such as the segmentation model. */
const RECENT = 4 * SAMPLE_RATE
/** Focus decisions come in steps of this many samples (0.25 s). */
const STEP = SAMPLE_RATE / 4
/** With focus, a speaker cut this close to a start or a stop of the focus speaker marks the same change. */
const NEAR = 0.75 * SAMPLE_RATE

/** The label that `track` reported when the turn ended. */
export type TurnLabel = Omit<SpeakerTurn, 'index' | 'revisions'>

/** A later change of a turn's speaker. */
export interface TurnRevision {
  /** The turn whose labeling caused the change. */
  after: number
  from: number | null
  to: number | null
}

/** Speech of one speaker: an utterance, or a part of it between speaker changes. */
export interface ConversationTurn {
  /** Position in the conversation, from 0. */
  index: number
  /** Seconds from the start of the input, or from the last `reset`. */
  start: number
  end: number
  /** The turn ended at a pause, or at a speaker change inside the utterance. */
  cause: 'pause' | 'change'
  /** The speaker number after revisions, or null before the tracker answers. */
  speaker: number | null
  /** Undefined until the tracker answers. */
  label?: TurnLabel
  revisions: TurnRevision[]
  /** The turn's audio, with `keepAudio`. */
  samples?: Float32Array
}

export type TurnChange = 'created' | 'label' | 'speaker'

/** Live information about the turn in progress. */
export interface ConversationPartial {
  /** Seconds from the start of the input to the start of the turn in progress. */
  start: number
  /** The latest guess of the speaker. Undefined before the first speaker check. */
  guess?: Pick<SpeakerGuess, 'speaker' | 'score' | 'confidence'>
}

/** Times are seconds from the start of the input, or from the last `reset`. */
export type ConversationEvent
  /** Someone started to speak: for example, a voice agent stops talking. */
  = | { type: 'speech-start', time: number }
  /**
   * Audio of the turns from `time` on, in order, without gaps inside an utterance. The audio of an
   * utterance comes while it goes on. It can end with some of the silence that ended the utterance.
   * A recognizer that hears these blocks transcribes every turn. With `focus`, blocks with
   * `silent: true` hold silence in place of the other voices.
   */
    | { type: 'audio', time: number, samples: Float32Array, silent?: true }
  /** The turn in progress has a new speaker guess. */
    | { type: 'partial', partial: ConversationPartial }
  /** A turn began, or its label or speaker changed. For displays. */
    | { type: 'turn-update', turn: ConversationTurn, changed: readonly TurnChange[] }
  /** A turn is complete: it has its label. Each turn comes once. */
    | { type: 'turn', turn: ConversationTurn }
  /** The speech detector ended the utterance. The utterance has no more `audio` events. */
    | { type: 'speech-end', time: number }
  /** An asynchronous step failed. The diarizer goes on with the next audio. */
    | { type: 'error', error: unknown }

/** Follows one speaker only. */
export interface FocusOptions {
  /** The speaker to follow, for example the number that `tracker.enroll` returned. */
  speaker: number
  /** A 0.25 s step belongs to the speaker when the windows over it reach this cosine on average. Default: 0.35. */
  threshold?: number
  /** Length of the compared windows. Shorter windows place the speaker's speech more precisely but compare less reliably. Default: 1 s. */
  windowSeconds?: number
}

export interface StreamingDiarizerOptions {
  /** Labels the turns. The caller keeps it, for example to enroll speakers, and disposes it. */
  tracker: SpeakerTracker
  /** Finds the utterances: `sileroUtterances` or `segmentationUtterances`. The caller keeps it. */
  speech: UtteranceDetector
  /**
   * Seconds of audio that a turn keeps from before the speech detector reports speech. Only a
   * detector that does not know where speech starts, such as Silero VAD, uses it. Silero VAD
   * reported speech up to about 1 s late in tests. A shorter value can drop the first words. A
   * longer value adds more background audio before a turn. Default: 1 s.
   */
  leadInSeconds?: number
  /** With the segmentation model, a change counts when the next check finds it again this close. Default: 0.25 s. */
  confirmSeconds?: number
  /** A cut closer than this to the previous cut or to the start of the utterance is dropped. Default: 0.5 s. */
  minCutGapSeconds?: number
  /**
   * Follow one speaker only, for example the enrolled owner of a voice agent. The `audio` events
   * then hold silence in place of the other voices, so a recognizer that hears them transcribes this
   * speaker only. A background voice also does not hold the recognizer when the speaker starts.
   * Turns change where the speaker starts or stops. The audio and the cuts come about 1 s later.
   */
  focus?: FocusOptions
  /** Keep each turn's audio in `samples`, for example to play it or to enroll its speaker. Default: false. */
  keepAudio?: boolean
  /** Aborting disposes the diarizer. */
  signal?: AbortSignal
}

/**
 * Speaker turns from a stream of 16 kHz mono audio. Write the audio to `writable`, or `push` it.
 * Read the events with `for await`, `on` or `readable`. `audio.pipeThrough(diarizer)` does both.
 */
export interface StreamingDiarizer extends AsyncIterable<ConversationEvent>, AsyncDisposable {
  /**
   * A sink for the audio. Closing it ends the input: the diarizer flushes, then ends every iterator
   * and stream as `dispose` does. To go on with more audio after an utterance, call `flush` instead.
   */
  readonly writable: WritableStream<Float32Array>
  /** The events as one stream, from its first use on. Use `tee()` for a second reader of it. */
  readonly readable: ReadableStream<ConversationEvent>
  /** Adds a block of audio. Resolves when the block is handled; labels can come later. */
  push: (samples: Float32Array) => Promise<void>
  /** Ends the utterance in progress and resolves when every turn has its label. More audio can follow. */
  flush: () => Promise<void>
  /** Starts a new conversation. The tracker forgets the speakers, except enrolled ones. */
  reset: () => Promise<void>
  on: <K extends ConversationEvent['type']>(type: K, handler: (event: Extract<ConversationEvent, { type: K }>) => void) => () => void
  /** Copies of the turns so far. */
  turns: () => ConversationTurn[]
  /** Ends every iterator and stream. Safe to repeat. Does not dispose the tracker or the detector. */
  dispose: () => Promise<void>
}

/** Audio of the utterance in progress, from its start or from the last cut in it. */
interface Part {
  /** Samples fed before the part starts. */
  start: number
  chunks: Float32Array[]
  length: number
  /** Samples already sent in `audio` events. */
  sent: number
  /** Length at the last speaker check. */
  checked: number
  /** Segmentation changes that the last check found but did not confirm, in samples from the part start. */
  candidates: number[]
}

/** Audio of the utterance in progress since its start, for focus decisions. Cuts do not change it. */
interface Utterance {
  /** Samples fed before the utterance starts. */
  start: number
  chunks: Float32Array[]
  length: number
  /** The cosine of each full window, from the utterance start. */
  cosines: number[]
  /** The cosine of a window that ends with the utterance, once it ended. */
  tail?: number
  /** Samples already sent in `audio` events. */
  sent: number
  /** Length at the last focus update. */
  updated: number
  /** Per 0.25 s step: true for the focus speaker, false for another voice, undefined when the windows hold no voice. */
  decisions: Array<boolean | undefined>
  /** The next step to look at for a start or a stop of the focus speaker. */
  examined: number
  /** The focus speaker speaks, as of the last start or stop. Undefined before the first two equal steps with a voice. */
  speaking?: boolean
  /** Session positions where the focus speaker starts or stops speaking for at least two steps. */
  transitions: number[]
  /** Session positions of speaker cuts that wait for the focus decisions around them. */
  held: number[]
}

interface Turn extends ConversationTurn {
  /** The `turn` event went out. */
  completed: boolean
}

/** A copy of the samples between two positions of audio that arrived in chunks. */
function range(chunks: Float32Array[], from: number, to: number) {
  const audio = new Float32Array(Math.max(0, to - from))
  let at = 0

  for (const chunk of chunks) {
    const a = Math.max(from, at)
    const b = Math.min(to, at + chunk.length)

    if (b > a)
      audio.set(chunk.subarray(a - at, b - at), a - from)

    at += chunk.length

    if (at >= to)
      break
  }

  return audio
}

/**
 * Creates a diarizer that cuts utterances at speaker changes and labels each turn with the tracker.
 * Its `audio` events carry the audio of the turns, for example for a recognizer.
 */
export function createStreamingDiarizer(options: StreamingDiarizerOptions): StreamingDiarizer {
  const { tracker, speech, focus, keepAudio = false, signal } = options
  const maxLeadIn = Math.round((options.leadInSeconds ?? 1) * SAMPLE_RATE)
  const focusWindow = Math.round((focus?.windowSeconds ?? 1) * SAMPLE_RATE)
  const focusThreshold = focus?.threshold ?? 0.35
  const confirm = (options.confirmSeconds ?? 0.25) * SAMPLE_RATE
  const minGap = (options.minCutGapSeconds ?? 0.5) * SAMPLE_RATE
  const hub = createEventHub<ConversationEvent>()

  signal?.throwIfAborted()

  if (!(maxLeadIn >= 0))
    throw new RangeError('leadInSeconds must be zero or more')

  let turns: Turn[] = []
  /** Turns by the index that `track` returned for them. Revisions use these indexes. */
  let tracked = new Map<number, Turn>()
  let part: Part | undefined
  /** The last `leadInSeconds` of audio before speech, while no part is open. */
  let leadIn: Float32Array[] = []
  let leadInLength = 0
  /** The last 4 s of audio. */
  let recent: Float32Array[] = []
  let recentLength = 0
  /** Samples fed since the start or the last `reset`. */
  let fed = 0
  let partial: ConversationPartial | undefined
  let processing = Promise.resolve()
  // The tracker takes turns one at a time, in order.
  let labeling = Promise.resolve()
  let generation = 0
  let disposed = false
  let writable: WritableStream<Float32Array> | undefined
  let readable: ReadableStream<ConversationEvent> | undefined
  let utterance: Utterance | undefined
  /** The focus speaker has no voice: the `audio` events then hold all voices until the next `reset`. */
  let unfocused = false

  function report(error: unknown) {
    if (!disposed)
      hub.emit({ type: 'error', error })
  }

  function snapshot(turn: Turn): ConversationTurn {
    return {
      index: turn.index,
      start: turn.start,
      end: turn.end,
      cause: turn.cause,
      speaker: turn.speaker,
      ...(turn.label ? { label: { ...turn.label } } : {}),
      revisions: turn.revisions.map(revision => ({ ...revision })),
      ...(keepAudio && turn.samples ? { samples: turn.samples } : {}),
    }
  }

  function update(turn: Turn, changed: TurnChange[]) {
    hub.emit({ type: 'turn-update', turn: snapshot(turn), changed })

    if (!turn.completed && turn.label) {
      turn.completed = true
      hub.emit({ type: 'turn', turn: snapshot(turn) })
    }
  }

  function showPartial() {
    if (partial)
      hub.emit({ type: 'partial', partial: { ...partial, ...(partial.guess ? { guess: { ...partial.guess } } : {}) } })
  }

  /** Triggering workflow: {@link commit} -> {@link label} -> tracker.track -> the turn's label and revised earlier turns. */
  async function label(turn: Turn, session: number) {
    // A turn of an old conversation must not reach the tracker after its reset.
    if (disposed || session !== generation)
      return

    const { revisions, index, ...result } = await tracker.track(turn.samples!, SAMPLE_RATE)

    if (disposed || session !== generation)
      return

    tracked.set(index, turn)

    for (const revision of revisions) {
      const earlier = tracked.get(revision.index)

      if (earlier) {
        earlier.revisions.push({ after: index, from: earlier.speaker, to: revision.speaker })
        earlier.speaker = revision.speaker
        update(earlier, ['speaker'])
      }
    }

    turn.label = result
    turn.speaker = result.speaker

    if (!keepAudio)
      delete turn.samples

    update(turn, ['label'])
  }

  /** Triggering workflow: {@link handle} / {@link endUtterance} -> {@link open} -> the part of a new utterance, its `speech-start` event and, with focus, its decisions. */
  function open(start: number, chunks: Float32Array[], length: number): Part {
    if (focus)
      utterance = { start, chunks: [...chunks], length, cosines: [], sent: 0, updated: 0, decisions: [], examined: 0, transitions: [], held: [] }

    partial = { start: start / SAMPLE_RATE }
    hub.emit({ type: 'speech-start', time: start / SAMPLE_RATE })
    showPartial()

    return { start, chunks, length, sent: 0, checked: 0, candidates: [] }
  }

  /** Triggering workflow: {@link handle} / {@link commit} -> {@link send} -> an `audio` event with the part's audio before `to`, without focus. */
  function send(current: Part, to: number) {
    if (focus || to <= current.sent)
      return

    const samples = range(current.chunks, current.sent, to)
    const time = (current.start + current.sent) / SAMPLE_RATE

    current.sent = to
    hub.emit({ type: 'audio', time, samples })
  }

  /** The cosines of the focus speaker's voice and windows of the audio, or undefined without a voice to compare with. */
  async function similarityOf(audio: Float32Array, window: number) {
    if (unfocused)
      return undefined

    try {
      return await tracker.similarity(audio, SAMPLE_RATE, focus!.speaker, { windowSeconds: window / SAMPLE_RATE, stepSeconds: STEP / SAMPLE_RATE })
    }
    catch (error) {
      unfocused = true
      report(error)

      return undefined
    }
  }

  /**
   * Triggering workflow: {@link handle} every 0.75 s of speech / {@link endUtterance} -> {@link updateFocus} ->
   * tracker.similarity -> `audio` events with the focus speaker's steps, and the other steps as silence.
   */
  async function updateFocus(final: boolean, session: number) {
    const current = utterance!
    // The windows whose centers are nearest to a step's center start this many steps before it.
    const offset = (focusWindow - STEP) / (2 * STEP)

    current.updated = current.length

    // Windows that the audio now covers in full, then one window that ends with the utterance.
    const last = Math.floor((current.length - focusWindow) / STEP)

    if (last >= current.cosines.length) {
      const cosines = await similarityOf(range(current.chunks, current.cosines.length * STEP, last * STEP + focusWindow), focusWindow)

      if (session !== generation)
        return

      current.cosines.push(...(cosines ?? Array.from({ length: last + 1 - current.cosines.length }, () => Number.POSITIVE_INFINITY)))
    }

    if (final && current.length >= STEP) {
      const window = Math.min(current.length, focusWindow)
      const [cosine] = await similarityOf(range(current.chunks, current.length - window, current.length), window) ?? [Number.POSITIVE_INFINITY]

      if (session !== generation)
        return

      current.tail = cosine ?? Number.NaN
    }

    const steps = Math.ceil(current.length / STEP)

    // A step is the speaker's when the windows centered nearest to it reach the threshold on average.
    // Windows over a speaker change hold both voices, so farther windows would move the change.
    // Windows without an embedding, such as silence, leave the step undecided.
    function own(step: number): boolean | undefined {
      const cosines = [...new Set([Math.floor(step - offset), Math.ceil(step - offset)])].flatMap((index) => {
        if (Math.max(0, index) < current.cosines.length)
          return [current.cosines[Math.max(0, index)]!]

        return current.tail === undefined ? [] : [current.tail]
      })
      const valid = cosines.filter(cosine => !Number.isNaN(cosine))

      return valid.length ? valid.reduce((sum, cosine) => sum + cosine, 0) / valid.length >= focusThreshold : undefined
    }

    // Without the utterance end, a step waits until its centered windows exist: no step before the first window.
    const decided = final ? steps : current.cosines.length ? Math.min(steps, Math.floor(current.cosines.length - 1 + offset) + 1) : 0
    const from = current.sent

    if (decided * STEP <= from && !final)
      return

    const to = final ? current.length : decided * STEP

    for (let step = Math.floor(from / STEP); step * STEP < to; step++)
      current.decisions[step] = own(step)

    // The focus speaker starts or stops where a new state lasts two steps. A single step does not count.
    // A step without a voice does not count either: silence before the speaker is not another voice.
    for (let step = current.examined; step + 1 < current.decisions.length; step++) {
      const now = current.decisions[step]

      if (now !== undefined && now !== current.speaking && now === current.decisions[step + 1]) {
        if (current.speaking !== undefined)
          current.transitions.push(current.start + step * STEP)

        current.speaking = now
      }

      current.examined = step + 1
    }

    // The focus speaker's steps go out as they are, and the other steps as silence, in runs of equal
    // steps. A recognizer that hears them transcribes the focus speaker only.
    for (let start = from; start < to;) {
      const kept = !!current.decisions[Math.floor(start / STEP)]
      let end = start

      while (end < to && !!current.decisions[Math.floor(end / STEP)] === kept)
        end = Math.min(to, (Math.floor(end / STEP) + 1) * STEP)

      const time = (current.start + start) / SAMPLE_RATE

      hub.emit(kept ? { type: 'audio', time, samples: range(current.chunks, start, end) } : { type: 'audio', time, samples: new Float32Array(end - start), silent: true })
      start = end
    }

    current.sent = to
  }

  /** Triggering workflow: speaker change or utterance end -> {@link commit} -> a new turn for the part's audio before `to`. */
  function commit(current: Part, to: number, cause: Turn['cause']) {
    const session = generation
    const turn: Turn = {
      index: turns.length,
      start: current.start / SAMPLE_RATE,
      end: (current.start + to) / SAMPLE_RATE,
      cause,
      speaker: null,
      revisions: [],
      samples: range(current.chunks, 0, to),
      completed: false,
    }

    send(current, to)
    turns.push(turn)
    update(turn, ['created'])
    labeling = labeling.then(() => label(turn, session)).catch(report)
  }

  /** Triggering workflow: {@link check} / {@link endUtterance} -> {@link split} -> {@link commit} of the part before `at`. Returns the rest. */
  function split(current: Part, at: number): Part {
    commit(current, at, 'change')

    const rest = range(current.chunks, at, current.length)

    return {
      start: current.start + at,
      chunks: [rest],
      length: rest.length,
      sent: Math.max(0, current.sent - at),
      checked: Math.max(0, current.checked - at),
      candidates: current.candidates.filter(position => position > at).map(position => position - at),
    }
  }

  /** Cuts the part at each change, given in samples from the part start. */
  function splitAll(current: Part, changes: number[]): Part {
    let rest = current
    let done = 0

    for (const at of changes) {
      if (at - done < minGap)
        continue

      rest = split(rest, at - done)
      done = at
    }

    return rest
  }

  /**
   * Triggering workflow: {@link check} / {@link handle} / {@link endUtterance} -> {@link settle} -> the cuts to make now,
   * in samples from the part start. With focus, a speaker cut waits until the focus decisions around it are known.
   * A start or a stop of the focus speaker near it replaces it: the decisions place a change within 0.25 s.
   */
  function settle(current: Part, cuts: number[], final: boolean): number[] {
    if (!utterance)
      return cuts

    const { start, decisions, transitions } = utterance
    // A transition at a step is known once the next step is decided.
    const known = final ? Number.POSITIVE_INFINITY : start + (decisions.length - 1) * STEP
    const held = [...utterance.held, ...cuts.map(at => current.start + at)]
    const ready = held.filter(at => at + NEAR <= known && !transitions.some(transition => Math.abs(transition - at) <= NEAR))

    utterance.held = held.filter(at => at + NEAR > known)

    return [...transitions, ...ready].filter(at => at > current.start).map(at => at - current.start).sort((a, b) => a - b)
  }

  /** Segmentation cuts plus a window change, in samples from the part start, in order. */
  function cutsOf(segmentation: number[], windowChange: number | undefined, from: number): number[] {
    const cuts = windowChange === undefined ? segmentation : [...segmentation, from + Math.round(windowChange * SAMPLE_RATE)]

    return cuts.sort((a, b) => a - b)
  }

  /** Triggering workflow: {@link handle} every 0.75 s of speech -> {@link check} -> tracker.peek -> a speaker guess, and cuts at speaker changes. */
  async function check(current: Part, session: number) {
    // The segmentation model looks at the audio since the last cut. The embedding check looks at its last 3 s.
    const from = tracker.segmentation ? 0 : Math.max(0, current.length - 3 * SAMPLE_RATE)

    current.checked = current.length

    const guess = await tracker.peek(range(current.chunks, from, current.length), SAMPLE_RATE)

    if (session !== generation)
      return current

    // Cut at a change between the last two 1.5 s windows immediately. Cut at a segmentation change
    // when two consecutive checks find it within `confirmSeconds`: near the end of a window, the
    // model's output changes from check to check.
    const found = guess.changes.map(change => from + Math.round(change * SAMPLE_RATE))
    const confirmed = found.filter(at => current.candidates.some(position => Math.abs(at - position) <= confirm))

    current.candidates = found.filter(at => at > (confirmed.at(-1) ?? -1))

    const rest = splitAll(current, settle(current, cutsOf(confirmed, guess.windowChange, from), false))

    partial = { start: rest.start / SAMPLE_RATE, guess: { speaker: guess.speaker, score: guess.score, confidence: guess.confidence } }

    return rest
  }

  /** Audio between two positions from the last 4 s. Positions count the samples fed since the start. */
  function recentAudio(from: number, to: number) {
    const offset = fed - recentLength

    return range(recent, Math.max(0, from - offset), Math.max(0, to - offset))
  }

  /** Triggering workflow: {@link handle} -> {@link endUtterance} -> a final speaker check and the last turn of the utterance. */
  async function endUtterance(segment: SpeechSegment, session: number) {
    // Normally the part holds the segment. It also holds the trailing silence that ended it. A
    // detector can also report an utterance only when it ends.
    const current = part ?? open(segment.start, [segment.samples], segment.samples.length)
    const end = Math.min(current.length, segment.start + segment.samples.length - current.start)

    let cuts: number[] = []

    if (utterance) {
      // The utterance ends here: audio after `end` is the silence that ended it.
      utterance.length = Math.min(utterance.length, segment.start + segment.samples.length - utterance.start)
      await updateFocus(true, session)

      if (session !== generation)
        return false
    }

    if (end > 0 && tracker.segmentation) {
      // The utterance is complete: changes near its end count now, without confirmation.
      const guess = await tracker.peek(range(current.chunks, 0, end), SAMPLE_RATE, { final: true })

      if (session !== generation)
        return false

      cuts = cutsOf(guess.changes.map(change => Math.round(change * SAMPLE_RATE)), guess.windowChange, 0)
    }

    if (end > 0) {
      const rest = splitAll(current, settle(current, cuts, true).filter(at => at < end))

      commit(rest, end - (current.length - rest.length), 'pause')
    }

    part = undefined
    utterance = undefined
    leadIn = []
    leadInLength = 0
    partial = undefined
    hub.emit({ type: 'speech-end', time: (segment.start + segment.samples.length) / SAMPLE_RATE })

    return true
  }

  /** Triggering workflow: {@link push} / {@link flush} -> {@link handle} -> speech detector, speaker checks, audio events and turns. */
  async function handle(block: Float32Array | undefined, session: number) {
    if (disposed || session !== generation)
      return

    const ended = block ? await speech.accept(block) : await speech.flush()

    if (session !== generation)
      return

    if (block) {
      fed += block.length
      recent.push(block)
      recentLength += block.length

      while (recentLength - recent[0]!.length >= RECENT)
        recentLength -= recent.shift()!.length
    }

    // A late detector (the segmentation model) can end one utterance and start the next in one block:
    // the ended one goes first.
    for (const segment of ended) {
      if (!await endUtterance(segment, session))
        return
    }

    if (!block)
      return

    if (speech.speaking()) {
      // The part holds decided audio only: speaker checks never look past a possible utterance end.
      const until = speech.decided()

      if (!part) {
        const start = speech.speechStart()

        if (start === undefined) {
          part = open(until - block.length - leadInLength, leadIn, leadInLength)
          leadIn = []
          leadInLength = 0
        }
        else {
          // The detector found the start late: the audio since then is in the last 4 s.
          part = open(Math.max(start, fed - recentLength), [], 0)
        }
      }

      const piece = recentAudio(part.start + part.length, until)

      part.chunks.push(piece)
      part.length += piece.length

      if (utterance) {
        utterance.chunks.push(piece)
        utterance.length += piece.length
      }

      if (part.length - part.checked >= CHECK) {
        const next = await check(part, session)

        if (session !== generation)
          return

        part = next
        showPartial()
      }

      // The audio goes out while the utterance goes on, for example for live words.
      send(part, part.length)

      if (utterance && utterance.length - utterance.updated >= CHECK) {
        await updateFocus(false, session)

        if (session !== generation)
          return

        part = splitAll(part, settle(part, [], false))
      }
    }
    else if (!part) {
      leadIn.push(block)
      leadInLength += block.length

      while (leadIn.length && leadInLength - leadIn[0]!.length >= maxLeadIn)
        leadInLength -= leadIn.shift()!.length
    }
  }

  /** Runs the steps on the audio one at a time, in order. */
  function enqueue(step: () => Promise<unknown>) {
    processing = processing.then(step).then(() => {}, report)

    return processing
  }

  async function dispose() {
    if (disposed)
      return

    disposed = true
    generation++
    signal?.removeEventListener('abort', abort)
    hub.close()
  }

  function abort() {
    void dispose()
  }

  signal?.addEventListener('abort', abort, { once: true })

  const diarizer: StreamingDiarizer = {
    get writable() {
      writable ??= new WritableStream<Float32Array>({
        write: samples => diarizer.push(samples),
        // As in a TransformStream, the end of the input ends the events, so their readers finish too.
        close: async () => {
          await diarizer.flush()
          await dispose()
        },
        abort: () => dispose(),
      })

      return writable
    },

    get readable() {
      readable ??= hub.readable()

      return readable
    },

    async push(samples) {
      if (disposed)
        throw new Error('The streaming diarizer has been disposed')

      if (!(samples instanceof Float32Array))
        throw new TypeError('samples must be a Float32Array of 16 kHz mono PCM')

      const session = generation

      return enqueue(() => handle(samples, session))
    },

    async flush() {
      if (disposed)
        return

      const session = generation

      await enqueue(() => handle(undefined, session))
      await labeling
    },

    async reset() {
      if (disposed)
        throw new Error('The streaming diarizer has been disposed')

      // Later results of the old conversation are dropped; the reset runs after the audio before it.
      generation++
      await enqueue(async () => {
        turns = []
        tracked = new Map()
        part = undefined
        leadIn = []
        leadInLength = 0
        recent = []
        recentLength = 0
        fed = 0
        partial = undefined
        utterance = undefined
        // The focus speaker can have a voice in the new conversation, for example after `enroll`.
        unfocused = false
        speech.reset()
        await tracker.reset()
      })
    },

    on: (type, handler) => hub.on(type, handler),
    [Symbol.asyncIterator]: () => hub[Symbol.asyncIterator](),
    turns: () => turns.map(snapshot),
    dispose,
    [Symbol.asyncDispose]: dispose,
  }

  return diarizer
}
