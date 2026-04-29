import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `..`
)
const repoRoot = path.resolve(packageRoot, `../..`)
const source = path.join(repoRoot, `website/docs/agents`)
const target = path.join(packageRoot, `docs`)

async function pathExists(value) {
  try {
    await fs.access(value)
    return true
  } catch {
    return false
  }
}

async function clean() {
  await fs.rm(target, { recursive: true, force: true })
}

if (process.argv.includes(`--clean`)) {
  if (await pathExists(path.join(source, `index.md`))) {
    await clean()
  }
} else {
  if (!(await pathExists(path.join(source, `index.md`)))) {
    if (await pathExists(path.join(target, `index.md`))) {
      console.log(`Agents docs source not found; preserving ${target}`)
      process.exit(0)
    }
    throw new Error(`Agents docs source not found at ${source}`)
  }

  await clean()
  await fs.cp(source, target, { recursive: true })
  console.log(`Synced agents docs from ${source} to ${target}`)
}
