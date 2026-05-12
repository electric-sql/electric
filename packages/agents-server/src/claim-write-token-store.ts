import { randomUUID } from 'node:crypto'

interface ActiveClaimWriteToken {
  token: string
  consumerId: string
}

export class ClaimWriteTokenStore {
  private readonly claimsByStream = new Map<string, ActiveClaimWriteToken>()
  private readonly streamByConsumer = new Map<string, string>()

  mint(service: string, streamPath: string, consumerId: string): string {
    const streamKey = this.streamKey(service, streamPath)
    const consumerKey = this.consumerKey(service, consumerId)
    const previousClaimForStream = this.claimsByStream.get(streamKey)
    if (previousClaimForStream) {
      this.streamByConsumer.delete(
        this.consumerKey(service, previousClaimForStream.consumerId)
      )
    }

    const previousStreamForConsumer = this.streamByConsumer.get(consumerKey)
    if (previousStreamForConsumer) {
      this.claimsByStream.delete(previousStreamForConsumer)
    }

    const token = randomUUID()
    this.claimsByStream.set(streamKey, { token, consumerId })
    this.streamByConsumer.set(consumerKey, streamKey)
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
    this.streamByConsumer.delete(
      this.consumerKey(service, activeClaim.consumerId)
    )
  }

  clearConsumer(service: string, consumerId: string): void {
    const consumerKey = this.consumerKey(service, consumerId)
    const streamKey = this.streamByConsumer.get(consumerKey)
    if (!streamKey) return

    this.streamByConsumer.delete(consumerKey)
    this.claimsByStream.delete(streamKey)
  }

  private streamKey(service: string, streamPath: string): string {
    return `${service}\0${streamPath}`
  }

  private consumerKey(service: string, consumerId: string): string {
    return `${service}\0${consumerId}`
  }
}
