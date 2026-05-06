import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFileVault } from '../../src/vault/file-vault'

describe(`file-vault`, () => {
  let dir = ``
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), `vault-`))
  })

  it(`round-trips secrets`, async () => {
    const vault = createFileVault(join(dir, `vault.json`))
    await vault.set(`a/b`, `sekret`)
    expect(await vault.get(`a/b`)).toBe(`sekret`)
    await vault.delete(`a/b`)
    expect(await vault.get(`a/b`)).toBeNull()
  })

  it(`enforces 0600 permissions on write`, async () => {
    const path = join(dir, `vault.json`)
    const vault = createFileVault(path)
    await vault.set(`x`, `y`)
    const s = await stat(path)
    expect((s.mode & 0o777).toString(8)).toBe(`600`)
  })

  it(`lists by prefix`, async () => {
    const vault = createFileVault(join(dir, `vault.json`))
    await vault.set(`a/1`, `1`)
    await vault.set(`a/2`, `2`)
    await vault.set(`b/1`, `3`)
    const a = await vault.list(`a/`)
    expect(a.map((e) => e.ref).sort()).toEqual([`a/1`, `a/2`])
  })
})
