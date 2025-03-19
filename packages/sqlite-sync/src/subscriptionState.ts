import type { Offset } from '@electric-sql/client'
import { SubscriptionKey, Lsn, SerializedLsn } from './types'
import { SqliteWrapper } from './wrapper'

const subscriptionTableName = `subscriptions_metadata`

export type SubscriptionStateSerialized = {
  key: SubscriptionKey
  shape_metadata: string
  last_lsn: SerializedLsn
}

export interface SubscriptionState {
  key: SubscriptionKey
  shape_metadata: Record<string, ShapeSubscriptionState>
  last_lsn: Lsn
}

export interface ShapeSubscriptionState {
  handle: string
  offset: Offset
}

export interface GetSubscriptionStateOptions {
  readonly sqlite: SqliteWrapper
  readonly metadataSchema: string
  readonly subscriptionKey: SubscriptionKey
}

/**
 * Get the subscription state for a given key.
 * @param options - The options for the subscription state.
 * @returns The subscription state or null if it does not exist.
 */
export async function getSubscriptionState({
  sqlite,
  metadataSchema,
  subscriptionKey,
}: GetSubscriptionStateOptions): Promise<SubscriptionState | null> {
  const subscriptionsSerialized = await sqlite
    .prepare(
      `
      SELECT key, shape_metadata, last_lsn
      FROM ${subscriptionMetadataTableName(metadataSchema)}
      WHERE key = ?
    `
    )
    .all<SubscriptionStateSerialized>(subscriptionKey)

  if (subscriptionsSerialized.length === 0) {
    return null
  } else if (subscriptionsSerialized.length > 1) {
    throw new Error(`Multiple subscriptions found for key: ${subscriptionKey}`)
  }

  const serialized: SubscriptionStateSerialized = {
    ...subscriptionsSerialized[0],
  }
  const subscriptionState: SubscriptionState = {
    key: serialized.key,
    shape_metadata: serialized.shape_metadata
      ? JSON.parse(serialized.shape_metadata)
      : undefined,
    last_lsn: serialized.last_lsn ? BigInt(serialized.last_lsn) : BigInt(0),
  }

  return subscriptionState
}

export interface UpdateSubscriptionStateOptions {
  sqlite: SqliteWrapper
  metadataSchema: string
  subscriptionKey: SubscriptionKey
  shapeMetadata: Record<string, ShapeSubscriptionState>
  lastLsn: Lsn
  debug?: boolean
}

/**
 * Update the subscription state for a given key.
 * @param options - The options for the subscription state.
 */
export async function updateSubscriptionState({
  sqlite,
  metadataSchema,
  subscriptionKey,
  shapeMetadata,
  lastLsn,
  debug,
}: UpdateSubscriptionStateOptions) {
  if (debug) {
    console.log(
      `updating subscription state`,
      subscriptionKey,
      shapeMetadata,
      lastLsn
    )
  }

  await sqlite
    .prepare(
      `
      INSERT OR REPLACE INTO ${subscriptionMetadataTableName(metadataSchema)}
        (key, shape_metadata, last_lsn)
      VALUES
        (?, ?, ?);
    `
    )
    .run(subscriptionKey, JSON.stringify(shapeMetadata), lastLsn.toString())
}

export interface DeleteSubscriptionStateOptions {
  sqlite: SqliteWrapper
  metadataSchema: string
  subscriptionKey: SubscriptionKey
}

/**
 * Delete the subscription state for a given key.
 * @param options - The options for the subscription state.
 */
export async function deleteSubscriptionState({
  sqlite,
  metadataSchema,
  subscriptionKey,
}: DeleteSubscriptionStateOptions) {
  await sqlite
    .prepare(
      `DELETE FROM ${subscriptionMetadataTableName(metadataSchema)} WHERE key = ?`
    )
    .run(subscriptionKey)
}

export interface MigrateSubscriptionMetadataTablesOptions {
  sqlite: SqliteWrapper
  metadataSchema: string
}

/**
 * Migrate the subscription metadata tables.
 * @param options - The options for the subscription metadata tables.
 */
export async function migrateSubscriptionMetadataTables({
  sqlite,
  metadataSchema,
}: MigrateSubscriptionMetadataTablesOptions) {
  await sqlite.exec(
    `
      CREATE TABLE IF NOT EXISTS ${subscriptionMetadataTableName(metadataSchema)} (
        key TEXT PRIMARY KEY,
        shape_metadata BLOB NOT NULL,
        last_lsn TEXT NOT NULL
      );
    `
  )
}

function subscriptionMetadataTableName(metadataSchema: string) {
  return `${metadataSchema}_${subscriptionTableName}`
}
