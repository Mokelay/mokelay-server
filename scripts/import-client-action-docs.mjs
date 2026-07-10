import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { runClientRuntimeDocSync } from './import-client-runtime-docs.mjs'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runClientRuntimeDocSync('action').catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
