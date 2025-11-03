export interface File {
  filename: string
  start: number
  end: number
}

export interface Metadata {
  files: File[]
  remote_package_size: number
}
