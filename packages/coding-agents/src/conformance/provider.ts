import { describe } from 'vitest'
import type { SandboxProvider, SandboxSpec } from '../types'

export interface SandboxProviderConformanceConfig {
  /** Constructs a fresh provider instance. Called once per test file. */
  createProvider: () => SandboxProvider | Promise<SandboxProvider>
  /**
   * Returns a scratch workspace plus a cleanup. The suite calls cleanup
   * in an afterEach for the test that consumed it, even on failure.
   */
  scratchWorkspace: () => Promise<{
    spec: SandboxSpec[`workspace`]
    cleanup: () => Promise<void>
  }>
  /** The target the provider is configured for. */
  target: SandboxSpec[`target`]
  /** Skip the entire suite if this returns truthy. */
  skipIf?: () => boolean
  /**
   * If false, L1.4 (`recover` adopts running instances) is skipped
   * because the provider's `recover()` is documented to return `[]`.
   */
  supportsRecovery?: boolean
}

export function runSandboxProviderConformance(
  name: string,
  config: SandboxProviderConformanceConfig
): void {
  const should = !config.skipIf?.()
  const d = should ? describe : describe.skip
  d(`SandboxProvider conformance — ${name}`, () => {
    // Scenarios filled in by Task 4. Empty body for now.
    void config
  })
}
