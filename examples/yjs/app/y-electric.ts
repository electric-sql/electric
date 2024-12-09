import { toBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { ObservableV2 } from "lib0/observable"
import * as env from "lib0/environment"
import * as Y from "yjs"
import {
  isChangeMessage,
  isControlMessage,
  Message,
  Offset,
  ShapeStream,
} from "@electric-sql/client"
import { parseToDecoder, parseToDecoderLazy, paserToTimestamptz } from "./utils"
import { IndexeddbPersistence } from "y-indexeddb"

type OperationMessage = {
  op: decoding.Decoder
}

type AwarenessMessage = {
  op: () => decoding.Decoder
  clientId: string
  room: string
  updated: Date
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

// from yjs docs, need to check if is configurable
const awarenessPingPeriod = 30000 //ms

const messageSync = 0

export class ElectricProvider extends ObservableV2<ObservableProvider> {
  private baseUrl: string
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
  private disconnectShapeHandler?: () => void
  private exitHandler?: () => void

  private persistence?: IndexeddbPersistence
  private loaded: boolean
  private resume: {
    operations?: { offset: Offset; handle: string }
    awareness?: { offset: Offset; handle: string }
  } = {}

  private awarenessState: Record<string, number | string> | null = null

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

    this.baseUrl = serverUrl + `/v1/shape`
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
        process.on(`exit`, () => this.destroy())
      }
    }

    if (!this.loaded) {
      this.loadSyncState()
    } else if (options.connect) {
      this.connect()
    }
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

  async loadSyncState() {
    if (!this.persistence) {
      throw Error(`Can't load sync state without persistence backend`)
    }
    const operationsHandle = await this.persistence.get(`operations_handle`)
    const operationsOffset = await this.persistence.get(`operations_offset`)

    const awarenessHandle = await this.persistence.get(`awareness_handle`)
    const awarenessOffset = await this.persistence.get(`awareness_offset`)

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

      // TODO: we might miss some awareness updates since last pings
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

    if (this.awareness && this.connected) {
      this.awarenessState = this.awareness.getLocalState()

      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(this.awareness.getStates().keys()).filter(
          (client) => client !== this.doc.clientID
        ),
        this
      )

      // try to notify other clients that we are disconnected
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [this.doc.clientID],
        `local`
      )
    }

    if (this.disconnectShapeHandler) {
      this.disconnectShapeHandler()
    }
  }

  connect() {
    this.shouldConnect = true
    if (!this.connected && !this.operationsStream) {
      this.setupShapeStream()
    }

    if (this.awareness && this.awarenessState !== null) {
      this.awareness.setLocalState(this.awarenessState)
      this.awarenessState = null
    }
  }

  private sendOperation(update: Uint8Array) {
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
        url: this.baseUrl,
        params: {
          table: `ydoc_operations`,
          where: `room = '${this.roomName}'`,
        },
        parser: parseToDecoder,
        subscribe: true,
        ...this.resume.operations,
      })

      this.awarenessStream = new ShapeStream({
        url: this.baseUrl,
        params: {
          where: `room = '${this.roomName}'`,
          table: `ydoc_awareness`,
        },
        parser: { ...parseToDecoderLazy, ...paserToTimestamptz },
        ...this.resume.awareness,
      })

      const updateShapeState = (
        name: `operations` | `awareness`,
        offset: Offset,
        handle: string
      ) => {
        this.resume[name] = { offset, handle }
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
            message.headers.control === `up-to-date`
          ) {
            this.synced = true

            if (
              this.operationsStream?.lastOffset &&
              this.operationsStream?.shapeHandle
            ) {
              updateShapeState(
                `operations`,
                this.operationsStream.lastOffset,
                this.operationsStream.shapeHandle
              )
            }
          }
        })
      }

      const unsubscribeSyncHandler =
        this.operationsStream.subscribe(handleSyncMessage)

      const handleAwarenessMessage = (
        messages: Message<AwarenessMessage>[]
      ) => {
        const minTime = new Date(Date.now() - awarenessPingPeriod)
        messages.forEach((message) => {
          if (isChangeMessage(message) && message.value.op) {
            if (message.value.updated < minTime) {
              return
            }

            const decoder = message.value.op()
            awarenessProtocol.applyAwarenessUpdate(
              this.awareness!,
              decoding.readVarUint8Array(decoder),
              this
            )
          }
        })

        if (
          this.awarenessStream?.lastOffset &&
          this.awarenessStream?.shapeHandle
        ) {
          updateShapeState(
            `awareness`,
            this.awarenessStream.lastOffset,
            this.awarenessStream.shapeHandle
          )
        }
      }

      const unsubscribeAwarenessHandler = this.awarenessStream.subscribe(
        handleAwarenessMessage
      )

      this.disconnectShapeHandler = () => {
        this.operationsStream = undefined
        this.awarenessStream = undefined

        if (this.connected) {
          this.lastSyncedStateVector = Y.encodeStateVector(this.doc)
          this.persistence?.set(
            `last_synced_state_vector`,
            this.lastSyncedStateVector
          )

          this.connected = false
          this.synced = false
          this.emit(`status`, [{ status: `disconnected` }])
        }

        unsubscribeSyncHandler()
        unsubscribeAwarenessHandler()
        this.disconnectShapeHandler = undefined
        this.emit(`connection-close`, [])
      }

      const pushLocalChangesUnsubscribe = this.operationsStream!.subscribe(
        () => {
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
          pushLocalChangesUnsubscribe()
        }
      )

      this.emit(`status`, [{ status: `connecting` }])
    }
  }
}
