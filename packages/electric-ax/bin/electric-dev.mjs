#!/usr/bin/env node

/**
 * Development wrapper that uses tsx to run the TypeScript source directly.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const srcPath = join(__dirname, `..`, `src`, `index.ts`)
const localTsxPath = join(__dirname, `..`, `node_modules`, `.bin`, `tsx`)
const rootTsxPath = join(
  __dirname,
  `..`,
  `..`,
  `..`,
  `node_modules`,
  `.bin`,
  `tsx`
)
const tsxPath = existsSync(localTsxPath) ? localTsxPath : rootTsxPath

const child = spawn(tsxPath, [srcPath, ...process.argv.slice(2)], {
  stdio: `inherit`,
})

child.on(`error`, (error) => {
  console.error(
    `Failed to start the dev CLI wrapper. Expected tsx at ${tsxPath}.`,
    error
  )
  process.exit(1)
})

child.on(`exit`, (code) => {
  process.exit(code ?? 0)
})
