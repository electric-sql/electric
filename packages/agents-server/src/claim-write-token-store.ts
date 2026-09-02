import { randomUUID } from 'node:crypto'

interface ActiveClaimWriteToken {
  token: string
  /**
   * The token this consumer's previous mint for the same stream issued.
   * Kept valid so an append already in flight with the pre-refresh token
   * is not rejected when a heartbeat re-mints. A different consumer's mint
   * evicts the claim outright, previous token included.
   */
  previousToken?: string
  consumerId: string
  expiresAt: number
}

interface DeliveredWriteToken {
  token: string
  expiresAt: number
}

/**
 * The Durable Streams default claim lease (PROTOCOL §7): a webhook wake
 * carries no `lease_ttl_ms`, so this is what a claim confirmed through the
 * wake callback is recorded with, and what a claim's write token is kept
 * alive for.
 */
export const DEFAULT_CLAIM_LEASE_MS = 30_000

/**
 * The grace a backend keeps a write token valid past the lease it was minted
 * for.
 */
const WRITE_TOKEN_FENCE_GRACE_MS = 5_000

/**
 * How long an entry stays valid without a mint or renewal. A heartbeat renews
 * the entry, so only a claim that stopped heartbeating — or one whose
 * heartbeats and done all reached other server instances — ages out.
 */
const DEFAULT_TTL_MS = DEFAULT_CLAIM_LEASE_MS + WRITE_TOKEN_FENCE_GRACE_MS

export interface ClaimWriteTokenStoreOptions {
  ttlMs?: number
  now?: () => number
}

export class ClaimWriteTokenStore {
  private readonly claimsByStream = new Map<string, ActiveClaimWriteToken>()
  private readonly streamKeysByConsumer = new Map<string, Set<string>>()
  private readonly deliveredTokensByConsumer = new Map<
    string,
    DeliveredWriteToken
  >()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: ClaimWriteTokenStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
  }

  mint(
    service: string,
    streamPath: string,
    consumerId: string,
    token: string = randomUUID()
  ): string {
    this.sweep()
    const streamKey = this.streamKey(service, streamPath)
    const consumerKey = this.consumerKey(service, consumerId)
    const previousClaimForStream = this.claimsByStream.get(streamKey)
    if (previousClaimForStream) {
      this.removeConsumerStream(
        this.consumerKey(service, previousClaimForStream.consumerId),
        streamKey
      )
    }

    this.claimsByStream.set(streamKey, {
      token,
      consumerId,
      expiresAt: this.now() + this.ttlMs,
      ...(previousClaimForStream?.consumerId === consumerId
        ? { previousToken: previousClaimForStream.token }
        : {}),
    })
    this.addConsumerStream(consumerKey, streamKey)
    return token
  }

  /**
   * Extends the expiry of every entry a consumer holds. Called on a
   * heartbeat the backend answered without re-minting, so an entry this
   * process is the sole authority for (no Write Fencing extension) lives as
   * long as the claim does.
   */
  renew(service: string, consumerId: string): void {
    const consumerKey = this.consumerKey(service, consumerId)
    const expiresAt = this.now() + this.ttlMs
    const delivered = this.deliveredTokensByConsumer.get(consumerKey)
    if (delivered) delivered.expiresAt = expiresAt
    for (const streamKey of this.streamKeysByConsumer.get(consumerKey) ?? []) {
      const claim = this.claimsByStream.get(streamKey)
      if (claim) claim.expiresAt = expiresAt
    }
  }

  /**
   * Remembers a write token the Durable Streams backend issued with a wake
   * delivery (webhook notification or pull-wake claim), keyed by the wake's
   * consumer id, until that consumer's claim callback mints it as the active
   * claim write token.
   */
  recordDelivered(service: string, consumerId: string, token: string): void {
    this.sweep()
    this.deliveredTokensByConsumer.set(this.consumerKey(service, consumerId), {
      token,
      expiresAt: this.now() + this.ttlMs,
    })
  }

  takeDelivered(service: string, consumerId: string): string | undefined {
    const consumerKey = this.consumerKey(service, consumerId)
    const delivered = this.deliveredTokensByConsumer.get(consumerKey)
    if (delivered === undefined) return undefined
    this.deliveredTokensByConsumer.delete(consumerKey)
    return delivered.expiresAt > this.now() ? delivered.token : undefined
  }

  isValid(service: string, streamPath: string, token: string): boolean {
    const activeClaim = this.liveClaim(this.streamKey(service, streamPath))
    return (
      activeClaim !== undefined &&
      (activeClaim.token === token || activeClaim.previousToken === token)
    )
  }

  owns(service: string, streamPath: string, consumerId: string): boolean {
    return (
      this.liveClaim(this.streamKey(service, streamPath))?.consumerId ===
      consumerId
    )
  }

  clearStream(service: string, streamPath: string): void {
    const streamKey = this.streamKey(service, streamPath)
    const activeClaim = this.claimsByStream.get(streamKey)
    if (!activeClaim) return

    this.claimsByStream.delete(streamKey)
    this.removeConsumerStream(
      this.consumerKey(service, activeClaim.consumerId),
      streamKey
    )
  }

  clearConsumer(service: string, consumerId: string): void {
    const consumerKey = this.consumerKey(service, consumerId)
    this.deliveredTokensByConsumer.delete(consumerKey)
    const streamKeys = this.streamKeysByConsumer.get(consumerKey)
    if (!streamKeys) return

    this.streamKeysByConsumer.delete(consumerKey)
    for (const streamKey of streamKeys) {
      this.claimsByStream.delete(streamKey)
    }
  }

  private liveClaim(streamKey: string): ActiveClaimWriteToken | undefined {
    const claim = this.claimsByStream.get(streamKey)
    return claim !== undefined && claim.expiresAt > this.now()
      ? claim
      : undefined
  }

  /**
   * Drops expired entries. Lazy — run from the paths that add entries — so a
   * server instance that saw a wake's delivery or claim but none of its
   * later callbacks does not accumulate them forever.
   */
  private sweep(): void {
    const now = this.now()
    for (const [consumerKey, streamKeys] of this.streamKeysByConsumer) {
      for (const streamKey of streamKeys) {
        const claim = this.claimsByStream.get(streamKey)
        if (claim !== undefined && claim.expiresAt > now) continue
        this.claimsByStream.delete(streamKey)
        this.removeConsumerStream(consumerKey, streamKey)
      }
    }
    for (const [consumerKey, delivered] of this.deliveredTokensByConsumer) {
      if (delivered.expiresAt <= now) {
        this.deliveredTokensByConsumer.delete(consumerKey)
      }
    }
  }

  private addConsumerStream(consumerKey: string, streamKey: string): void {
    let streamKeys = this.streamKeysByConsumer.get(consumerKey)
    if (!streamKeys) {
      streamKeys = new Set()
      this.streamKeysByConsumer.set(consumerKey, streamKeys)
    }
    streamKeys.add(streamKey)
  }

  private removeConsumerStream(consumerKey: string, streamKey: string): void {
    const streamKeys = this.streamKeysByConsumer.get(consumerKey)
    if (!streamKeys) return

    streamKeys.delete(streamKey)
    if (streamKeys.size === 0) {
      this.streamKeysByConsumer.delete(consumerKey)
    }
  }

  private streamKey(service: string, streamPath: string): string {
    return `${service}\0${streamPath}`
  }

  private consumerKey(service: string, consumerId: string): string {
    return `${service}\0${consumerId}`
  }
}
