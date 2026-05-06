import { describe, expect, it } from 'vitest'
import { createApiKeyAuth } from '../../src/auth/api-key'
import type { KeyVault } from '../../src/vault/types'

const vault = {
  get: async (r: string) => (r === `vault://x/key` ? `TOKEN` : null),
} as Pick<KeyVault, `get`> as KeyVault

describe(`apiKey auth`, () => {
  it(`reads from vault`, async () => {
    const auth = createApiKeyAuth(
      { mode: `apiKey`, headerName: `X-Token`, valueRef: `vault://x/key` },
      vault
    )
    expect(await auth.getToken()).toBe(`TOKEN`)
    expect(auth.headerName).toBe(`X-Token`)
  })

  it(`null when missing`, async () => {
    const auth = createApiKeyAuth(
      { mode: `apiKey`, headerName: `X-Token`, valueRef: `vault://missing` },
      vault
    )
    expect(await auth.getToken()).toBeNull()
  })
})
