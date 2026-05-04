import { execSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runSandboxProviderConformance,
  runCodingAgentsIntegrationConformance,
} from '../../src/conformance'
import { HostProvider, StdioBridge } from '../../src'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'
import type { CodingAgentKind } from '../../src/types'

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const env = loadTestEnv()

// Validator-audit fix (commit 81588155e): the host target runs the CLI
// from the host's $PATH, not from the sandbox image. Task 9's Dockerfile
// bump only installs opencode inside `target=sandbox`. If `opencode`
// isn't on the host's $PATH, the host-conformance opencode block fails
// midway with a confusing "command not found". Skip cleanly when
// missing by returning null from envForKind for the opencode kind.
function hasOpencodeOnPath(): boolean {
  try {
    execSync(`command -v opencode`, { stdio: `ignore` })
    return true
  } catch {
    return false
  }
}
const OPENCODE_AVAILABLE = hasOpencodeOnPath()

function envForKindHost(kind: CodingAgentKind): Record<string, string> | null {
  if (kind === `opencode` && !OPENCODE_AVAILABLE) return null
  return envForKind(env, kind)
}

runSandboxProviderConformance(`HostProvider`, {
  createProvider: () => new HostProvider(),
  scratchWorkspace: async () => {
    const dir = await mkdtemp(join(tmpdir(), `host-conf-`))
    return {
      spec: { type: `bindMount`, hostPath: dir },
      cleanup: () => rm(dir, { recursive: true, force: true }),
    }
  },
  target: `host`,
  skipIf: () => !SHOULD_RUN,
  supportsRecovery: false, // HostProvider.recover() returns []
})

runCodingAgentsIntegrationConformance(`HostProvider`, {
  createProvider: () => new HostProvider(),
  scratchWorkspace: async () => {
    const dir = await mkdtemp(join(tmpdir(), `host-conf-int-`))
    return {
      spec: { type: `bindMount`, hostPath: dir },
      cleanup: () => rm(dir, { recursive: true, force: true }),
    }
  },
  bridge: () => new StdioBridge(),
  envForKind: (kind) => envForKindHost(kind),
  probeForKind: (kind) => probeForKind(env, kind),
  target: `host`,
  skipIf: () => !SHOULD_RUN,
})
