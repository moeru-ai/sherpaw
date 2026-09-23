import { modelUrl, readAudio } from '../../../packages/speaker-identification/tests/audio'
import { speakerClient } from '../src/client'
import { startRecording } from '../src/recorder'

// Only the automated fixture tests use timed recording and saved WAV files.
window.speakerTest = {
  rename: speakerClient.rename,
  removeSpeaker: speakerClient.removeSpeaker,
  removeSample: speakerClient.removeSample,
  async init(model = modelUrl.href, onProgress) {
    await speakerClient.init(model, onProgress)
  },
  async enrollFiles(name, files) {
    return speakerClient.enroll(name, await Promise.all(files.map(readAudio)))
  },
  async file(name) {
    return speakerClient.identify(await readAudio(name))
  },
  async microphone(seconds) {
    let finish!: () => void
    const durationReached = new Promise<void>((resolve) => {
      finish = resolve
    })
    const recording = await startRecording(elapsed => elapsed >= seconds && finish())
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        durationReached,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Microphone capture timed out')), (seconds + 10) * 1000) }),
      ])
      return await speakerClient.identify(await recording.stop())
    }
    finally {
      clearTimeout(timeout)
      await recording.stop()
    }
  },
  dispose: speakerClient.dispose,
}
