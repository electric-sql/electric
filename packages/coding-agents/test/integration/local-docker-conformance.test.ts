import { beforeAll } from 'vitest'
import {
  runSandboxProviderConformance,
  runCodingAgentsIntegrationConformance,
} from '../../src/conformance'
import { LocalDockerProvider, StdioBridge } from '../../src'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const env = loadTestEnv()

beforeAll(async () => {
  if (SHOULD_RUN) await buildTestImage()
}, 600_000)

runSandboxProviderConformance(`LocalDockerProvider`, {
  createProvider: () => new LocalDockerProvider({ image: TEST_IMAGE_TAG }),
  scratchWorkspace: async () => ({
    spec: {
      type: `volume`,
      name: `conf-${Math.random().toString(36).slice(2)}`,
    },
    cleanup: async () => undefined, // docker volumes auto-cleanup via destroy
  }),
  target: `sandbox`,
  skipIf: () => !SHOULD_RUN,
  supportsCloneWorkspace: true,
})

runCodingAgentsIntegrationConformance(`LocalDockerProvider`, {
  createProvider: () => new LocalDockerProvider({ image: TEST_IMAGE_TAG }),
  scratchWorkspace: async () => ({
    spec: {
      type: `volume`,
      name: `conf-int-${Math.random().toString(36).slice(2)}`,
    },
    cleanup: async () => undefined,
  }),
  bridge: () => new StdioBridge(),
  envForKind: (kind) => envForKind(env, kind),
  probeForKind: (kind) => probeForKind(env, kind),
  target: `sandbox`,
  skipIf: () => !SHOULD_RUN,
})
