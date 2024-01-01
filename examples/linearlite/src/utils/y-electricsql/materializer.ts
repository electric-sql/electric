import * as Y from 'yjs'
import { murmurHash } from 'ohash'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import { ChangeNotification } from 'electric-sql/notifiers'
import { base64ToBytes } from './utils'

export interface MaterializeCallbackOptions {
  docType: string
  ydocId: string
  ydoc: Y.Doc
}
export type MaterializeCallback = (
  options: MaterializeCallbackOptions
) => Promise<void>

export class YDocMaterializer {
  #materializeCallbacks: Map<string, MaterializeCallback[]> = new Map()
  #unsubscribeToDataChanges?: () => void
  #electricClient: ElectricClient<DbSchema<any>>

  constructor(public electricClient: ElectricClient<DbSchema<any>>) {
    this.#electricClient = electricClient
    this.#unsubscribeToDataChanges =
      electricClient.notifier.subscribeToDataChanges(async (changes) => {
        await this.#processDataChanges(changes)
      })
    // Add this materializer to the list of materializers for this client
    materializers.set(electricClient, [
      ...(materializers.get(electricClient) || []),
      this,
    ])
  }

  async #processDataChanges(changes: ChangeNotification) {
    const changedYDocIds = changes.changes
      .filter(
        (change) =>
          change.recordChanges &&
          change.qualifiedTablename.tablename === 'ydoc_update'
      )
      .reduce((ids, change) => {
        change.recordChanges?.forEach((recordChange) => {
          if (recordChange.record) {
            ids.add(recordChange.record['ydoc_id'] as string)
          }
        })
        return ids
      }, new Set<string>())
    changedYDocIds.forEach((ydocId) => this.#processYDocChanges(ydocId))
  }

  async #processYDocChanges(ydocId: string) {
    const ydoc_record = await this.#electricClient.adapter.query({
      sql: `SELECT type, last_materialized FROM ydoc WHERE id = ?`,
      args: [ydocId],
    })
    const type = ydoc_record[0].type as string

    // If there are no materialize callbacks for this doc type, we can skip
    if (!this.#materializeCallbacks.has(type)) return

    const lastMaterializedHash = ydoc_record[0].last_materialized as
      | string
      | null
    const updates = await this.#electricClient.adapter.query({
      sql: `SELECT id FROM ydoc_update WHERE ydoc_id = ?`,
      args: [ydocId],
    })
    if (updates.length === 0) return
    const updateIds = updates
      .map((update) => update.id as string)
      .sort()
      .join(':')
    const updatesHash = murmurHash(updateIds).toString()

    if (lastMaterializedHash !== updatesHash) {
      await this._constrictAndMaterializeYDoc(ydocId, type, updatesHash)
    }
  }

  async _constrictAndMaterializeYDoc(
    ydocId: string,
    docType: string,
    updatesHash?: string
  ) {
    const ydoc = new Y.Doc({ guid: ydocId })
    const ydocUpdates = await this.#electricClient.adapter.query({
      sql: `SELECT id, data FROM ydoc_update WHERE ydoc_id = ?`,
      args: [ydocId],
    })
    await Promise.all(
      ydocUpdates.map(async (update) => {
        const updateData = await base64ToBytes(update.data as string)
        Y.applyUpdateV2(ydoc, updateData)
      })
    )
    if (!updatesHash) {
      const updateIds = ydocUpdates
        .map((update) => update.id as string)
        .sort()
        .join(':')
      updatesHash = murmurHash(updateIds).toString()
    }
    const callbacks = this.#materializeCallbacks.get(docType) || []
    await Promise.all(
      callbacks.map((callback) =>
        callback({
          docType,
          ydocId,
          ydoc,
        })
      )
    )
    await this.#electricClient.adapter.query({
      sql: `UPDATE ydoc SET last_materialized = ? WHERE id = ?`,
      args: [updatesHash, ydocId],
    })
  }

  addMaterializer(docType: string, callback: MaterializeCallback) {
    const callbacks = this.#materializeCallbacks.get(docType) || []
    callbacks.push(callback)
    this.#materializeCallbacks.set(docType, callbacks)
  }

  dispose() {
    this.#unsubscribeToDataChanges?.()
  }
}

const materializers = new WeakMap<
  ElectricClient<DbSchema<any>>,
  YDocMaterializer[]
>()

export function materializeYdoc(
  electricClient: ElectricClient<DbSchema<any>>,
  ydocId: string,
  docType: string,
) {
  for (const materializer of materializers.get(electricClient) || []) {
    materializer._constrictAndMaterializeYDoc(ydocId, docType)
  }
}