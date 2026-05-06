import { describe, expect, it } from 'vitest'
import { composedCredentialStore } from '../../src/credentials/composed'
import { envCredentialStore } from '../../src/credentials/env'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'

describe(`composedCredentialStore`, () => {
  it(`reads from the first store with a non-undefined value`, async () => {
    const env = envCredentialStore({
      MCP_X_API_KEY: `env-val`,
    } as NodeJS.ProcessEnv)
    const mem = inMemoryCredentialStore()
    mem.setApiKey(`x`, `mem-val`)
    const composed = composedCredentialStore(env, mem)
    expect(await composed.getApiKey?.(`x`)).toBe(`env-val`)
  })
  it(`falls through when the first store returns undefined`, async () => {
    const env = envCredentialStore({} as NodeJS.ProcessEnv)
    const mem = inMemoryCredentialStore()
    mem.setApiKey(`x`, `mem-val`)
    const composed = composedCredentialStore(env, mem)
    expect(await composed.getApiKey?.(`x`)).toBe(`mem-val`)
  })
  it(`writes to the first store that implements the relevant save method`, async () => {
    const env = envCredentialStore() // read-only — no saveOAuthTokens
    const mem = inMemoryCredentialStore()
    const composed = composedCredentialStore(env, mem)
    await composed.saveOAuthTokens?.(`x`, { accessToken: `at` })
    expect((await mem.getOAuthTokens?.(`x`))?.accessToken).toBe(`at`)
  })
  it(`throws a clear error when no child can persist`, async () => {
    const env = envCredentialStore()
    const composed = composedCredentialStore(env)
    await expect(
      composed.saveOAuthTokens?.(`x`, { accessToken: `at` })
    ).rejects.toThrow(/no writable store/i)
  })
})
