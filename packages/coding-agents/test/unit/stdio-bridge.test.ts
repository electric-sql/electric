import { describe, expect, it } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
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

describe.each(listAdapters().map((a) => [a.kind, a] as const))(
  `StdioBridge — %s`,
  (kind, adapter) => {
    it(`runs the right CLI binary`, async () => {
      let cmd: ReadonlyArray<string> = []
      const b = new StdioBridge()
      const initLine =
        kind === `claude`
          ? `{"type":"system","subtype":"init","session_id":"abc"}`
          : `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","session_id":"abc"}`
      await b.runTurn({
        sandbox: fakeSandbox({
          stdoutLines: [initLine],
          onCmd: (c) => (cmd = c),
        }),
        kind,
        prompt: `hello world`,
        onEvent: () => undefined,
      })
      expect(cmd[0]).toBe(adapter.cliBinary)
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
          kind,
          prompt: `x`,
          onEvent: () => undefined,
        })
      ).rejects.toThrow(/CLI exited 1.*fatal: bad thing/)
    })
  }
)

describe(`StdioBridge — claude-specific argv`, () => {
  it(`passes the prompt through stdin and adds claude flags`, async () => {
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
    expect(cmd).toContain(`--print`)
    expect(cmd).toContain(`--output-format=stream-json`)
    expect(cmd).toContain(`--verbose`)
    expect(cmd).toContain(`--dangerously-skip-permissions`)
    expect(cmd).toContain(`--model`)
    expect(cmd).toContain(`claude-haiku-4-5-20251001`)
    expect(stdin).toBe(`hello world`)
  })
})

describe(`StdioBridge — codex-specific argv`, () => {
  it(`puts the prompt on argv and passes codex exec flags`, async () => {
    let cmd: ReadonlyArray<string> = []
    let stdin = ``
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","session_id":"abc"}`,
        ],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
      }),
      kind: `codex`,
      prompt: `hello codex`,
      onEvent: () => undefined,
    })
    expect(cmd[0]).toBe(`codex`)
    expect(cmd).toContain(`exec`)
    expect(cmd).toContain(`--skip-git-repo-check`)
    expect(cmd).toContain(`--json`)
    expect(cmd[cmd.length - 1]).toBe(`hello codex`)
    expect(stdin).toBe(``)
  })

  it(`passes 'resume <id>' before the prompt when nativeSessionId set`, async () => {
    let cmd: ReadonlyArray<string> = []
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","session_id":"abc"}`,
        ],
        onCmd: (c) => (cmd = c),
      }),
      kind: `codex`,
      prompt: `keep going`,
      nativeSessionId: `prior-session-id`,
      onEvent: () => undefined,
    })
    const resumeIdx = cmd.indexOf(`resume`)
    expect(resumeIdx).toBeGreaterThan(0)
    expect(cmd[resumeIdx + 1]).toBe(`prior-session-id`)
    expect(cmd.indexOf(`keep going`)).toBeGreaterThan(resumeIdx)
  })
})
