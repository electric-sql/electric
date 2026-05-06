import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export function generateVaultKey(): Buffer {
  return randomBytes(32)
}

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(`aes-256-gcm`, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, `utf8`), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString(`base64`)
}

export function decryptWithKey(b64: string, key: Buffer): string {
  const buf = Buffer.from(b64, `base64`)
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv(`aes-256-gcm`, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(`utf8`)
}
