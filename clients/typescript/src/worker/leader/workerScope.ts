/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  GlobalChannelEventType,
  LeaderElectedEvent,
  LeaderWorkerGlobalChannel,
} from './globalChannel'

interface LeaderWorkerScope {
  onelection: ((event: MessageEvent) => void) | null
  onnewleader: ((event: MessageEvent) => void) | null
  onconnect: ((event: MessageEvent) => void) | null
}

export class LeaderWorkerHandler implements LeaderWorkerScope {
  public onelection: ((event: MessageEvent) => void) | null = null
  public onconnect: ((event: MessageEvent) => void) | null = null
  public onnewleader: ((event: MessageEvent) => void) | null = null

  private coordinationKey: string | null = null
  private globalChannel: LeaderWorkerGlobalChannel | null = null
  private clientId: Promise<string>
  private leaderClientId: string | null = null
  private leaderSequenceNumber: number = -1

  constructor(workerScope: Worker) {
    this.clientId = this.generateClientId()
    workerScope.addEventListener('message', (event: MessageEvent) => {
      switch (event.data.type) {
        case 'activate':
          return this.activate(event.data.coordinationKey)
        case 'onelection':
          return this.onelection?.(event)
        case 'onconnect':
          return this.onconnect?.(event)
        case 'onnewleader':
          return this.onnewleader?.(event)
      }
    })
  }

  public async activate(coordinationKey: string) {
    if (this.coordinationKey !== null) {
      throw new Error('Cannot initialize leader worker more than once')
    }

    this.coordinationKey = coordinationKey
    this.globalChannel = new LeaderWorkerGlobalChannel(coordinationKey)

    this.subscribeToFollowerEvents()

    await Promise.race([this.runForElection(), this.requestLeader()])
  }

  private subscribeToFollowerEvents() {
    this.globalChannel!.subscribe(
      GlobalChannelEventType.leaderElected,
      async (event: LeaderElectedEvent) => {
        // only listen to new leaders with a higher sequence number
        if (
          event.leaderSequenceNumber > this.leaderSequenceNumber &&
          event.leaderClientId !== this.leaderClientId
        ) {
          this.leaderClientId = event.leaderClientId
          this.leaderSequenceNumber = event.leaderSequenceNumber
          this.globalChannel!.leaderAcknowledged(
            await this.clientId,
            this.leaderClientId
          )
        }
      }
    )
  }

  private async requestLeader() {
    this.globalChannel!.requestLeader(await this.clientId)
  }

  private async runForElection() {
    return navigator.locks.request(
      this.coordinationKey!,
      this.assumeLeadership.bind(this)
    )
  }

  private async assumeLeadership() {
    this.leaderClientId = await this.clientId
    this.leaderSequenceNumber += 1
    this.globalChannel!.leaderElected(
      this.leaderClientId,
      this.leaderSequenceNumber
    )
  }

  private async generateClientId() {
    // Use WebLock to get a clientId, inspired by:
    // https://github.com/rhashimoto/wa-sqlite/blob/master/demo/SharedService/SharedService.js
    const nonce = Math.random().toString()
    const clientId = await navigator.locks.request(nonce, async () => {
      const { held } = await navigator.locks.query()
      return held?.find((lock) => lock.name === nonce)?.clientId
    })

    return clientId!
  }
}
