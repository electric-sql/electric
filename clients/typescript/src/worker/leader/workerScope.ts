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
  private clientId: string | null = null
  private leaderClientId: string | null = null
  private leaderSequenceNumber: number = -1

  constructor(workerScope: Worker) {
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

    // TODO: maybe try to get it at constructor and wait promise here
    this.clientId = await getClientId()

    // start listening for leader changes early
    this.subscribeToLeaderChangeEvents()

    // request for any current leaders while simultanesouly
    // running for leadership
    this.requestLeader()
    this.runForElection()
  }

  private subscribeToLeaderChangeEvents() {
    this.globalChannel!.subscribe(
      GlobalChannelEventType.leaderElected,
      async (event: LeaderElectedEvent) => {
        // only listen for new leaders with a higher sequence number
        if (
          event.leaderSequenceNumber > this.leaderSequenceNumber &&
          event.leaderClientId !== this.leaderClientId
        ) {
          this.acknowledgeLeader(event)
        }
      }
    )
  }

  private async requestLeader() {
    this.globalChannel!.requestLeader(this.clientId!)
  }

  private async runForElection() {
    return navigator.locks.request(
      this.coordinationKey!,
      this.assumeLeadership.bind(this)
    )
  }

  private async acknowledgeLeader(event: LeaderElectedEvent) {
    // TODO: perform leader change stuff
    this.leaderClientId = event.leaderClientId
    this.leaderSequenceNumber = event.leaderSequenceNumber
    this.globalChannel!.leaderAcknowledged(this.clientId!, this.leaderClientId)
  }

  private async assumeLeadership() {
    // TODO: perform leader change stuff
    this.leaderClientId = this.clientId!
    this.leaderSequenceNumber += 1
    this.globalChannel!.leaderElected(
      this.leaderClientId,
      this.leaderSequenceNumber
    )
  }
}

async function getClientId() {
  // Use WebLock to get a clientId, inspired by:
  // https://github.com/rhashimoto/wa-sqlite/blob/master/demo/SharedService/SharedService.js
  const nonce = Math.random().toString()
  const clientId = await navigator.locks.request(nonce, async () => {
    const { held } = await navigator.locks.query()
    return held?.find((lock) => lock.name === nonce)?.clientId
  })

  return clientId!
}
