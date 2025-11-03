import type { WasmModuleOptions } from '@sherpa-onnx-wasm/shared'

// @ts-check

// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    /**
     * @param {string|null=} returnType
     * @param {Array=} argTypes
     * @param {Array=} args
     * @param {Object=} opts
     */
    function ccall(ident: any, returnType?: (string | null) | undefined, argTypes?: any[] | undefined, args?: any[] | undefined, opts?: any | undefined): any;
    function stringToUTF8(str: any, outPtr: any, maxBytesToWrite: any): any;
    /**
     * @param {number} ptr
     * @param {number} value
     * @param {string} type
     */
    function setValue(ptr: number, value: number, type?: string): void;
    /**
     * @param {number} ptr
     * @param {string} type
     */
    function getValue(ptr: number, type?: string): any;
    function lengthBytesUTF8(str: any): number;
    /**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index.
     * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
     * @return {string}
     */
    function UTF8ToString(ptr: number, maxBytesToRead?: number | undefined, ignoreNul?: boolean | undefined): string;
    function FS_createPath(...args: any[]): any;
    function FS_createDataFile(...args: any[]): any;
    function FS_preloadFile(parent: any, name: any, url: any, canRead: any, canWrite: any, dontCreateFile: any, canOwn: any, preFinish: any): Promise<void>;
    function FS_unlink(...args: any[]): any;
    function FS_createLazyFile(...args: any[]): any;
    function FS_createDevice(...args: any[]): any;
    function addRunDependency(id: any): void;
    function removeRunDependency(id: any): void;
}
interface WasmModule {
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
