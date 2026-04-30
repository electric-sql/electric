import { describe, it, expect, vi } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import type { SandboxInstance, RunTurnArgs } from '../../src/types'

/**
 * Minimal sandbox double: exec returns a fake handle whose stdout
 * yields the lines we supply, stderr is empty, and wait() returns 0.
 */
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

describe(`StdioBridge — onNativeLine`, () => {
  it(`calls onNativeLine for every non-empty stdout line`, async () => {
    const lines = [
      JSON.stringify({
        type: `system`,
        subtype: `init`,
        session_id: `sess-1`,
        tools: [],
        mcp_servers: [],
      }),
      JSON.stringify({
        type: `result`,
        subtype: `success`,
        result: `ok`,
        session_id: `sess-1`,
        is_error: false,
      }),
    ]
    const sandbox = makeFakeSandbox(lines)
    const bridge = new StdioBridge()
    const received: string[] = []

    await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `hello`,
      onEvent: () => undefined,
      onNativeLine: (l) => received.push(l),
    } as RunTurnArgs)

    expect(received).toEqual(lines)
  })

  it(`does not call onNativeLine for empty lines`, async () => {
    const lines = [
      ``,
      JSON.stringify({
        type: `result`,
        subtype: `success`,
        result: `ok`,
        session_id: `s`,
        is_error: false,
      }),
    ]
    const sandbox = makeFakeSandbox(lines)
    const bridge = new StdioBridge()
    const received: string[] = []

    await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `hi`,
      onEvent: () => undefined,
      onNativeLine: (l) => received.push(l),
    } as RunTurnArgs)

    expect(received.every((l) => l.length > 0)).toBe(true)
  })
})
