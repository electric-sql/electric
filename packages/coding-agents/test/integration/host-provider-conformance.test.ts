import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runSandboxProviderConformance,
  runCodingAgentsIntegrationConformance,
} from '../../src/conformance'
import { HostProvider, StdioBridge } from '../../src'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const env = loadTestEnv()

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
  envForKind: (kind) => envForKind(env, kind),
  probeForKind: (kind) => probeForKind(env, kind),
  target: `host`,
  skipIf: () => !SHOULD_RUN,
})
