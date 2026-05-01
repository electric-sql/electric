import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runImportCli } from '../../src/cli/import-claude'

describe(`runImportCli`, () => {
  it(`builds the correct PUT body and URL`, async () => {
    const home = await mkdtemp(join(tmpdir(), `cli-home-`))
    const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
    const sanitised = (await realpath(ws)).replace(/\//g, `-`)
    const projectDir = join(home, `.claude`, `projects`, sanitised)
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, `s1.jsonl`), `{"k":"v"}\n`)

    const fetchMock = vi.fn(async (_url: string, _init: any) => {
      return new Response(JSON.stringify({ url: `/test/coding-agent/imp-1` }), {
        status: 200,
      })
    })

    try {
      const result = await runImportCli({
        argv: [
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
      argv: [`--workspace`, `/tmp`, `--session-id`, `../etc/passwd`],
      fetchFn: fetchMock as any,
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/alphanumeric/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`fails fast when the JSONL file is missing on disk`, async () => {
    const home = await mkdtemp(join(tmpdir(), `cli-home-`))
    const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
    const fetchMock = vi.fn()
    try {
      const result = await runImportCli({
        argv: [`--workspace`, ws, `--session-id`, `nope`],
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
})
