/// <reference types="emscripten" />

export interface WebAssemblyModule extends EmscriptenModule {
  calledRun?: boolean
  runtimeInitialized?: boolean

  setValue: typeof setValue
  getValue: typeof getValue

  stringToUTF8: typeof stringToUTF8
  UTF8ToString: typeof UTF8ToString
  lengthBytesUTF8: typeof lengthBytesUTF8

  FS_createDataFile: typeof FS['createDataFile']

  addRunDependency: typeof addRunDependency
  removeRunDependency: typeof removeRunDependency
}

export interface WebAssemblyModuleOptions extends Partial<WebAssemblyModule> {
  locateFile: (path: string) => string
}

export type WebAssemblyModuleFactory = (options?: WebAssemblyModuleOptions) => Promise<WebAssemblyModule>
