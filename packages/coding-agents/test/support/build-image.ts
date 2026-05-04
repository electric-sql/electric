import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(here, `../..`)

export const TEST_IMAGE_TAG = `electric-ax/coding-agent-sandbox:test`

/**
 * Build the test image. Idempotent: re-runs are cheap if Docker layer cache is warm.
 * Throws on non-zero exit.
 */
export async function buildTestImage(): Promise<void> {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn(
      `docker`,
      [`build`, `-t`, TEST_IMAGE_TAG, `-f`, `docker/Dockerfile`, `.`],
      { cwd: PACKAGE_ROOT, stdio: `inherit` }
    )
    child.on(`error`, rejectBuild)
    child.on(`exit`, (code) => {
      if (code === 0) resolveBuild()
      else rejectBuild(new Error(`docker build exited ${code}`))
    })
  })
}
