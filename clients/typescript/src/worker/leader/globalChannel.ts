export enum GlobalChannelEventType {
  requestLeader = 'requestLeader',
  leaderElected = 'leaderElected',
  leaderAcknowledged = 'leaderAcknowledged',
}

export type RequestLeaderEvent = {
  type: GlobalChannelEventType.requestLeader
  clientId: string
}
export type LeaderElectedEvent = {
  type: GlobalChannelEventType.leaderElected
  leaderClientId: string
  leaderSequenceNumber: number
}
export type LeaderAcknowledgedEvent = {
  type: GlobalChannelEventType.leaderAcknowledged
  clientId: string
  leaderClientId: string
}

type GlobalChannelEvent =
  | RequestLeaderEvent
  | LeaderElectedEvent
  | LeaderAcknowledgedEvent

type Unsubscribe = () => void

export class LeaderWorkerGlobalChannel {
  private channel: BroadcastChannel

  constructor(coordinationKey: string) {
    this.channel = new BroadcastChannel(`LeaderWorker:${coordinationKey}`)
  }

  private emit(event: GlobalChannelEvent) {
    this.channel.postMessage(event)
  }

  public subscribe<T extends GlobalChannelEvent>(
    eventType: T['type'],
    callback: (event: T) => void
  ): Unsubscribe {
    const listener = (event: MessageEvent) => {
      if (event.data.type === eventType) {
        return callback(event.data)
      }
    }
    this.channel.addEventListener('message', listener)
    return () => {
      this.channel.removeEventListener('message', listener)
    }
  }

  public requestLeader(clientId: string) {
    this.emit({
      type: GlobalChannelEventType.requestLeader,
      clientId,
    } as RequestLeaderEvent)
  }

  public leaderElected(leaderClientId: string, leaderSequenceNumber: number) {
    this.emit({
      type: GlobalChannelEventType.leaderElected,
      leaderClientId,
      leaderSequenceNumber,
    })
  }

  public leaderAcknowledged(clientId: string, leaderClientId: string) {
    this.channel.postMessage({
      type: GlobalChannelEventType.leaderAcknowledged,
      clientId,
      leaderClientId,
    })
  }
}
