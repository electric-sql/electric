import { createPublicKey, verify as verifySignature } from 'node:crypto'
import type { JsonWebKeyInput } from 'node:crypto'

export interface WebhookPublicJwk {
  kty: `OKP`
  crv: `Ed25519`
  x: string
  kid: string
  use?: `sig`
  alg?: `EdDSA`
}

export interface WebhookJwks {
  keys: Array<WebhookPublicJwk>
}

export interface WebhookSignatureVerifierConfig {
  jwksUrl: string
  toleranceSeconds?: number
  cacheTtlMs?: number
  fetchClient?: typeof fetch
}

export type WebhookSignatureVerificationResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

interface CachedJwks {
  jwks: WebhookJwks
  expiresAt: number
}

const DEFAULT_TOLERANCE_SECONDS = 300
const DEFAULT_CACHE_TTL_MS = 300_000
const encoder = new TextEncoder()
const jwksCache = new Map<string, CachedJwks>()

export async function verifyWebhookSignature(
  body: Uint8Array,
  signatureHeader: string | null,
  config: WebhookSignatureVerifierConfig
): Promise<WebhookSignatureVerificationResult> {
  if (!signatureHeader?.trim()) {
    return { ok: false, status: 401, error: `Missing webhook signature` }
  }

  const parsed = parseSignatureHeader(signatureHeader)
  if (!parsed) {
    return { ok: false, status: 401, error: `Invalid webhook signature` }
  }

  const toleranceSeconds = config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
    return { ok: false, status: 401, error: `Webhook signature expired` }
  }

  let jwks: WebhookJwks
  try {
    jwks = await fetchWebhookJwks(config)
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: err instanceof Error ? err.message : `JWKS fetch failed`,
    }
  }

  const jwk = jwks.keys.find((key) => key.kid === parsed.kid)
  if (!jwk) {
    return { ok: false, status: 401, error: `Unknown webhook signing key` }
  }

  try {
    const publicKey = createPublicKey({
      key: jwk,
      format: `jwk`,
    } as unknown as JsonWebKeyInput)
    const ok = verifySignature(
      null,
      bytesWithTimestamp(parsed.timestampText, body),
      publicKey,
      Buffer.from(parsed.signature, `base64url`)
    )
    return ok
      ? { ok: true }
      : { ok: false, status: 401, error: `Invalid webhook signature` }
  } catch {
    return { ok: false, status: 401, error: `Invalid webhook signature` }
  }
}

function parseSignatureHeader(header: string): {
  timestamp: number
  timestampText: string
  kid: string
  signature: string
} | null {
  const values = new Map<string, string>()
  for (const part of header.split(`,`)) {
    const index = part.indexOf(`=`)
    if (index <= 0) return null
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (!key || !value) return null
    values.set(key, value)
  }

  const timestampText = values.get(`t`)
  const kid = values.get(`kid`)
  const signature = values.get(`ed25519`)
  if (!timestampText || !kid || !signature) return null
  if (!/^\d+$/.test(timestampText)) return null
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return null

  return {
    timestamp: Number.parseInt(timestampText, 10),
    timestampText,
    kid,
    signature,
  }
}

async function fetchWebhookJwks(
  config: WebhookSignatureVerifierConfig
): Promise<WebhookJwks> {
  const now = Date.now()
  const cached = jwksCache.get(config.jwksUrl)
  if (cached && cached.expiresAt > now) return cached.jwks

  const fetchClient = config.fetchClient ?? fetch
  const response = await fetchClient(config.jwksUrl, {
    headers: { accept: `application/jwk-set+json, application/json` },
  })
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: ${response.status}`)
  }

  const jwks = (await response.json()) as WebhookJwks
  if (
    !jwks ||
    typeof jwks !== `object` ||
    !Array.isArray(jwks.keys) ||
    jwks.keys.some((key) => !isWebhookPublicJwk(key))
  ) {
    throw new Error(`JWKS response did not contain Ed25519 keys`)
  }

  jwksCache.set(config.jwksUrl, {
    jwks,
    expiresAt: now + cacheTtlMs(response, config.cacheTtlMs),
  })
  return jwks
}

function cacheTtlMs(response: Response, configured?: number): number {
  if (configured !== undefined) return configured
  const cacheControl = response.headers.get(`cache-control`) ?? ``
  const maxAge = cacheControl.match(/(?:^|,\s*)max-age=(\d+)(?:\s*,|$)/i)
  if (!maxAge) return DEFAULT_CACHE_TTL_MS
  return Number.parseInt(maxAge[1]!, 10) * 1000
}

function isWebhookPublicJwk(value: unknown): value is WebhookPublicJwk {
  if (!value || typeof value !== `object` || Array.isArray(value)) {
    return false
  }
  const jwk = value as Partial<WebhookPublicJwk>
  return (
    jwk.kty === `OKP` &&
    jwk.crv === `Ed25519` &&
    typeof jwk.x === `string` &&
    typeof jwk.kid === `string` &&
    (jwk.use === undefined || jwk.use === `sig`) &&
    (jwk.alg === undefined || jwk.alg === `EdDSA`)
  )
}

function bytesWithTimestamp(timestamp: string, body: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from(encoder.encode(`${timestamp}.`)),
    Buffer.from(body),
  ])
}
