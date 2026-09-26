/** Metrics use the AudioContext clock to include audio delivery delays. */
export interface RealtimeSnapshot {
  receivedAudioSeconds: number
  processedAudioSeconds: number
  captureSpanSeconds: number
  elapsedMs: number
  firstTextMs: number | null
  maxOutstandingSeconds: number
  maxDeliveryDelayMs: number
  captureGapMs: number
  startupCaptureGapMs: number
  inferenceBatches: number
  processingMs: number
  inferenceBatchP95Ms: number
  audioEndToCompletionP95Ms: number
  stopDrainMs: number | null
  gpuDispatches: number
}

export interface RealtimeEvent {
  kind: 'progress' | 'stopped'
  backend: string
  model?: string
  snapshot: RealtimeSnapshot
  text: string
}

function percentile95(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0
}

/** Recording-local counters; completion latency is not word-aligned ASR latency. */
export class RealtimeMetrics {
  private received = 0
  private processed = 0
  private originAudio: number | undefined
  private originWall = 0
  private lastEnd = 0
  private firstText: number | null = null
  private maxOutstanding = 0
  private maxDelivery = 0
  private gapMs = 0
  private startupGapMs = 0
  private processingMs = 0
  private batchMs: number[] = []
  private completionMs: number[] = []
  private stopMs: number | null = null

  /** Triggering workflow: worklet data -> receiveAudio -> sample continuity, delivery delay and outstanding audio counters. */
  receive(samples: number, audioEnd: number, contextTime: number, now: number) {
    const audioStart = audioEnd - samples / 16000
    if (this.originAudio === undefined) {
      this.originAudio = audioStart
      this.originWall = now - Math.max(0, contextTime - audioStart) * 1000
    }
    else {
      const gap = Math.abs(audioStart - this.lastEnd) * 1000
      this.gapMs += gap
      if (audioStart - this.originAudio < 1)
        this.startupGapMs += gap
    }
    this.lastEnd = audioEnd
    this.received += samples
    this.maxOutstanding = Math.max(this.maxOutstanding, (this.received - this.processed) / 16000)
    this.maxDelivery = Math.max(this.maxDelivery, (contextTime - audioEnd) * 1000)
  }

  /** Triggering workflow: pump -> engine.accept completion -> batch latency, processed samples and first partial text. */
  complete(samples: number, audioEnd: number, contextTime: number, ms: number, inferred: boolean, text: string, now: number) {
    this.processed += samples
    this.processingMs += ms
    if (inferred) {
      this.batchMs.push(ms)
      this.completionMs.push(Math.max(0, contextTime - audioEnd) * 1000)
    }
    this.observeText(text, now)
  }

  observeText(text: string, now: number) {
    if (text && this.firstText === null && this.originAudio !== undefined)
      this.firstText = now - this.originWall
  }

  finish(drainMs: number, text: string, now: number) {
    this.stopMs = drainMs
    this.observeText(text, now)
  }

  snapshot(now: number, gpuDispatches: number): RealtimeSnapshot {
    return {
      receivedAudioSeconds: this.received / 16000,
      processedAudioSeconds: this.processed / 16000,
      captureSpanSeconds: this.originAudio === undefined ? 0 : this.lastEnd - this.originAudio,
      elapsedMs: this.originAudio === undefined ? 0 : now - this.originWall,
      firstTextMs: this.firstText,
      maxOutstandingSeconds: this.maxOutstanding,
      maxDeliveryDelayMs: this.maxDelivery,
      captureGapMs: this.gapMs,
      startupCaptureGapMs: this.startupGapMs,
      inferenceBatches: this.batchMs.length,
      processingMs: this.processingMs,
      inferenceBatchP95Ms: percentile95(this.batchMs),
      audioEndToCompletionP95Ms: percentile95(this.completionMs),
      stopDrainMs: this.stopMs,
      gpuDispatches,
    }
  }
}
