import { toBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { ObservableV2 } from "lib0/observable"
import * as env from "lib0/environment"
import * as Y from "yjs"
import {
  FetchError,
  isChangeMessage,
  isControlMessage,
  Message,
  Offset,
  ShapeStream,
} from "@electric-sql/client"
import { parseToDecoder } from "./utils"
import { IndexeddbPersistence } from "y-indexeddb"

type OperationMessage = {
  op: decoding.Decoder
}

type AwarenessMessage = {
  op: decoding.Decoder
  clientId: string
  room: string
}

type ObservableProvider = {
  sync: (state: boolean) => void
  synced: (state: boolean) => void
  status: (status: {
    status: `connecting` | `connected` | `disconnected`
  }) => void
  // eslint-disable-next-line quotes
  "connection-close": () => void
}

// Awareness TODOs:
// Notify other users of departure
// Reload awareness state on reconnection
// Don't apply state changes older than ping period

const messageSync = 0

export class ElectricProvider extends ObservableV2<ObservableProvider> {
  private serverUrl: string
  private roomName: string
  private doc: Y.Doc
  public awareness?: awarenessProtocol.Awareness

  private operationsStream?: ShapeStream<OperationMessage>
  private awarenessStream?: ShapeStream<AwarenessMessage>

  private shouldConnect: boolean
  private connected: boolean
  private _synced: boolean

  private modifiedWhileOffline: boolean
  private lastSyncedStateVector?: Uint8Array

  private updateHandler: (update: Uint8Array, origin: unknown) => void
  private awarenessUpdateHandler?: (
    changed: { added: number[]; updated: number[]; removed: number[] },
    origin: string
  ) => void
  private disconnectHandler?: () => void
  private exitHandler?: () => void

  private persistence?: IndexeddbPersistence
  private loaded: boolean
  private resume: {
    operations?: { offset: Offset; handle: string }
    awareness?: { offset: Offset; handle: string }
  } = {}

  constructor(
    serverUrl: string,
    roomName: string,
    doc: Y.Doc,
    options: {
      awareness?: awarenessProtocol.Awareness
      connect?: boolean
      persistence?: IndexeddbPersistence
    } // TODO: make it generic, we can load it outside the provider
  ) {
    super()

    this.serverUrl = serverUrl
    this.roomName = roomName

    this.doc = doc
    this.awareness = options.awareness

    this.connected = false
    this._synced = false
    this.shouldConnect = options.connect ?? false

    this.modifiedWhileOffline = false

    this.persistence = options.persistence
    this.loaded = this.persistence === undefined

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== this) {
        this.sendOperation(update)
      }
    }
    this.doc.on(`update`, this.updateHandler)

    if (this.awareness) {
      this.awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
        if (origin === `local`) {
          const changedClients = added.concat(updated).concat(removed)
          this.sendAwareness(changedClients)
        }
      }
      this.awareness.on(`update`, this.awarenessUpdateHandler)
    }

    if (env.isNode && typeof process !== `undefined`) {
      this.exitHandler = () => {
        if (this.awareness) {
          awarenessProtocol.removeAwarenessStates(
            this.awareness,
            [doc.clientID],
            `app closed`
          )
        }
        process.on(`exit`, () => this.exitHandler!())
      }
    }

    if (!this.loaded) {
      this.loadState()
    } else if (options.connect) {
      this.connect()
    }
  }

  private get operationsUrl() {
    return this.serverUrl + `/v1/shape`
  }

  private get awarenessUrl() {
    return this.serverUrl + `/v1/shape`
  }

  get synced() {
    return this._synced
  }

  set synced(state) {
    if (this._synced !== state) {
      this._synced = state
      this.emit(`synced`, [state])
      this.emit(`sync`, [state])
    }
  }

  async loadState() {
    if (this.persistence) {
      const operationsHandle = await this.persistence.get(`operation_handle`)
      const operationsOffset = await this.persistence.get(`operation_offset`)

      const awarenessHandle = await this.persistence.get(`awareness_handle`)
      const awarenessOffset = await this.persistence.get(`awareness_offset`)

      // TODO: fix not loading changes from other users
      const lastSyncedStateVector = await this.persistence.get(
        `last_synced_state_vector`
      )

      this.lastSyncedStateVector = lastSyncedStateVector
      this.modifiedWhileOffline = this.lastSyncedStateVector !== undefined

      this.resume = {
        operations: {
          handle: operationsHandle,
          offset: operationsOffset,
        },
        // TODO: we want the last pings of users, so it's more complicated
        awareness: {
          handle: awarenessHandle,
          offset: awarenessOffset,
        },
      }

      this.loaded = true
      if (this.shouldConnect) {
        this.connect()
      }
    }
  }

  destroy() {
    this.disconnect()
    this.doc.off(`update`, this.updateHandler)
    this.awareness?.off(`update`, this.awarenessUpdateHandler!)
    if (env.isNode && typeof process !== `undefined`) {
      process.off(`exit`, this.exitHandler!)
    }
    super.destroy()
  }

  disconnect() {
    this.shouldConnect = false
    if (this.disconnectHandler) {
      this.disconnectHandler()
    }
  }

  connect() {
    this.shouldConnect = true
    if (!this.connected && !this.operationsStream) {
      this.setupShapeStream()
    }
  }

  private sendOperation(update: Uint8Array) {
    if (update.length <= 2) {
      throw Error(
        `Shouldn't be trying to send operations without pending operations`
      )
    }

    if (!this.connected) {
      this.modifiedWhileOffline = true
      return Promise.resolve()
    }

    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
    const op = toBase64(encoding.toUint8Array(encoder))
    const room = this.roomName

    return fetch(`/api/operation`, {
      method: `POST`,
      body: JSON.stringify({ room, op }),
    })
  }

  private sendAwareness(changedClients: number[]) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness!, changedClients)
    )
    const op = toBase64(encoding.toUint8Array(encoder))

    if (this.connected) {
      const room = this.roomName
      const clientId = `${this.doc.clientID}`

      return fetch(`/api/operation`, {
        method: `POST`,
        body: JSON.stringify({ clientId, room, op }),
      })
    }
  }

  private setupShapeStream() {
    if (this.shouldConnect && !this.operationsStream) {
      this.connected = false
      this.synced = false

      console.log(`Setting up shape stream ${JSON.stringify(this.resume)}`)

      this.operationsStream = new ShapeStream<OperationMessage>({
        url: this.operationsUrl,
        table: `ydoc_operations`,
        where: `room = '${this.roomName}'`,
        parser: parseToDecoder,
        subscribe: true,
        ...this.resume.operations,
      })

      this.awarenessStream = new ShapeStream({
        url: this.awarenessUrl,
        where: `room = '${this.roomName}'`,
        table: `ydoc_awareness`,
        parser: parseToDecoder,
        ...this.resume.awareness,
      })

      const errorHandler = (e: FetchError | Error) => {
        throw e
      }

      // we probably want to extract this code
      // save state per user
      const updateShapeState = (
        name: `operation` | `awareness`,
        offset: Offset,
        handle: string
      ) => {
        this.persistence?.set(`${name}_offset`, offset)
        this.persistence?.set(`${name}_handle`, handle)
      }

      const handleSyncMessage = (messages: Message<OperationMessage>[]) => {
        messages.forEach((message) => {
          if (isChangeMessage(message) && message.value.op) {
            const decoder = message.value.op
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageSync)
            syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
          } else if (
            isControlMessage(message) &&
            message.headers.control === "up-to-date"
          ) {
            this.synced = true

            updateShapeState(
              `operation`,
              this.operationsStream!.lastOffset,
              this.operationsStream!.shapeHandle
            )
          }
        })
      }

      const unsubscribeSyncHandler = this.operationsStream.subscribe(
        handleSyncMessage,
        errorHandler
      )

      const handleAwarenessMessage = (
        messages: Message<AwarenessMessage>[]
      ) => {
        messages.forEach((message) => {
          if (isChangeMessage(message) && message.value.op) {
            const decoder = message.value.op
            awarenessProtocol.applyAwarenessUpdate(
              this.awareness!,
              decoding.readVarUint8Array(decoder),
              this
            )
          }
        })

        updateShapeState(
          `awareness`,
          this.awarenessStream!.lastOffset,
          this.awarenessStream!.shapeHandle
        )
      }

      const unsubscribeAwarenessHandler = this.awarenessStream.subscribe(
        handleAwarenessMessage,
        errorHandler
      )

      this.disconnectHandler = () => {
        this.operationsStream = undefined
        this.awarenessStream = undefined

        if (this.connected) {
          this.connected = false

          this.synced = false

          if (this.awareness) {
            awarenessProtocol.removeAwarenessStates(
              this.awareness,
              Array.from(this.awareness.getStates().keys()).filter(
                (client) => client !== this.doc.clientID
              ),
              this
            )
            this.sendAwareness([this.doc.clientID])
          }
          this.lastSyncedStateVector = Y.encodeStateVector(this.doc)
          this.persistence?.set(
            `last_synced_state_vector`,
            this.lastSyncedStateVector
          )
          this.emit(`status`, [{ status: `disconnected` }])
        }

        unsubscribeSyncHandler()
        unsubscribeAwarenessHandler()
        this.disconnectHandler = undefined
        this.emit(`connection-close`, [])
      }

      // send pending changes
      const unsubscribeOps = this.operationsStream!.subscribe(() => {
        this.connected = true

        if (this.modifiedWhileOffline) {
          const pendingUpdates = Y.encodeStateAsUpdate(
            this.doc,
            this.lastSyncedStateVector
          )
          const encoderState = encoding.createEncoder()
          syncProtocol.writeUpdate(encoderState, pendingUpdates)

          this.sendOperation(pendingUpdates).then(() => {
            this.lastSyncedStateVector = undefined
            this.modifiedWhileOffline = false
            this.persistence?.del(`last_synced_state_vector`)
            this.emit(`status`, [{ status: `connected` }])
          })
        }
        unsubscribeOps()
      })

      if (this.awarenessStream) {
        const unsubscribeAwareness = this.awarenessStream.subscribe(() => {
          if (this.awareness!.getLocalState() !== null) {
            this.sendAwareness([this.doc.clientID])
          }
          unsubscribeAwareness()
        })
      }

      this.emit(`status`, [{ status: `connecting` }])
    }
  }
}
