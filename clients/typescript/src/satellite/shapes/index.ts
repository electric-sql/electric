import { ShapeDefinition, ShapeRequest, SubscriptionData } from './types'

/**
 * Manages the state of satellite shape subscriptions
 */
export interface SubscriptionsManager {
  /**
   * Stores the identifier for a subscription
   * request that was accepted by the server
   *
   * @param subId the identifier of the subscription
   * @param shapeRequests the shapes definitions of the request
   */
  subscriptionRequested(subId: string, shapeRequests: ShapeRequest[]): void

  /**
   * Registers that a subsciption that was in-flight is now
   * delivered.
   * @param data the data for the subscription
   */
  subscriptionDelivered(data: SubscriptionData): void

  /**
   * Returns the shape definitions for subscriptions avalailable locally
   * @param subId the identifier of the subscription
   */
  shapesForActiveSubscription(subId: string): ShapeDefinition[] | undefined

  /**
   * Deletes the subscription from the manager.
   * @param subId the identifier of the subscription
   */
  unsubscribe(subId: string): Promise<void>

  /**
   * Deletes all subscriptions from the manager. Useful to
   * reset the state of the manager
   */
  unsubscribeAll(): Promise<void>

  /**
   * Converts the state of the manager to a string format that
   * can be used to persist it
   */
  serialize(): string
}
