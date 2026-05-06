import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFileVault } from '../../src/vault/file-vault'
import { generateVaultKey } from '../../src/vault/keychain'

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

  it(`with a key, secrets are stored encrypted on disk`, async () => {
    const path = join(dir, `vault.json`)
    const key = generateVaultKey()
    const vault = createFileVault(path, { key })
    await vault.set(`a/b`, `sekret`)
    expect(await vault.get(`a/b`)).toBe(`sekret`)
    const raw = JSON.parse(await readFile(path, `utf8`)) as Record<
      string,
      { secret: string }
    >
    expect(raw[`a/b`].secret).not.toBe(`sekret`)
  })

  it(`with a keyPath, the key file is created with chmod 0600 and reused`, async () => {
    const path = join(dir, `vault.json`)
    const keyPath = join(dir, `.vault.key`)
    const vault = createFileVault(path, { keyPath })
    await vault.set(`a/b`, `sekret`)
    const ks = await stat(keyPath)
    expect((ks.mode & 0o777).toString(8)).toBe(`600`)

    // Reuse: a fresh vault using the same keyPath should decrypt prior data
    const vault2 = createFileVault(path, { keyPath })
    expect(await vault2.get(`a/b`)).toBe(`sekret`)

    // The key file content shouldn't have changed (same key reused)
    const keyBefore = await readFile(keyPath, `utf8`)
    await vault2.set(`a/c`, `another`)
    const keyAfter = await readFile(keyPath, `utf8`)
    expect(keyAfter).toBe(keyBefore)
  })
})
