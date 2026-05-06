import { randomBytes, createHash } from 'node:crypto'

function base64Url(b: Buffer): string {
  return b
    .toString(`base64`)
    .replace(/=+$/, ``)
    .replace(/\+/g, `-`)
    .replace(/\//g, `_`)
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64)).slice(0, 64)
  return { verifier, challenge: codeChallengeS256(verifier) }
}

export function codeChallengeS256(verifier: string): string {
  return base64Url(createHash(`sha256`).update(verifier).digest())
}
