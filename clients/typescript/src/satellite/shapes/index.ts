import {
  ClientShapeDefinition,
  ShapeDefinition,
  ShapeRequest,
  SubscriptionData,
  SubscriptionId,
} from './types.js'

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
   * Cancel the subscription with the given subscription id
   *
   * @param subId the identifier of the subscription
   */
  subscriptionCancelled(subId: string): void

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
   * @returns An array of fulfilled subscriptions that are active.
   */
  getFulfilledSubscriptions(): SubscriptionId[]

  /**
   * Check if a subscription with exactly the same shape requests has already been issued
   * @param shapes Shapes for a potential request
   */
  getDuplicatingSubscription(
    shapes: ClientShapeDefinition[]
  ): null | { inFlight: string } | { fulfilled: string }

  /**
   * Deletes the subscription from the manager.
   * @param subId the identifier of the subscription
   */
  unsubscribe(subId: string): Promise<void>

  /**
   * Deletes all subscriptions from the manager. Useful to
   * reset the state of the manager.
   * Returns the subscription identifiers of all subscriptions
   * that were deleted.
   */
  unsubscribeAll(): Promise<string[]>

  /**
   * Converts the state of the manager to a string format that
   * can be used to persist it
   */
  serialize(): string

  /**
   * loads the subscription manager state from a text representation
   */
  setState(serialized: string): void
}
