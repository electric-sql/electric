import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '../../src' // ensures built-in adapters are registered
import { runImportCli } from '../../src/cli/import'
import { listAdapters } from '../../src'

describe.each(listAdapters().map((a) => [a.kind] as const))(
  `runImportCli — %s`,
  (kind) => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it(`builds the correct PUT body and URL`, async () => {
      const home = await mkdtemp(join(tmpdir(), `cli-home-`))
      const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
      let sessionPath: string
      if (kind === `claude`) {
        const sanitised = (await realpath(ws)).replace(/\//g, `-`)
        const projectDir = join(home, `.claude`, `projects`, sanitised)
        await mkdir(projectDir, { recursive: true })
        sessionPath = join(projectDir, `s1.jsonl`)
        await writeFile(sessionPath, `{"k":"v"}\n`)
      } else {
        const day = join(home, `.codex`, `sessions`, `2026`, `05`, `01`)
        await mkdir(day, { recursive: true })
        sessionPath = join(day, `rollout-2026-05-01T12-00-00-s1.jsonl`)
        await writeFile(
          sessionPath,
          `{"timestamp":"2026-05-01T12:00:00Z","session_id":"s1"}\n`
        )
      }

      const fetchMock = vi.fn(
        async (_url: string, _init: any) => new Response(`{}`, { status: 200 })
      )

      try {
        // codex's findSessionPath uses os.homedir() — override $HOME for the test.
        vi.stubEnv(`HOME`, home)
        const result = await runImportCli({
          argv: [
            `--agent`,
            kind,
            `--workspace`,
            ws,
            `--session-id`,
            `s1`,
            `--server`,
            `http://localhost:9999`,
            `--agent-id`,
            `imp-1`,
          ],
          homeDir: home,
          fetchFn: fetchMock as any,
        })
        expect(result.exitCode).toBe(0)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]!
        expect(url).toMatch(/\/coding-agent\/imp-1$/)
        expect(init.method).toBe(`PUT`)
        const body = JSON.parse(init.body)
        expect(body.kind).toBe(kind)
        expect(body.target).toBe(`host`)
        expect(body.workspaceType).toBe(`bindMount`)
        expect(body.workspaceHostPath).toBe(ws)
        expect(body.importNativeSessionId).toBe(`s1`)
      } finally {
        await rm(home, { recursive: true, force: true })
        await rm(ws, { recursive: true, force: true })
      }
    })

    it(`rejects --session-id with path traversal characters`, async () => {
      const fetchMock = vi.fn()
      const result = await runImportCli({
        argv: [
          `--agent`,
          kind,
          `--workspace`,
          `/tmp`,
          `--session-id`,
          `../etc/passwd`,
        ],
        fetchFn: fetchMock as any,
      })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/alphanumeric/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it(`fails fast when the session file is missing on disk`, async () => {
      const home = await mkdtemp(join(tmpdir(), `cli-home-`))
      const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
      const fetchMock = vi.fn()
      try {
        vi.stubEnv(`HOME`, home)
        const result = await runImportCli({
          argv: [`--agent`, kind, `--workspace`, ws, `--session-id`, `nope`],
          homeDir: home,
          fetchFn: fetchMock as any,
        })
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toMatch(/not found/)
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        await rm(home, { recursive: true, force: true })
        await rm(ws, { recursive: true, force: true })
      }
    })
  }
)

describe(`runImportCli — defaults and validation`, () => {
  it(`defaults to --agent claude when omitted`, async () => {
    const home = await mkdtemp(join(tmpdir(), `cli-home-`))
    const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
    try {
      const sanitised = (await realpath(ws)).replace(/\//g, `-`)
      await mkdir(join(home, `.claude`, `projects`, sanitised), {
        recursive: true,
      })
      await writeFile(
        join(home, `.claude`, `projects`, sanitised, `s1.jsonl`),
        `{}\n`
      )
      const fetchMock = vi.fn(
        async (_url: string, _init: any) => new Response(`{}`, { status: 200 })
      )
      const result = await runImportCli({
        argv: [
          `--workspace`,
          ws,
          `--session-id`,
          `s1`,
          `--server`,
          `http://localhost:9999`,
        ],
        homeDir: home,
        fetchFn: fetchMock as any,
      })
      expect(result.exitCode).toBe(0)
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
      expect(body.kind).toBe(`claude`)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(ws, { recursive: true, force: true })
    }
  })

  it(`rejects unknown --agent values`, async () => {
    const fetchMock = vi.fn()
    const result = await runImportCli({
      argv: [`--agent`, `gemini`, `--workspace`, `/tmp`, `--session-id`, `s1`],
      fetchFn: fetchMock as any,
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/must be 'claude' or 'codex'/)
  })
})
