import {
  ChangeMessage,
  Offset,
  Row,
  ShapeStream,
  ShapeStreamOptions,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'

import {
  ShapeKey,
  SyncShapeToTableOptions,
  SyncShapeToTableResult,
  MapColumns,
  ElectricSyncOptions,
} from './sync'
import { SQLiteDbWithElectricSync } from './wrappers'

interface MigrateShapeMetadataTablesOptions {
  sqlite: SQLiteDbWithElectricSync
  metadataSchema: string
}

// Extending ChangeMessage with optional offset property
interface LegacyChangeMessage<T extends Row<unknown>> extends ChangeMessage<T> {
  offset?: Offset
}

interface ApplyMessageToTableOptions {
  sqlite: SQLiteDbWithElectricSync
  table: string
  schema?: string
  message: ChangeMessage<any>
  mapColumns?: MapColumns
  primaryKey: string[]
  debug: boolean
}

export function makeElectricSync(
  sqlite: SQLiteDbWithElectricSync,
  options?: ElectricSyncOptions
) {
  const debug = options?.debug ?? false
  const metadataSchema = options?.metadataSchema ?? 'electric'
  const streams: Array<{
    stream: ShapeStream
    aborter: AbortController
  }> = []

  // TODO: keeping an in-memory lock per table such that two
  // shapes are not synced into one table - this will be
  // resolved by using reference counting in shadow tables
  const shapePerTableLock = new Map<string, void>()

  let initMetadataTablesDone = false
  const initMetadataTables = async () => {
    if (initMetadataTablesDone) return
    initMetadataTablesDone = true
    await migrateShapeMetadataTables({
      sqlite,
      metadataSchema,
    })
  }

  const close = async () => {
    for (const { stream, aborter } of streams) {
      stream.unsubscribeAll()
      aborter.abort()
    }
  }

  const namespaceObj = {
    electric: {
      initMetadataTables,
      syncShapeToTable: async (
        options: SyncShapeToTableOptions
      ): Promise<SyncShapeToTableResult> => {
        await initMetadataTables()
        options = {
          commitGranularity: 'up-to-date',
          ...options,
        }
        if (shapePerTableLock.has(options.table)) {
          throw new Error('Already syncing shape for table ' + options.table)
        }
        shapePerTableLock.set(options.table)
        let shapeSubState: ShapeSubscriptionState | null = null

        // if shapeKey is not null, ensure persistence of shape subscription
        // state is possible and check if it is already persisted
        if (options.shapeKey) {
          shapeSubState = await getShapeSubscriptionState({
            sqlite,
            metadataSchema,
            shapeKey: options.shapeKey,
          })
          if (debug && shapeSubState) {
            console.log('resuming from shape state', shapeSubState)
          }
        }

        // If it's a new subscription there is no state to resume from
        const isNewSubscription = shapeSubState === null

        // Track if onInitialSync has been called
        let onInitialSyncCalled = false

        const aborter = new AbortController()
        if (options.shape.signal) {
          // we new to have our own aborter to be able to abort the stream
          // but still accept the signal from the user
          options.shape.signal.addEventListener(
            'abort',
            () => aborter.abort(),
            {
              once: true,
            }
          )
        }
        const stream = new ShapeStream({
          params: {
            url: (options as any).url,
            table: (options as any).table,
          },
          ...options.shape,
          ...(shapeSubState ?? {}),
          signal: aborter.signal,
        })

        // TODO: this aggregates all messages in memory until an
        // up-to-date message is received, which is not viable for
        // _very_ large shapes - either we should commit batches to
        // a temporary table and copy over the transactional result
        // or use a separate connection to hold a long transaction
        let messageAggregator: LegacyChangeMessage<any>[] = []
        let truncateNeeded = false
        // let lastLSN: string | null = null  // Removed until Electric has stabilised on LSN metadata
        let lastCommitAt: number = 0

        const commit = async () => {
          if (messageAggregator.length === 0 && !truncateNeeded) return
          const shapeHandle = stream.shapeHandle // The shape handle could change while we are committing
          await sqlite.transaction(async (tx) => {
            if (debug) {
              console.log('committing message batch', messageAggregator.length)
              console.time('commit')
            }

            // In PGlite plugin we set a flag to signal that a sync is in progress
            // In SQLite, coordination is done through the exclusive lock provided
            // by the plugin

            if (truncateNeeded) {
              truncateNeeded = false
              // TODO: sync into shadow table and reference count
              // for now just clear the whole table - will break
              // cases with multiple shapes on the same table
              tx.exec(`DELETE FROM ${options.table};`)
              if (options.shapeKey) {
                await deleteShapeSubscriptionState({
                  sqlite: tx,
                  metadataSchema,
                  shapeKey: options.shapeKey,
                })
              }
            }

            for (const changeMessage of messageAggregator) {
              await applyMessageToTable({
                sqlite: tx,
                table: options.table,
                schema: options.schema,
                message: changeMessage,
                mapColumns: options.mapColumns,
                primaryKey: options.primaryKey,
                debug,
              })
            }

            if (
              options.shapeKey &&
              messageAggregator.length > 0 &&
              shapeHandle !== undefined
            ) {
              await updateShapeSubscriptionState({
                sqlite: tx,
                metadataSchema,
                shapeKey: options.shapeKey,
                shapeId: shapeHandle,
                lastOffset: getMessageOffset(
                  stream,
                  messageAggregator[messageAggregator.length - 1]
                ),
              })
            }
          })
          if (debug) console.timeEnd('commit')
          messageAggregator = []
          // Await a timeout to start a new task and  allow other connections to do work
          await new Promise((resolve) => setTimeout(resolve, 0))
        }

        const throttledCommit = async ({
          reset = false,
        }: { reset?: boolean } = {}) => {
          const now = Date.now()
          if (reset) {
            // Reset the last commit time to 0, forcing the next commit to happen immediately
            lastCommitAt = 0
          }
          if (options.commitThrottle && debug)
            console.log(
              'throttled commit: now:',
              now,
              'lastCommitAt:',
              lastCommitAt,
              'diff:',
              now - lastCommitAt
            )
          if (
            options.commitThrottle &&
            now - lastCommitAt < options.commitThrottle
          ) {
            // Skip this commit - messages will be caught by next commit or up-to-date
            if (debug) console.log('skipping commit due to throttle')
            return
          }
          lastCommitAt = now
          await commit()
        }

        stream.subscribe(async (messages) => {
          if (debug) console.log('sync messages received', messages)

          for (const message of messages) {
            if (isChangeMessage(message)) {
              // Removed until Electric has stabilised on LSN metadata
              // const newLSN = message.offset.split('_')[0]
              // if (newLSN !== lastLSN) {
              //   // If the LSN has changed and granularity is set to transaction
              //   // we need to commit the current batch.
              //   // This is done before we accumulate any more messages as they are
              //   // part of the next transaction batch.
              //   if (options.commitGranularity === 'transaction') {
              //     await throttledCommit()
              //   }
              //   lastLSN = newLSN
              // }

              // accumulate change messages for committing all at once or in batches
              messageAggregator.push(message)

              if (options.commitGranularity === 'operation') {
                // commit after each operation if granularity is set to operation
                await throttledCommit()
              } else if (typeof options.commitGranularity === 'number') {
                // commit after every N messages if granularity is set to a number
                if (messageAggregator.length >= options.commitGranularity) {
                  await throttledCommit()
                }
              }
            } else if (isControlMessage(message)) {
              switch (message.headers?.control) {
                case 'must-refetch':
                  // mark table as needing truncation before next batch commit
                  if (debug) console.log('refetching shape')
                  truncateNeeded = true
                  messageAggregator = []
                  break

                case 'up-to-date':
                  // perform all accumulated changes and store stream state
                  await throttledCommit({ reset: true }) // not throttled, we want this to happen ASAP
                  if (
                    isNewSubscription &&
                    !onInitialSyncCalled &&
                    options.onInitialSync
                  ) {
                    options.onInitialSync()
                    onInitialSyncCalled = true
                  }
                  break
              }
            }
          }
        })

        streams.push({
          stream,
          aborter,
        })
        const unsubscribe = () => {
          stream.unsubscribeAll()
          aborter.abort()
          shapePerTableLock.delete(options.table)
        }
        return {
          unsubscribe,
          get isUpToDate() {
            return stream.isUpToDate
          },
          get shapeId() {
            return stream.shapeHandle!
          },
          stream,
          subscribe: (cb: () => void, error: (err: Error) => void) => {
            return stream.subscribe(() => {
              if (stream.isUpToDate) {
                cb()
              }
            }, error)
          },
        }
      },
    },
  }

  return {
    db: sqlite,
    electric: namespaceObj.electric,
    close: () => {
      sqlite.close()
      close()
    },
    namespaceObj,
  }
}

async function migrateShapeMetadataTables({
  sqlite,
  metadataSchema,
}: MigrateShapeMetadataTablesOptions) {
  console.log('migrating shape metadata tables')
  // PRAGMA ${metadataSchema}_syncing = false;
  await sqlite.exec(
    `
      CREATE TABLE IF NOT EXISTS ${subscriptionMetadataTableName(metadataSchema)} (
        shape_key TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        offset TEXT NOT NULL
      );
      `
  )
  console.log('migrated shape metadata tables')
}

function doMapColumns(
  mapColumns: MapColumns,
  message: ChangeMessage<any>
): Record<string, any> {
  if (typeof mapColumns === 'function') {
    return mapColumns(message)
  } else {
    const result: Record<string, any> = {}
    const srcData = message.value
    for (const srcKey in srcData) {
      const destKey = mapColumns[srcKey] ?? srcKey
      result[destKey] = srcData[srcKey]
    }
    return result
  }
}

type ShapeSubscriptionState = Pick<ShapeStreamOptions, 'handle' | 'offset'>

interface GetShapeSubscriptionStateOptions {
  readonly sqlite: SQLiteDbWithElectricSync
  readonly metadataSchema: string
  readonly shapeKey: ShapeKey
}

async function getShapeSubscriptionState({
  sqlite,
  metadataSchema,
  shapeKey,
}: GetShapeSubscriptionStateOptions): Promise<ShapeSubscriptionState | null> {
  console.log('getting shape subscription state')
  const stmt = sqlite.prepare<string[]>(
    `
    SELECT handle, offset
    FROM ${subscriptionMetadataTableName(metadataSchema)}
    WHERE shape_key = ?
  `
  )

  const result = await stmt.get<{ handle: string; offset: Offset }>(shapeKey)
  stmt.finalize?.()

  if (!result) return null

  const { handle, offset } = result
  return { handle, offset }
}

interface DeleteShapeSubscriptionStateOptions {
  readonly sqlite: SQLiteDbWithElectricSync
  readonly metadataSchema: string
  readonly shapeKey: ShapeKey
}

async function deleteShapeSubscriptionState({
  sqlite,
  metadataSchema,
  shapeKey,
}: DeleteShapeSubscriptionStateOptions): Promise<void> {
  const stmt = sqlite.prepare(
    `
    DELETE FROM ${subscriptionMetadataTableName(metadataSchema)}
    WHERE shape_key = ?
  `
  )

  await stmt.run(shapeKey)
  stmt.finalize?.()
}

interface UpdateShapeSubscriptionStateOptions {
  readonly sqlite: SQLiteDbWithElectricSync
  readonly metadataSchema: string
  readonly shapeKey: ShapeKey
  readonly shapeId: string
  readonly lastOffset: string
}

async function updateShapeSubscriptionState({
  sqlite,
  metadataSchema,
  shapeKey,
  shapeId,
  lastOffset,
}: UpdateShapeSubscriptionStateOptions): Promise<void> {
  console.log('update shape subscription state')
  const tableName = subscriptionMetadataTableName(metadataSchema)
  const stmt = sqlite.prepare(
    `
    INSERT INTO ${tableName} (shape_key, handle, offset)
    VALUES (?, ?, ?)
    ON CONFLICT (shape_key) DO UPDATE SET
      handle = excluded.handle,
      offset = excluded.offset
  `
  )

  await stmt.run(shapeKey, shapeId, lastOffset)
  stmt.finalize?.()
}

function getMessageOffset(
  stream: ShapeStream,
  message: LegacyChangeMessage<any>
): string {
  return message.offset
    ? JSON.stringify(message.offset)
    : (stream.shapeHandle ?? '')
}

async function applyMessageToTable({
  sqlite,
  table,
  message,
  mapColumns,
  primaryKey,
  debug,
}: ApplyMessageToTableOptions): Promise<void> {
  const data = mapColumns ? doMapColumns(mapColumns, message) : message.value
  if (debug) console.log('applying message', message)

  switch (message.headers?.operation) {
    case 'insert': {
      const columns = Object.keys(data)
      await sqlite
        .prepare(
          `
            INSERT INTO ${table}
            (${columns.join(', ')})
            VALUES
            (${columns.map((_v, i) => '$' + (i + 1)).join(', ')})
        `
        )
        .run(...columns.map((column) => data[column]))

      return
    }

    case 'update': {
      if (debug) console.log('updating', data)
      const columns = Object.keys(data).filter(
        // we don't update the primary key, they are used to identify the row
        (column) => !primaryKey.includes(column)
      )
      if (columns.length === 0) return // nothing to update
      return await sqlite
        .prepare(
          `
              UPDATE ${table}
              SET ${columns
                .map((column, i) => `${column} = $${i + 1}`)
                .join(', ')}
              WHERE ${primaryKey
                .map((column, i) => `${column} = $${columns.length + i + 1}`)
                .join(' AND ')}
            `
        )
        .run(
          ...columns.map((column) => data[column]),
          ...primaryKey.map((column) => data[column])
        )
    }

    case 'delete': {
      if (debug) console.log('deleting', data)
      return await sqlite
        .prepare(
          `
              DELETE FROM ${table}
              WHERE ${primaryKey
                .map((column, i) => `${column} = $${i + 1}`)
                .join(' AND ')}
            `
        )
        .run(...primaryKey.map((column) => data[column]))
    }
  }
}

function subscriptionMetadataTableName(metadataSchema: string) {
  console.log(`${metadataSchema}_${subscriptionTableName}`)
  return `${metadataSchema}_${subscriptionTableName}`
}

const subscriptionTableName = `shape_subscriptions_metadata`
