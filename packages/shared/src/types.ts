/// <reference types="emscripten" />

export type Ptr = number

export type SherpaOnnxOnlineRecognizer = Ptr
export type SherpaOnnxOnlineStream = Ptr
export type SherpaOnnxOnlineRecognizerResult = Ptr
export type SherpaOnnxDisplay = Ptr

export type SherpaOnnxOfflineRecognizer = Ptr
export type SherpaOnnxOfflineStream = Ptr
export type SherpaOnnxOfflineRecognizerResult = Ptr

export type SherpaOnnxKeywordSpotter = Ptr

export type SherpaOnnxOfflineSpeakerDiarization = Ptr

interface OnlineStreamRuntimeExports {
  _SherpaOnnxCreateOnlineRecognizer: (configPtr: Ptr) => SherpaOnnxOnlineRecognizer
  _SherpaOnnxDestroyOnlineRecognizer: (recognizer: SherpaOnnxOnlineRecognizer) => void

  _SherpaOnnxCreateOnlineStream: (recognizer: SherpaOnnxOnlineRecognizer) => SherpaOnnxOnlineStream
  _SherpaOnnxCreateOnlineStreamWithHotwords: (recognizer: SherpaOnnxOnlineRecognizer, hotwordsPtr: Ptr) => SherpaOnnxOnlineStream
  _SherpaOnnxDestroyOnlineStream: (stream: SherpaOnnxOnlineStream) => void
  _SherpaOnnxOnlineStreamAcceptWaveform: (stream: SherpaOnnxOnlineStream, sampleRate: number, samplesPtr: Ptr, n: number) => void

  _SherpaOnnxIsOnlineStreamReady: (recognizer: SherpaOnnxOnlineRecognizer, stream: SherpaOnnxOnlineStream) => number
  _SherpaOnnxDecodeOnlineStream: (recognizer: SherpaOnnxOnlineRecognizer, stream: SherpaOnnxOnlineStream) => void
  _SherpaOnnxDecodeMultipleOnlineStreams: (recognizer: SherpaOnnxOnlineRecognizer, streamsPtr: Ptr, n: number) => void
  _SherpaOnnxGetOnlineStreamResult: (recognizer: SherpaOnnxOnlineRecognizer, stream: SherpaOnnxOnlineStream) => SherpaOnnxOnlineRecognizerResult
  _SherpaOnnxDestroyOnlineRecognizerResult: (r: SherpaOnnxOnlineRecognizerResult) => void

  _SherpaOnnxGetOnlineStreamResultAsJson: (recognizer: SherpaOnnxOnlineRecognizer, stream: SherpaOnnxOnlineStream) => Ptr
  _SherpaOnnxDestroyOnlineStreamResultJson: (s: Ptr) => void

  _SherpaOnnxOnlineStreamReset: (recognizer: SherpaOnnxOnlineRecognizer, stream: SherpaOnnxOnlineStream) => void
  _SherpaOnnxOnlineStreamInputFinished: (stream: SherpaOnnxOnlineStream) => void
  _SherpaOnnxOnlineStreamIsEndpoint: (recognizer: SherpaOnnxOnlineRecognizer, stream: SherpaOnnxOnlineStream) => number
}

interface OfflineStreamRuntimeExports {
  _SherpaOnnxCreateOfflineRecognizer: (configPtr: Ptr) => SherpaOnnxOfflineRecognizer
  _SherpaOnnxOfflineRecognizerSetConfig: (recognizer: SherpaOnnxOfflineRecognizer, configPtr: Ptr) => void
  _SherpaOnnxDestroyOfflineRecognizer: (recognizer: SherpaOnnxOfflineRecognizer) => void

  _SherpaOnnxCreateOfflineStream: (recognizer: SherpaOnnxOfflineRecognizer) => SherpaOnnxOfflineStream
  _SherpaOnnxCreateOfflineStreamWithHotwords: (recognizer: SherpaOnnxOfflineRecognizer, hotwordsPtr: Ptr) => SherpaOnnxOfflineStream
  _SherpaOnnxDestroyOfflineStream: (stream: SherpaOnnxOfflineStream) => void

  _SherpaOnnxAcceptWaveformOffline: (stream: SherpaOnnxOfflineStream, sampleRate: number, samplesPtr: Ptr, n: number) => void

  _SherpaOnnxDecodeOfflineStream: (recognizer: SherpaOnnxOfflineRecognizer, stream: SherpaOnnxOfflineStream) => void
  _SherpaOnnxDecodeMultipleOfflineStreams: (recognizer: SherpaOnnxOfflineRecognizer, streamsPtr: Ptr, n: number) => void

  _SherpaOnnxGetOfflineStreamResult: (stream: SherpaOnnxOfflineStream) => SherpaOnnxOfflineRecognizerResult
  _SherpaOnnxDestroyOfflineRecognizerResult: (r: SherpaOnnxOfflineRecognizerResult) => void
  _SherpaOnnxGetOfflineStreamResultAsJson: (stream: SherpaOnnxOfflineStream) => Ptr
  _SherpaOnnxDestroyOfflineStreamResultJson: (s: Ptr) => void
}

interface KeywordSpotterRuntimeExports {
  _SherpaOnnxCreateKeywordSpotter: (configPtr: Ptr) => SherpaOnnxKeywordSpotter
  _SherpaOnnxDestroyKeywordSpotter: (spotter: SherpaOnnxKeywordSpotter) => void
}

interface SpeakerDiarizationRuntimeExports {
  _SherpaOnnxCreateOfflineSpeakerDiarization: (configPtr: Ptr) => SherpaOnnxOfflineSpeakerDiarization
  _SherpaOnnxDestroyOfflineSpeakerDiarization: (handle: SherpaOnnxOfflineSpeakerDiarization) => void
  _SherpaOnnxOfflineSpeakerDiarizationGetSampleRate: (handle: SherpaOnnxOfflineSpeakerDiarization) => number
  _SherpaOnnxOfflineSpeakerDiarizationSetConfig: (handle: SherpaOnnxOfflineSpeakerDiarization, configPtr: Ptr) => void
  _SherpaOnnxOfflineSpeakerDiarizationProcess: (handle: SherpaOnnxOfflineSpeakerDiarization, samplesPtr: Ptr, n: number) => Ptr
  _SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments: (resultPtr: Ptr) => number
  _SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime: (resultPtr: Ptr) => Ptr
  _SherpaOnnxOfflineSpeakerDiarizationDestroySegment: (segmentPtr: Ptr) => void
  _SherpaOnnxOfflineSpeakerDiarizationDestroyResult: (resultPtr: Ptr) => void
}

export interface WebAssemblyModule extends EmscriptenModule,
  OnlineStreamRuntimeExports,
  OfflineStreamRuntimeExports,
  KeywordSpotterRuntimeExports,
  SpeakerDiarizationRuntimeExports {
  calledRun?: boolean
  runtimeInitialized?: boolean

  setValue: typeof setValue
  getValue: typeof getValue

  FS_createDataFile: typeof FS['createDataFile']

  addRunDependency: typeof addRunDependency
  removeRunDependency: typeof removeRunDependency

  _malloc: (size: number) => Ptr
  _free: (ptr: Ptr) => void

  stringToUTF8: typeof stringToUTF8
  UTF8ToString: typeof UTF8ToString
  lengthBytesUTF8: typeof lengthBytesUTF8

  cwrap: typeof cwrap
  ccall: typeof ccall

  _CopyHeap: (srcPtr: Ptr, len: number, dstPtr: Ptr) => void
  _SherpaOnnxGetVersionStr: () => Ptr
  _SherpaOnnxGetGitSha1: () => Ptr
  _SherpaOnnxGetGitDate: () => Ptr
  _SherpaOnnxFileExists: (pathPtr: Ptr) => number
}

export interface WebAssemblyModuleOptions extends Partial<WebAssemblyModule> {
  locateFile: (path: string) => string
}

export type WebAssemblyModuleFactory = (options?: WebAssemblyModuleOptions) => Promise<WebAssemblyModule>
