export async function readFileAsArrayBuffer(file: File) {
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as ArrayBuffer)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read file as ArrayBuffer.'))
    }
    reader.readAsArrayBuffer(file)
  })
}

export async function readFileAsText(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as string)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read file as text.'))
    }
    reader.readAsText(file)
  })
}
