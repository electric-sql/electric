import { describe, expect, it } from 'vitest'
import {
  encryptWithKey,
  decryptWithKey,
  generateVaultKey,
} from '../../src/vault/keychain'

describe(`vault encryption`, () => {
  it(`round-trips through AES-256-GCM`, () => {
    const key = generateVaultKey()
    const ct = encryptWithKey(`hello`, key)
    expect(decryptWithKey(ct, key)).toBe(`hello`)
  })
  it(`rejects tampered ciphertext`, () => {
    const key = generateVaultKey()
    const ct = encryptWithKey(`hello`, key)
    const tampered = ct.slice(0, -2) + `aa`
    expect(() => decryptWithKey(tampered, key)).toThrow()
  })
})
