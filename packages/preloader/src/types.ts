export interface Module {
  calledRun?: boolean
  preRun?: EmscriptenModule['preRun']
  addRunDependency: typeof addRunDependency
  removeRunDependency: typeof removeRunDependency
  FS_createDataFile: typeof FS['createDataFile']
}

export interface File {
  filename: string
  start: number
  end: number
}

export interface Metadata {
  files: File[]
  remote_package_size: number
}
