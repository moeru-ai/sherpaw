/** Chromium arguments for a non-looping file-backed microphone. */
export function microphoneArguments(path: string): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${path}%noloop`,
    '--autoplay-policy=no-user-gesture-required',
  ]
}
