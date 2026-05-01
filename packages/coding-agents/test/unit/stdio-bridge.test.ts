import { describe, expect, it } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import type { ExecHandle, ExecRequest, SandboxInstance } from '../../src/types'

function fakeSandbox(opts: {
  stdoutLines: Array<string>
  stderrLines?: Array<string>
  exitCode?: number
  onCmd?: (cmd: ReadonlyArray<string>) => void
  onStdin?: (chunk: string) => void
}): SandboxInstance {
  return {
    instanceId: `fake`,
    agentId: `/x/coding-agent/y`,
    workspaceMount: `/workspace`,
    async exec(req: ExecRequest): Promise<ExecHandle> {
      opts.onCmd?.(req.cmd)
      const stdoutLines = opts.stdoutLines.slice()
      const stderrLines = (opts.stderrLines ?? []).slice()
      return {
        stdout: (async function* () {
          for (const l of stdoutLines) yield l
        })(),
        stderr: (async function* () {
          for (const l of stderrLines) yield l
        })(),
        writeStdin: async (chunk) => {
          opts.onStdin?.(chunk)
        },
        closeStdin: async () => undefined,
        wait: async () => ({ exitCode: opts.exitCode ?? 0 }),
        kill: () => undefined,
      }
    },
    async copyTo() {
      /* not used */
    },
  }
}

describe(`StdioBridge`, () => {
  it(`rejects non-claude kinds`, async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox({ stdoutLines: [] }),
        kind: `codex` as `claude`,
        prompt: `x`,
        onEvent: () => undefined,
      })
    ).rejects.toThrow(/MVP supports only 'claude'/)
  })

  it(`passes the prompt through stdin and runs the right CLI args`, async () => {
    let cmd: ReadonlyArray<string> = []
    let stdin = ``
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [`{"type":"system","subtype":"init","session_id":"abc"}`],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
      }),
      kind: `claude`,
      prompt: `hello world`,
      model: `claude-haiku-4-5-20251001`,
      onEvent: () => undefined,
    })
    expect(cmd[0]).toBe(`claude`)
    expect(cmd).toContain(`--print`)
    expect(cmd).toContain(`--output-format=stream-json`)
    expect(cmd).toContain(`--verbose`)
    expect(cmd).toContain(`--dangerously-skip-permissions`)
    expect(cmd).toContain(`--model`)
    expect(cmd).toContain(`claude-haiku-4-5-20251001`)
    expect(stdin).toBe(`hello world`)
  })

  it(`throws with stderr when CLI exits non-zero`, async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox({
          stdoutLines: [],
          stderrLines: [`fatal: bad thing`],
          exitCode: 1,
        }),
        kind: `claude`,
        prompt: `x`,
        onEvent: () => undefined,
      })
    ).rejects.toThrow(/claude CLI exited 1.*fatal: bad thing/)
  })
})
