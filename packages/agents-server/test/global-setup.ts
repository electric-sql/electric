import './setup-test-backend-env'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  ELECTRIC_AGENTS_COMPOSE_FILE,
  getElectricAgentsComposeProject,
} from './electric-agents-compose-utils'

const execFileAsync = promisify(execFile)

// Vitest invokes the default export once before any tests run, and the
// returned function once after every test has finished. We use it to tear down
// the docker compose stack started lazily by `ensureElectricAgentsTestBackend`,
// so containers don't accumulate between local runs.
//
// Set ELECTRIC_AGENTS_KEEP_BACKEND=1 to skip teardown when iterating locally.
export default function setup(): () => Promise<void> {
  return async () => {
    if (process.env.ELECTRIC_AGENTS_KEEP_BACKEND === `1`) {
      return
    }

    try {
      await execFileAsync(
        `docker`,
        [
          `compose`,
          `-p`,
          getElectricAgentsComposeProject(),
          `-f`,
          ELECTRIC_AGENTS_COMPOSE_FILE,
          `down`,
          `-v`,
        ],
        { env: process.env }
      )
    } catch (err) {
      console.warn(
        `[agents-server] failed to stop test backend: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }
}
