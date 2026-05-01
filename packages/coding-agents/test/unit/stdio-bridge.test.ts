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
  onExecReq?: (req: ExecRequest) => void
}): SandboxInstance {
  return {
    instanceId: `fake`,
    agentId: `/x/coding-agent/y`,
    workspaceMount: `/workspace`,
    homeDir: `/home/agent`,
    async exec(req: ExecRequest): Promise<ExecHandle> {
      opts.onCmd?.(req.cmd)
      opts.onExecReq?.(req)
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
          : `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","payload":{"id":"abc","cwd":"/workspace"}}`
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
    let execReq: ExecRequest | null = null
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [`{"type":"system","subtype":"init","session_id":"abc"}`],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
        onExecReq: (r) => (execReq = r),
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
    expect(execReq).not.toBeNull()
    expect(execReq!.stdin).toBe(`pipe`)
  })
})

describe(`StdioBridge — codex-specific argv`, () => {
  it(`puts the prompt on argv and passes codex exec flags`, async () => {
    let cmd: ReadonlyArray<string> = []
    let stdin = ``
    let execReq: ExecRequest | null = null
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","payload":{"id":"abc","cwd":"/workspace"}}`,
        ],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
        onExecReq: (r) => (execReq = r),
      }),
      kind: `codex`,
      prompt: `hello codex`,
      onEvent: () => undefined,
    })
    // Codex is invoked via `sh -c '<bootstrap script>' -- <codex argv>` so
    // that codex login --with-api-key runs first inside the sandbox.
    expect(cmd[0]).toBe(`sh`)
    expect(cmd[1]).toBe(`-c`)
    expect(cmd[2]).toContain(`codex login --with-api-key`)
    expect(cmd[2]).toContain(`exec codex "$@"`)
    expect(cmd[3]).toBe(`--`) // $0 placeholder
    expect(cmd).toContain(`exec`)
    expect(cmd).toContain(`--skip-git-repo-check`)
    expect(cmd).toContain(`--json`)
    expect(cmd[cmd.length - 1]).toBe(`hello codex`)
    expect(stdin).toBe(``)
    expect(execReq).not.toBeNull()
    expect(execReq!.stdin).toBe(`ignore`)
  })

  it(`passes 'resume <id>' before the prompt when nativeSessionId set`, async () => {
    let cmd: ReadonlyArray<string> = []
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","payload":{"id":"abc","cwd":"/workspace"}}`,
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

  it(`passes -c model="..." when model is supplied`, async () => {
    let cmd: ReadonlyArray<string> = []
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-02T12:00:00Z","payload":{"id":"abc","cwd":"/workspace"}}`,
        ],
        onCmd: (c) => (cmd = c),
      }),
      kind: `codex`,
      prompt: `hi`,
      model: `gpt-5-codex-mini`,
      onEvent: () => undefined,
    })
    // -c model="gpt-5-codex-mini" must appear before the `exec` subcommand
    // so codex's clap picks it up as a global config override. Slice past
    // the `sh -c '<bootstrap>' --` wrapper so we only inspect codex argv.
    const codexArgv = cmd.slice(cmd.indexOf(`--`) + 1)
    const cIdx = codexArgv.indexOf(`-c`)
    expect(cIdx).toBeGreaterThanOrEqual(0)
    expect(codexArgv[cIdx + 1]).toBe(`model="gpt-5-codex-mini"`)
    expect(codexArgv.indexOf(`exec`)).toBeGreaterThan(cIdx)
  })

  it(`omits -c model when model is undefined`, async () => {
    let cmd: ReadonlyArray<string> = []
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-02T12:00:00Z","payload":{"id":"abc","cwd":"/workspace"}}`,
        ],
        onCmd: (c) => (cmd = c),
      }),
      kind: `codex`,
      prompt: `hi`,
      onEvent: () => undefined,
    })
    // Slice past the `sh -c '<bootstrap>' --` wrapper; codex argv must
    // not carry a `-c` flag when no model is requested.
    const codexArgv = cmd.slice(cmd.indexOf(`--`) + 1)
    expect(codexArgv).not.toContain(`-c`)
  })
})
