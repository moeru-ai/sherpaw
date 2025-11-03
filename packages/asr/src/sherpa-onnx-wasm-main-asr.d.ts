/// <reference types="emscripten" />

import type { WasmModule as SharedWasmModule, WasmModuleOptions } from '@sherpa-onnx-wasm/shared'

interface WasmModule extends SharedWasmModule {
  _MyPrint(_0: number): void;
  _CopyHeap(_0: number, _1: number, _2: number): void;
  _SherpaOnnxCreateOnlineRecognizer(_0: number): number;
  _SherpaOnnxDestroyOnlineRecognizer(_0: number): void;
  _SherpaOnnxCreateOnlineStream(_0: number): number;
  _SherpaOnnxDestroyOnlineStream(_0: number): void;
  _SherpaOnnxOnlineStreamAcceptWaveform(_0: number, _1: number, _2: number, _3: number): void;
  _SherpaOnnxIsOnlineStreamReady(_0: number, _1: number): number;
  _SherpaOnnxDecodeOnlineStream(_0: number, _1: number): void;
  _SherpaOnnxGetOnlineStreamResult(_0: number, _1: number): number;
  _SherpaOnnxDestroyOnlineRecognizerResult(_0: number): void;
  _SherpaOnnxGetOnlineStreamResultAsJson(_0: number, _1: number): number;
  _SherpaOnnxDestroyOnlineStreamResultJson(_0: number): void;
  _SherpaOnnxOnlineStreamReset(_0: number, _1: number): void;
  _SherpaOnnxOnlineStreamInputFinished(_0: number): void;
  _SherpaOnnxOnlineStreamIsEndpoint(_0: number, _1: number): number;
  _SherpaOnnxGetOfflineStreamResultAsJson(_0: number): number;
  _malloc(_0: number): number;
  _free(_0: number): void;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: WasmModuleOptions): Promise<MainModule>;
