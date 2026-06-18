import { randomUUID } from 'node:crypto'

interface ActiveClaimWriteToken {
  token: string
  consumerId: string
}

export class ClaimWriteTokenStore {
  private readonly claimsByStream = new Map<string, ActiveClaimWriteToken>()
  private readonly streamKeysByConsumer = new Map<string, Set<string>>()

  mint(service: string, streamPath: string, consumerId: string): string {
    const streamKey = this.streamKey(service, streamPath)
    const consumerKey = this.consumerKey(service, consumerId)
    const previousClaimForStream = this.claimsByStream.get(streamKey)
    if (previousClaimForStream) {
      this.removeConsumerStream(
        this.consumerKey(service, previousClaimForStream.consumerId),
        streamKey
      )
    }

    const token = randomUUID()
    this.claimsByStream.set(streamKey, { token, consumerId })
    this.addConsumerStream(consumerKey, streamKey)
    return token
  }

  isValid(service: string, streamPath: string, token: string): boolean {
    return (
      this.claimsByStream.get(this.streamKey(service, streamPath))?.token ===
      token
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
