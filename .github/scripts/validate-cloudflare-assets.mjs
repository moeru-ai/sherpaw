import { lstat, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** Check the static artifact before build upload and before trusted deployment. */
export async function validateAssets(directory) {
  let count = 0
  async function walk(path) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink())
      throw new Error(`Static assets must not contain symlinks: ${path}`)
    if (stat.isDirectory()) {
      for (const entry of await readdir(path))
        await walk(resolve(path, entry))
      return
    }
    if (!stat.isFile() || stat.size > 25 * 1024 * 1024)
      throw new Error(`Invalid static asset or file exceeds 25 MiB: ${path}`)
    if (++count > 20000)
      throw new Error('Static assets exceed the Workers Free plan limit of 20,000 files')
  }
  await walk(resolve(directory))
  if (!(await lstat(resolve(directory, 'index.html'))).isFile())
    throw new Error('Missing sandbox index.html')
  return count
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2])
    throw new Error('Usage: node validate-cloudflare-assets.mjs <directory>')
  const count = await validateAssets(process.argv[2])
  console.log(`Validated ${count} Cloudflare static assets`)
}
