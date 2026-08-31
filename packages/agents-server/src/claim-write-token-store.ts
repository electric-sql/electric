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
}

export class ClaimWriteTokenStore {
  private readonly claimsByStream = new Map<string, ActiveClaimWriteToken>()
  private readonly streamKeysByConsumer = new Map<string, Set<string>>()
  private readonly deliveredTokensByConsumer = new Map<string, string>()

  mint(
    service: string,
    streamPath: string,
    consumerId: string,
    token: string = randomUUID()
  ): string {
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
      ...(previousClaimForStream?.consumerId === consumerId
        ? { previousToken: previousClaimForStream.token }
        : {}),
    })
    this.addConsumerStream(consumerKey, streamKey)
    return token
  }

  /**
   * Remembers a write token the Durable Streams backend issued with a wake
   * delivery (webhook notification or pull-wake claim), keyed by the wake's
   * consumer id, until that consumer's claim callback mints it as the active
   * claim write token.
   */
  recordDelivered(service: string, consumerId: string, token: string): void {
    this.deliveredTokensByConsumer.set(
      this.consumerKey(service, consumerId),
      token
    )
  }

  takeDelivered(service: string, consumerId: string): string | undefined {
    const consumerKey = this.consumerKey(service, consumerId)
    const token = this.deliveredTokensByConsumer.get(consumerKey)
    if (token !== undefined) {
      this.deliveredTokensByConsumer.delete(consumerKey)
    }
    return token
  }

  isValid(service: string, streamPath: string, token: string): boolean {
    const activeClaim = this.claimsByStream.get(
      this.streamKey(service, streamPath)
    )
    return (
      activeClaim !== undefined &&
      (activeClaim.token === token || activeClaim.previousToken === token)
    )
  }

  owns(service: string, streamPath: string, consumerId: string): boolean {
    return (
      this.claimsByStream.get(this.streamKey(service, streamPath))
        ?.consumerId === consumerId
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
