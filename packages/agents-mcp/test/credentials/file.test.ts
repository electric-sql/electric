import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileCredentialStore } from '../../src/credentials/file'

describe(`fileCredentialStore`, () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), `mcp-cred-`))
    file = path.join(dir, `credentials.json`)
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it(`round-trips tokens and persists across reopens`, async () => {
    const s1 = fileCredentialStore(file)
    await s1.saveOAuthTokens?.(`a`, { accessToken: `at`, refreshToken: `rt` })
    const s2 = fileCredentialStore(file)
    expect((await s2.getOAuthTokens?.(`a`))?.accessToken).toBe(`at`)
  })

  it(`writes the file with mode 0600`, async () => {
    const s = fileCredentialStore(file)
    await s.saveOAuthTokens?.(`a`, { accessToken: `at` })
    const stat = await fs.stat(file)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it(`refuses to read a file with permissive mode`, async () => {
    await fs.writeFile(file, `{}`, { mode: 0o644 })
    const s = fileCredentialStore(file)
    await expect(s.getOAuthTokens?.(`a`)).rejects.toThrow(/permissions/i)
  })

  it(`round-trips client info`, async () => {
    const s = fileCredentialStore(file)
    await s.saveOAuthClientInfo?.(`a`, { clientId: `cid` })
    expect((await s.getOAuthClientInfo?.(`a`))?.clientId).toBe(`cid`)
  })

  it(`does not expose API keys (file store is for OAuth state by default)`, () => {
    const s = fileCredentialStore(file)
    expect(s.getApiKey).toBeUndefined()
  })
})
