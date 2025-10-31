export interface Module {
  calledRun?: boolean
  preRun?: Array<(...args: any[]) => any>
  addRunDependency: (id: string) => void
  removeRunDependency: (id: string) => void
  FS_createDataFile: (parent: string | null, name: string | null, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean) => void
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
