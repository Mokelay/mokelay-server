import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const functionsDir = join(projectRoot, '.vercel', 'output', 'functions')
const require = createRequire(import.meta.url)
const componentCss = require.resolve('mokelay-components/style.css')

const entries = await readdir(functionsDir, { withFileTypes: true })
const functionDirs = entries
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('.func'))
  .map((entry) => join(functionsDir, entry.name))

if (functionDirs.length === 0) {
  throw new Error(`No Vercel function output found in ${functionsDir}`)
}

await Promise.all(functionDirs.map(async (functionDir) => {
  const target = join(
    functionDir,
    'node_modules',
    'mokelay-components',
    'dist',
    'mokelay-components.css',
  )
  await mkdir(dirname(target), { recursive: true })
  await copyFile(componentCss, target)
}))

console.log(`[renderPage] included component CSS in ${functionDirs.length} Vercel function(s)`)
