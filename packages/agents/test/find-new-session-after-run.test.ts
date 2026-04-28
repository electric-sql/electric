import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findNewSessionAfterRun,
  getClaudeProjectDirs,
  listClaudeJsonlIdsByCwd,
} from '../src/agents/coding-session'

// Each test runs against a private fake $HOME so the real
// `~/.claude/projects/` is never touched. `homedir()` reads HOME, so
// stubbing it via vitest is enough to redirect every path-derivation
// helper inside coding-session.ts.
let fakeHome: string

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(tmpdir(), `coder-test-`))
  vi.stubEnv(`HOME`, fakeHome)
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

function projectsDirFor(cwd: string): string {
  return path.join(fakeHome, `.claude`, `projects`, cwd.replace(/\//g, `-`))
}

async function writeJsonl(
  cwd: string,
  sessionId: string,
  opts: { mtimeOffsetMs?: number } = {}
): Promise<void> {
  const dir = projectsDirFor(cwd)
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${sessionId}.jsonl`)
  await fsp.writeFile(file, ``)
  if (opts.mtimeOffsetMs !== undefined) {
    const t = new Date(Date.now() + opts.mtimeOffsetMs)
    await fsp.utimes(file, t, t)
  }
}

describe(`findNewSessionAfterRun (claude)`, () => {
  it(`returns null when the per-cwd projects directory doesn't exist`, async () => {
    const result = await findNewSessionAfterRun(
      `claude`,
      `/tmp/nope`,
      new Set(),
      new Set()
    )
    expect(result).toBeNull()
  })

  it(`returns the sessionId of the only new jsonl in the cwd dir`, async () => {
    const cwd = `/tmp/cwd-a`
    await writeJsonl(cwd, `aaa-111`)

    const result = await findNewSessionAfterRun(
      `claude`,
      cwd,
      new Set(),
      new Set()
    )
    expect(result).toBe(`aaa-111`)
  })

  it(`picks the newest by mtime when multiple new jsonls are present`, async () => {
    const cwd = `/tmp/cwd-b`
    await writeJsonl(cwd, `older`, { mtimeOffsetMs: -10_000 })
    await writeJsonl(cwd, `newest`, { mtimeOffsetMs: 0 })
    await writeJsonl(cwd, `middle`, { mtimeOffsetMs: -5_000 })

    const result = await findNewSessionAfterRun(
      `claude`,
      cwd,
      new Set(),
      new Set()
    )
    expect(result).toBe(`newest`)
  })

  it(`filters out sessionIds that were already present before the run`, async () => {
    const cwd = `/tmp/cwd-c`
    await writeJsonl(cwd, `pre-1`, { mtimeOffsetMs: 0 })
    await writeJsonl(cwd, `post-1`, { mtimeOffsetMs: -1_000 })

    const result = await findNewSessionAfterRun(
      `claude`,
      cwd,
      new Set([`pre-1`]),
      new Set()
    )
    expect(result).toBe(`post-1`)
  })

  it(`falls back to discoverNewestSession (returning null here, since no real ~/.claude/sessions lock files exist) when nothing is found in the deterministic dir`, async () => {
    const result = await findNewSessionAfterRun(
      `claude`,
      `/tmp/cwd-empty`,
      new Set(),
      new Set()
    )
    expect(result).toBeNull()
  })
})

describe(`getClaudeProjectDirs`, () => {
  it(`returns the sanitized-cwd directory under fake $HOME`, async () => {
    const dirs = await getClaudeProjectDirs(`/private/tmp/foo`)
    // realpath resolution may produce a second candidate when the path
    // exists on disk; in this test the path doesn't exist, so we get
    // exactly the raw-form candidate.
    expect(dirs[0]).toBe(
      path.join(fakeHome, `.claude`, `projects`, `-private-tmp-foo`)
    )
  })

  it(`also returns the realpath-resolved candidate when the cwd is a symlink`, async () => {
    // /tmp on macOS is a symlink to /private/tmp; we replicate that
    // shape inside the fake home so the test is portable.
    const target = path.join(fakeHome, `realdir`)
    const link = path.join(fakeHome, `linkdir`)
    fs.mkdirSync(target, { recursive: true })
    fs.symlinkSync(target, link)

    const dirs = await getClaudeProjectDirs(link)
    expect(dirs.length).toBe(2)
    expect(dirs[0]).toContain(link.replace(/\//g, `-`))
    expect(dirs[1]).toContain(target.replace(/\//g, `-`))
  })
})

describe(`listClaudeJsonlIdsByCwd`, () => {
  it(`unions ids across realpath and raw-form dirs and ignores non-jsonl files`, async () => {
    const cwd = `/tmp/cwd-list`
    await writeJsonl(cwd, `id-1`)
    await writeJsonl(cwd, `id-2`)
    // Drop a non-jsonl into the same dir to confirm it's ignored.
    await fsp.writeFile(path.join(projectsDirFor(cwd), `notes.txt`), `x`)

    const ids = await listClaudeJsonlIdsByCwd(cwd)
    expect(Array.from(ids).sort()).toEqual([`id-1`, `id-2`])
  })

  it(`returns an empty set when the cwd has no projects directory`, async () => {
    const ids = await listClaudeJsonlIdsByCwd(`/tmp/cwd-absent`)
    expect(ids.size).toBe(0)
  })
})

describe(`findNewSessionAfterRun (codex)`, () => {
  it(`falls through to discoverNewestSession (no codex sessions on the fake $HOME → null)`, async () => {
    const result = await findNewSessionAfterRun(
      `codex`,
      `/tmp/cwd-codex`,
      new Set(),
      new Set()
    )
    expect(result).toBeNull()
  })
})
