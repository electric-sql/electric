import { describe, expect, it } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
// Import the package barrel so claude/codex/opencode adapters
// self-register on import (registerAdapter is called at module load).
import '../../src'
import type { ExecHandle, ExecRequest, SandboxInstance } from '../../src/types'

// Tier 2 Phase B: regression for the C5 byte-cap fix in StdioBridge.
// Replaced args.prompt.length (UTF-16 code units) with
// Buffer.byteLength(prompt, 'utf8'). This test pins every relevant
// boundary including a multibyte boundary that the old code would
// silently let through (or wrongly trip).

const LIMIT = 900_000 // mirrors PROMPT_LIMIT_BYTES in stdio-bridge.ts

function fakeSandbox(): SandboxInstance {
  return {
    instanceId: `fake`,
    agentId: `/x/coding-agent/y`,
    workspaceMount: `/workspace`,
    homeDir: `/home/agent`,
    async exec(_req: ExecRequest): Promise<ExecHandle> {
      // Real claude session_init so normalize doesn't throw.
      const initLine = `{"type":"system","subtype":"init","session_id":"abc"}`
      return {
        stdout: (async function* () {
          yield initLine
        })(),
        stderr: (async function* () {
          /* none */
        })(),
        writeStdin: async () => undefined,
        closeStdin: async () => undefined,
        wait: async () => ({ exitCode: 0 }),
        kill: () => undefined,
      }
    },
    async copyTo() {
      /* not used */
    },
  }
}

function asciiOfBytes(n: number): string {
  return `a`.repeat(n)
}

describe(`StdioBridge — prompt byte-cap (C5 regression)`, () => {
  it(`accepts a prompt of byte-length LIMIT - 1`, async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox(),
        kind: `claude`,
        prompt: asciiOfBytes(LIMIT - 1),
        onEvent: () => undefined,
      })
    ).resolves.toBeDefined()
  })

  it(`accepts a prompt of byte-length LIMIT`, async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox(),
        kind: `claude`,
        prompt: asciiOfBytes(LIMIT),
        onEvent: () => undefined,
      })
    ).resolves.toBeDefined()
  })

  it(`rejects a prompt of byte-length LIMIT + 1`, async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox(),
        kind: `claude`,
        prompt: asciiOfBytes(LIMIT + 1),
        onEvent: () => undefined,
      })
    ).rejects.toThrow(/Prompt exceeds/)
  })

  it(`rejects a multibyte boundary that fits in UTF-16 but overflows UTF-8`, async () => {
    // Padding + 1 emoji (4 UTF-8 bytes). String.length = LIMIT - 3 + 2
    // (emoji is 2 UTF-16 code units) = LIMIT - 1, which the old
    // string.length check would PASS. Buffer.byteLength = LIMIT + 1,
    // which the new byte-cap rejects.
    const EMOJI = `😀`
    const padding = asciiOfBytes(LIMIT - 3)
    const mixed = padding + EMOJI
    expect(Buffer.byteLength(mixed, `utf8`)).toBe(LIMIT + 1)
    expect(mixed.length).toBeLessThan(LIMIT) // would have passed old check

    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox(),
        kind: `claude`,
        prompt: mixed,
        onEvent: () => undefined,
      })
    ).rejects.toThrow(/Prompt exceeds/)
  })

  it(`error message reports actual byte count, not string.length`, async () => {
    // A multibyte prompt where bytes > limit but length is comfortably
    // under. The error string should report bytes, not chars, so the
    // user can correlate with the limit.
    const EMOJI = `😀`
    const overrun = `a`.repeat(LIMIT - 3) + EMOJI + EMOJI
    const expectedBytes = Buffer.byteLength(overrun, `utf8`)
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox(),
        kind: `claude`,
        prompt: overrun,
        onEvent: () => undefined,
      })
    ).rejects.toThrow(new RegExp(`got ${expectedBytes}`))
  })
})
