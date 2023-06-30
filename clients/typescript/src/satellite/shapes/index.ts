import { ShapeDefinition, ShapeRequest, SubscriptionData } from './types'

export interface SubscriptionsManager {
  subscriptionRequested(subId: string, shapeRequests: ShapeRequest[]): void

  subscriptionDelivered(data: SubscriptionData): void

  shapesForActiveSubscription(subId: string): ShapeDefinition[] | undefined

  unsubscribe(subId: string): void

  unsubscribeAll(): void

  serialize(): string
}
