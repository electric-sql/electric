import { describe, it, expect, vi } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import type { SandboxInstance, RunTurnArgs } from '../../src/types'

function makeFakeSandbox(stdoutLines: string[]): SandboxInstance {
  const handle = {
    stdout: (async function* () {
      for (const l of stdoutLines) yield l
    })(),
    stderr: (async function* () {})(),
    writeStdin: vi.fn().mockResolvedValue(undefined),
    closeStdin: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
  }
  return {
    instanceId: `fake-instance`,
    agentId: `/x/coding-agent/y`,
    workspaceMount: `/workspace`,
    exec: vi.fn().mockResolvedValue(handle),
    destroy: vi.fn(),
  } as unknown as SandboxInstance
}

const initLineFor = (kind: string) =>
  kind === `claude`
    ? JSON.stringify({
        type: `system`,
        subtype: `init`,
        session_id: `sess-1`,
        tools: [],
        mcp_servers: [],
      })
    : JSON.stringify({
        type: `session_meta`,
        timestamp: `2026-05-01T12:00:00Z`,
        payload: { id: `sess-1`, cwd: `/workspace` },
      })

describe.each(listAdapters().map((a) => [a.kind] as const))(
  `StdioBridge — onNativeLine — %s`,
  (kind) => {
    it(`calls onNativeLine for every non-empty stdout line`, async () => {
      const lines = [initLineFor(kind), `{"type":"placeholder"}`]
      const sandbox = makeFakeSandbox(lines)
      const bridge = new StdioBridge()
      const received: string[] = []

      await bridge.runTurn({
        sandbox,
        kind,
        prompt: `hi`,
        onEvent: () => undefined,
        onNativeLine: (l) => received.push(l),
      } as RunTurnArgs)

      expect(received).toEqual(lines)
    })

    it(`does not call onNativeLine for empty lines`, async () => {
      const lines = [``, initLineFor(kind)]
      const sandbox = makeFakeSandbox(lines)
      const bridge = new StdioBridge()
      const received: string[] = []

      await bridge.runTurn({
        sandbox,
        kind,
        prompt: `hi`,
        onEvent: () => undefined,
        onNativeLine: (l) => received.push(l),
      } as RunTurnArgs)

      expect(received.every((l) => l.length > 0)).toBe(true)
    })
  }
)
