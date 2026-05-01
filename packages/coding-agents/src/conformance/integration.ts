import { describe } from 'vitest'
import type {
  Bridge,
  CodingAgentKind,
  SandboxProvider,
  SandboxSpec,
} from '../types'

export interface CodingAgentsIntegrationConformanceConfig {
  /** Constructs a fresh provider instance. Called once per test file. */
  createProvider: () => SandboxProvider | Promise<SandboxProvider>
  /** Returns a scratch workspace + cleanup for each test that needs one. */
  scratchWorkspace: () => Promise<{
    spec: SandboxSpec[`workspace`]
    cleanup: () => Promise<void>
  }>
  /** Bridge under test. */
  bridge: () => Bridge
  /** Per-kind env. Returning null skips that kind's blocks. */
  envForKind: (kind: CodingAgentKind) => Record<string, string> | null
  /** Per-kind probe: minimal echo prompt + expected response matcher. */
  probeForKind: (kind: CodingAgentKind) => {
    prompt: string
    expectsResponseMatching: RegExp
    model?: string
  }
  /** target the provider is known to support. */
  target: SandboxSpec[`target`]
  /** Skip the entire suite if this returns truthy. */
  skipIf?: () => boolean
}

export function runCodingAgentsIntegrationConformance(
  name: string,
  config: CodingAgentsIntegrationConformanceConfig
): void {
  const should = !config.skipIf?.()
  const d = should ? describe : describe.skip
  d(`Coding-agents integration conformance — ${name}`, () => {
    // Scenarios filled in by Tasks 5–6. Empty body for now.
    void config
  })
}
