import { copyFile } from 'node:fs/promises'
import path from 'node:path'

// Copies the wasm files needed for wa-sqlite
// from `/node_modules/wa-sqlite/dist` into `public`
const waSqlitePath = path.join('node_modules', 'wa-sqlite', 'dist')
const publicFolder = 'public'

const mjsFileName = 'wa-sqlite-async.mjs'
const mjsFile = path.join(waSqlitePath, mjsFileName)
const mjsDest = path.join(publicFolder, mjsFileName)

const wasmFileName = 'wa-sqlite-async.wasm'
const wasmFile = path.join(waSqlitePath, wasmFileName)
const wasmDest = path.join(publicFolder, wasmFileName)

try {
  copyFile(mjsFile, mjsDest)
  copyFile(wasmFile, wasmDest)
} catch {
  console.error('Could not copy wasm files required for wa-sqlite. Did you forget to run `npm install` ?')
}