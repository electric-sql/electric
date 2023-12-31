import * as Y from 'yjs'
import { murmurHash } from 'ohash'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import { ChangeNotification } from 'electric-sql/notifiers'
import { base64ToBytes } from './index'

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
  }

  async #processDataChanges(changes: ChangeNotification) {
    // TODO: would be nice if the ChangeNotification has a way to get the
    // oplog rows directly, instead of having to query for them
    const changedYDocIds = new Set<string>()
    const rowids = changes.changes
      .filter(
        (change) =>
          change.rowids && change.qualifiedTablename.tablename === 'ydoc_update'
      )
      .reduce((rowids, change) => {
        change.rowids?.map((rowid) => rowids.add(rowid))
        return rowids
      }, new Set<number>())
    console.log(rowids)
    if (rowids.size > 0) {
      const ops = await this.#electricClient.adapter.query({
        // TODO: get the oplog table name from the config?
        sql: `SELECT rowid, * FROM main._electric_oplog WHERE rowid IN (${Array.from(
          rowids
        ).join(', ')})`,
      })
      ops.forEach((op) => {
        const newRow = JSON.parse(op.newRow as string)
        changedYDocIds.add(newRow.ydoc_id)
      })
    }
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
      await this.#constrictAndMaterializeYDoc(ydocId, type, updatesHash)
    }
  }

  async #constrictAndMaterializeYDoc(
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
    // await this.#electricClient.adapter.query({
    //   sql: `UPDATE ydoc SET last_materialized = ? WHERE id = ?`,
    //   args: [updatesHash, ydocId],
    // })
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
