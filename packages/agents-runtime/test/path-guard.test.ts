import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveInsideWorkdir } from '../src/tools/path-guard'

describe(`resolveInsideWorkdir`, () => {
  let cwd: string
  let outside: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `path-guard-`))
    outside = await mkdtemp(join(tmpdir(), `path-guard-outside-`))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it(`returns the resolved absolute path for an in-bounds relative path`, async () => {
    await writeFile(join(cwd, `file.txt`), `hello`)
    const result = await resolveInsideWorkdir(`file.txt`, cwd)
    expect(result).toEqual({ ok: true, resolved: join(cwd, `file.txt`) })
  })

  it(`accepts an in-bounds path that does not yet exist`, async () => {
    const result = await resolveInsideWorkdir(`fresh/dir/file.txt`, cwd)
    expect(result).toEqual({
      ok: true,
      resolved: join(cwd, `fresh/dir/file.txt`),
    })
  })

  it(`rejects ".." escape via the prefix check`, async () => {
    const result = await resolveInsideWorkdir(`../escape.txt`, cwd)
    expect(result).toEqual({
      ok: false,
      reason: `Path "../escape.txt" is outside the working directory`,
    })
  })

  it(`rejects an absolute path outside the working directory`, async () => {
    const result = await resolveInsideWorkdir(`/etc/hostname`, cwd)
    expect(result).toEqual({
      ok: false,
      reason: `Path "/etc/hostname" is outside the working directory`,
    })
  })

  it(`rejects a symlink that resolves outside the working directory`, async () => {
    const secret = join(outside, `secret.txt`)
    await writeFile(secret, `secret`)
    await symlink(secret, join(cwd, `link.txt`))
    const result = await resolveInsideWorkdir(`link.txt`, cwd)
    expect(result).toEqual({
      ok: false,
      reason: `Path "link.txt" resolves outside the working directory via a symlink`,
    })
  })

  it(`rejects a write target whose parent is a symlinked-out directory`, async () => {
    await symlink(outside, join(cwd, `escape-dir`))
    const result = await resolveInsideWorkdir(`escape-dir/new.txt`, cwd)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/resolves outside the working directory/)
    }
  })

  it(`treats a regular-file ancestor like a missing ancestor (ENOTDIR walks up)`, async () => {
    await writeFile(join(cwd, `not-a-dir`), `content`)
    const result = await resolveInsideWorkdir(`not-a-dir/sub/new.txt`, cwd)
    expect(result).toEqual({
      ok: true,
      resolved: join(cwd, `not-a-dir/sub/new.txt`),
    })
  })

  it(`accepts a symlink that stays inside the working directory`, async () => {
    const inner = join(cwd, `inner.txt`)
    await writeFile(inner, `inner`)
    await symlink(inner, join(cwd, `link.txt`))
    const result = await resolveInsideWorkdir(`link.txt`, cwd)
    expect(result).toEqual({ ok: true, resolved: join(cwd, `link.txt`) })
  })

  it(`accepts writing through a directory symlink that points inside cwd`, async () => {
    await mkdir(join(cwd, `data`))
    await symlink(join(cwd, `data`), join(cwd, `data-link`))
    const result = await resolveInsideWorkdir(`data-link/new.txt`, cwd)
    expect(result).toEqual({
      ok: true,
      resolved: join(cwd, `data-link/new.txt`),
    })
  })

  it(`handles a working directory that is itself a symlink`, async () => {
    const realDir = await mkdtemp(join(tmpdir(), `path-guard-real-`))
    const linkDir = join(tmpdir(), `path-guard-link-${Date.now()}`)
    await symlink(realDir, linkDir)
    try {
      await writeFile(join(realDir, `file.txt`), `data`)
      const result = await resolveInsideWorkdir(`file.txt`, linkDir)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(realpathSync(result.resolved)).toBe(
          realpathSync(join(realDir, `file.txt`))
        )
      }
    } finally {
      await rm(linkDir, { force: true })
      await rm(realDir, { recursive: true, force: true })
    }
  })
})
