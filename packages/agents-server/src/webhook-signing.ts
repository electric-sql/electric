import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { appendPathToUrl } from '@electric-ax/agents-runtime'
import type { JsonWebKey as NodeJsonWebKey, KeyObject } from 'node:crypto'

export interface WebhookPublicJwk {
  kty: `OKP`
  crv: `Ed25519`
  x: string
  kid: string
  use: `sig`
  alg: `EdDSA`
}

export interface WebhookJwks {
  keys: Array<WebhookPublicJwk>
}

export interface WebhookSigningMetadata {
  alg: `ed25519`
  kid: string
  jwks_url: string
}

export interface WebhookSigner {
  sign: (body: Uint8Array | string) => string | Promise<string>
  jwks: () => WebhookJwks | Promise<WebhookJwks>
}

export type WebhookSigningKeyInput =
  | string
  | Buffer
  | NodeJsonWebKey
  | KeyObject

export interface Ed25519WebhookSignerOptions {
  privateKey?: WebhookSigningKeyInput
  kid?: string
}

const encoder = new TextEncoder()
const defaultWebhookSigner = createEd25519WebhookSigner()

export function createEd25519WebhookSigner(
  options: Ed25519WebhookSignerOptions = {}
): WebhookSigner {
  const privateKey = options.privateKey
    ? importPrivateKey(options.privateKey)
    : generateKeyPairSync(`ed25519`).privateKey

  if (privateKey.asymmetricKeyType !== `ed25519`) {
    throw new Error(`Webhook signing key must be an Ed25519 private key`)
  }

  const publicJwk = buildPublicJwk(privateKey, options.kid)

  return {
    sign: (body) => signWebhookBody(privateKey, publicJwk.kid, body),
    jwks: () => ({ keys: [{ ...publicJwk }] }),
  }
}

export function getDefaultWebhookSigner(): WebhookSigner {
  return defaultWebhookSigner
}

export async function webhookSigningMetadata(
  signer: WebhookSigner,
  streamRootUrl: string
): Promise<WebhookSigningMetadata> {
  const jwks = await signer.jwks()
  const key = jwks.keys[0]
  if (!key) {
    throw new Error(`Webhook signer did not provide any public keys`)
  }

  return {
    alg: `ed25519`,
    kid: key.kid,
    jwks_url: appendPathToUrl(streamRootUrl, `/__ds/jwks.json`),
  }
}

export function signWebhookBody(
  privateKey: KeyObject,
  kid: string,
  body: Uint8Array | string
): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = bytesWithTimestamp(timestamp, body)
  const signature = sign(null, payload, privateKey).toString(`base64url`)
  return `t=${timestamp},kid=${kid},ed25519=${signature}`
}

export function bytesWithTimestamp(
  timestamp: number | string,
  body: Uint8Array | string
): Buffer {
  const prefix = encoder.encode(`${timestamp}.`)
  const bodyBytes = typeof body === `string` ? encoder.encode(body) : body
  return Buffer.concat([Buffer.from(prefix), Buffer.from(bodyBytes)])
}

function importPrivateKey(input: WebhookSigningKeyInput): KeyObject {
  if (isKeyObject(input)) return input

  if (typeof input === `string`) {
    const trimmed = input.trim()
    if (trimmed.startsWith(`{`)) {
      return createPrivateKey({
        key: JSON.parse(trimmed) as NodeJsonWebKey,
        format: `jwk`,
      })
    }
    return createPrivateKey(trimmed.replace(/\\n/g, `\n`))
  }

  if (Buffer.isBuffer(input)) {
    return createPrivateKey(input)
  }

  return createPrivateKey({ key: input, format: `jwk` })
}

function isKeyObject(input: WebhookSigningKeyInput): input is KeyObject {
  return (
    typeof input === `object` && `type` in input && input.type === `private`
  )
}

function buildPublicJwk(
  privateKey: KeyObject,
  kid: string | undefined
): WebhookPublicJwk {
  const exported = createPublicKey(privateKey).export({ format: `jwk` }) as {
    kty?: string
    crv?: string
    x?: string
  }

  if (exported.kty !== `OKP` || exported.crv !== `Ed25519` || !exported.x) {
    throw new Error(`Failed to export Ed25519 webhook signing key`)
  }

  return {
    kty: `OKP`,
    crv: `Ed25519`,
    x: exported.x,
    kid:
      kid ??
      deriveKeyId({
        kty: exported.kty,
        crv: exported.crv,
        x: exported.x,
      }),
    use: `sig`,
    alg: `EdDSA`,
  }
}

function deriveKeyId(jwk: { kty: string; crv: string; x: string }): string {
  const thumbprintInput = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
  })
  return `ds_${createHash(`sha256`).update(thumbprintInput).digest(`base64url`)}`
}
