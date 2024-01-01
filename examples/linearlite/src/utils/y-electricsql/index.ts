import * as Y from 'yjs'
import { ObservableV2 } from 'lib0/observable.js'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import { uuid } from 'electric-sql/util'
import { materializeYdoc } from './materializer'
import { generateRandomString, base64ToBytes, bytesToBase64 } from './utils'

interface ydocUpdateQueryRow {
  id: string
  data: string
}

const DEFAULT_STORE_TIMEOUT = 1000
const DEFAULT_CHECKPOINT_BYTES = 100_000

export interface ElectricSQLPersistanceOptions {
  /**
   * The timeout after which the data is merged and stored.
   * Default: 1000ms
   */
  storeTimeout?: number

  /**
   * The Yjs document (optional)
   */
  ydoc?: Y.Doc

  /**
   * The checkpoint size in bytes.
   * Default: 100_000 bytes
   */
  checkpointBytes?: number
}

export class ElectricSQLPersistance extends ObservableV2<{
  loaded: (electricSQLPersistance: ElectricSQLPersistance) => void
  error: (error: Error) => void
}> {
  ydoc: Y.Doc
  storeTimeout: number
  #storeTimeoutId: any
  #loaded: boolean
  #notifierUnsubscribe?: () => void
  #ydocUnsubscribe?: () => void
  #loadedUpdateIds: Set<string>
  #pendingUpdates: Uint8Array[]
  #checkpointBytes: number
  #savedBytes: number
  #webrtcSecret?: string
  #type?: string

  constructor(
    public electricClient: ElectricClient<DbSchema<any>>,
    public ydocId: string,
    options?: ElectricSQLPersistanceOptions
  ) {
    super()
    this.ydoc = options?.ydoc || new Y.Doc()
    this.storeTimeout = options?.storeTimeout ?? DEFAULT_STORE_TIMEOUT

    this.#loaded = false
    this.#loadedUpdateIds = new Set()
    this.#pendingUpdates = []

    this.#checkpointBytes = options?.checkpointBytes ?? DEFAULT_CHECKPOINT_BYTES
    this.#savedBytes = 0

    this.#init()
  }

  async #init() {
    // Check if ydoc exists
    try {
      const rows = await this.electricClient.db.raw({
        sql: `SELECT id, webrtc_secret, type FROM ydoc WHERE id = ?`,
        args: [this.ydocId],
      })
      if (rows.length !== 1) {
        this.emit('error', [
          new Error(`YDoc with id ${this.ydocId} does not exist`),
        ])
        return
      }
      this.#webrtcSecret = rows[0].webrtc_secret as string | undefined
      this.#type = rows[0].type as string | undefined
    } catch (err) {
      this.emit('error', [err as Error])
      return
    }

    this.#notifierUnsubscribe =
      this.electricClient.notifier.subscribeToDataChanges((changes) => {
        if (
          changes.changes.some(
            (change) => change.qualifiedTablename.tablename === 'ydoc_update'
          )
        ) {
          this.#loadNewUpdates()
        }
      })

    const handleYDocUpdate = (
      update: Uint8Array,
      origin: any,
      doc: Y.Doc,
      transaction: Y.Transaction
    ) => {
      this.#storeUpdates(update, origin, doc, transaction)
    }
    this.ydoc.on('updateV2', handleYDocUpdate)
    this.#ydocUnsubscribe = () => {
      this.ydoc.off('updateV2', handleYDocUpdate)
    }

    await this.#loadNewUpdates()
    this.#loaded = true
    this.emit('loaded', [this])
  }

  async #loadNewUpdates() {
    const updates = (await this.electricClient.db.raw({
      sql: `SELECT "id", "data" FROM "ydoc_update" WHERE "ydoc_id" = ? AND "id" NOT IN (${Array(
        this.#loadedUpdateIds.size
      )
        .fill('?')
        .join(' ,')}) ORDER BY id ASC`,
      args: [this.ydocId, ...Array.from(this.#loadedUpdateIds)],
    })) as unknown as ydocUpdateQueryRow[]

    updates.forEach(async (update) => {
      this.#loadedUpdateIds.add(update.id)
      const updateData = await base64ToBytes(update.data)
      this.ydoc.transact(() => {
        Y.applyUpdateV2(this.ydoc, updateData)
      }, ElectricSQLPersistance)
    })
  }

  #storeUpdates(
    update: Uint8Array,
    origin: any,
    _doc: Y.Doc,
    transaction: Y.Transaction
  ) {
    // Skip updates from remote revs, these are any that originate from this
    // persistance provider or are market as not local.
    // Essentially, we only want to store updates that originate from edits that
    // the user directly made to the document.
    if (origin == ElectricSQLPersistance || !transaction.local) return
    this.#pendingUpdates.push(update)
    if (!this.#storeTimeoutId) {
      this.#storeTimeoutId = setTimeout(() => {
        this.#storeTimeoutId = null
        this.storePendingUpdates()
      }, this.storeTimeout)
    }
  }

  async storePendingUpdates() {
    if (this.#storeTimeoutId) {
      clearTimeout(this.#storeTimeoutId)
      this.#storeTimeoutId = null
    }
    const update = Y.mergeUpdatesV2(this.#pendingUpdates)
    this.#pendingUpdates = []
    const updateId = uuid()
    this.#loadedUpdateIds.add(updateId) // Add to loaded updates so we don't load it
    const updateBase64 = await bytesToBase64(update)
    this.#savedBytes += updateBase64.length
    await this.electricClient.db.raw({
      sql: `INSERT INTO "ydoc_update" ("id", "ydoc_id", "data") VALUES (?, ?, ?)`,
      args: [updateId, this.ydocId, updateBase64],
    })
    if (this.#savedBytes > this.#checkpointBytes) {
      this.#savedBytes = 0
      await this.checkpoint(false)
    }
    await materializeYdoc(this.electricClient, this.ydocId, this.type!)
  }

  /**
   * Experimental: Checkpoint the current state of the document.
   * This will merge all updates stored in the database into one update.
   * The DELETE and INSERT statements are executed in a transaction.
   * TODO:
   * - Have a way for other clients to know that the document has been checkpointed
   *   so they can reset their `loadedUpdateIds`.
   *   Maybe add a `checkpoint` column to the inserted row?
   */
  async checkpoint(storePendingUpdates = true) {
    if (storePendingUpdates) {  
      await this.storePendingUpdates()
    }
    // Get all updates and merge them into one update
    const updates = (await this.electricClient.db.raw({
      sql: `SELECT "id", "data" FROM "ydoc_update" WHERE "ydoc_id" = ?`,
      args: [this.ydocId],
    })) as unknown as ydocUpdateQueryRow[]

    const updatesData = []
    for (const update of updates) {
      updatesData.push(await base64ToBytes(update.data))
    }

    const update = Y.mergeUpdatesV2(updatesData)
    const oldUpdateIds = updates.map((update) => update.id)
    const updateBase64 = await bytesToBase64(update)
    await this.electricClient.adapter.runInTransaction(
      {
        sql: `DELETE FROM "ydoc_update" WHERE "ydoc_id" in (${Array(
          oldUpdateIds.length
        )
          .fill('?')
          .join(', ')})`,
        args: oldUpdateIds,
      },
      {
        sql: `INSERT INTO ydoc_update ("id", "ydoc_id", "data") VALUES (?, ?, ?)`,
        args: [uuid(), this.ydocId, updateBase64],
      }
    )
  }

  destroy() {
    if (this.#storeTimeoutId) {
      clearTimeout(this.#storeTimeoutId)
    }
    if (this.#notifierUnsubscribe) {
      this.#notifierUnsubscribe()
    }
    if (this.#ydocUnsubscribe) {
      this.#ydocUnsubscribe()
    }
  }

  get loaded() {
    return this.#loaded
  }

  get webrtcSecret() {
    return this.#webrtcSecret
  }

  get type() {
    return this.#type
  }
}

export async function saveNewElectricYDoc(
  electricClient: ElectricClient<DbSchema<any>>,
  ydoc: Y.Doc,
  type: string
) {
  const ydocId = ydoc.guid
  const updateBase64 = await bytesToBase64(Y.encodeStateAsUpdateV2(ydoc))
  await electricClient.adapter.runInTransaction(
    {
      sql: `INSERT INTO ydoc ("id", "type", "webrtc_secret", "last_materialized") VALUES (?, ?, ?, ?);`,
      args: [ydocId, type, generateRandomString(64), ''],
    },
    {
      sql: `INSERT INTO ydoc_update ("id", "ydoc_id", "data") VALUES (?, ?, ?);`,
      args: [uuid(), ydocId, updateBase64],
    }
  )
  return ydocId
}
