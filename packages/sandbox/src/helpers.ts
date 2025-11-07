export function flatten(samplesList: Int16Array[]) {
  let n = 0
  for (let i = 0; i < samplesList.length; ++i) n += samplesList[i]!.length
  const ans = new Int16Array(n)
  let offset = 0
  for (let i = 0; i < samplesList.length; ++i) {
    const chunk = samplesList[i]!
    ans.set(chunk, offset)
    offset += chunk.length
  }
  return ans
}

export async function readFileAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as ArrayBuffer)
    }
    reader.readAsArrayBuffer(file)
  })
}

export async function readFileAsText(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as string)
    }
    reader.readAsText(file)
  })
}
