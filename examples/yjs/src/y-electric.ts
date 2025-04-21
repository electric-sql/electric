import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { Observable, ObservableV2 } from "lib0/observable"
import * as env from "lib0/environment"
import * as Y from "yjs"
import {
  isChangeMessage,
  isControlMessage,
  Message,
  Offset,
  ShapeStream,
} from "@electric-sql/client"
import {
  AwarenessMessage,
  AwarenessSteamOptions,
  YProvider,
  OperationMessage,
  OperationSteamOptions,
  ResumeState,
  ResumeStateProvider,
} from "./types"

type AwarenessUpdate = {
  added: number[]
  updated: number[]
  removed: number[]
}

export class ElectricProvider<
  OperationsShapeOptions extends OperationSteamOptions = OperationSteamOptions,
  AwarenessShapeOptions extends AwarenessSteamOptions = AwarenessSteamOptions,
> extends ObservableV2<YProvider> {
  private doc: Y.Doc

  private operations: {
    options: OperationSteamOptions
    endpoint: string
  }

  private awareness?: {
    options: AwarenessSteamOptions
    endpoint: string
    protocol: awarenessProtocol.Awareness
  }

  private resumeStateProvider?: ResumeStateProvider
  private resume: ResumeState

  private _ready: boolean
  private _connected: boolean
  private _synced: boolean

  private sendingAwarenessState: boolean = false
  private pendingAwarenessUpdate: AwarenessUpdate | null = null

  private operationsHandler: (update: Uint8Array, origin: unknown) => void
  private awarenessHandler: (update: AwarenessUpdate, origin: unknown) => void
  private unsubscribeShapes?: () => void
  private exitHandler?: () => void

  private onSendError?: (error: unknown, context: string) => Promise<boolean>

  private fetchClient?: typeof fetch

  // TODO: implement database provider for Electric
  // - Keep document state in same place as shape resume state
  // - Compute diff from local update state instead of persisting
  //   the batch of pending changes

  /**
   * Creates a new ElectricProvider instance that connects YJS documents to Electric SQL.
   *
   * @constructor
   * @param {Object} options - Configuration options for the provider
   * @param {Y.Doc} options.doc - The YJS document to be synchronized
   * @param {OperationsShapeOptions} options.operations.options - Options for the operations shape stream
   * @param {string} options.operations.endpoint - URL endpoint for sending operations
   * @param {AwarenessShapeOptions} options.awareness.options - Options for the awareness shape stream
   * @param {string} options.awareness.endpoint - URL endpoint for sending awareness states
   * @param {awarenessProtocol.Awareness} options.awareness.protocol - The awareness protocol implementation
   * @param {ResumeStateProvider} [options.resumeStateProvider] - Alternatively, you can use a provider for loading/saving resume state
   * @param {Observable<string>} [options.databaseProvider] - Observable for loading/saving document state (e.g. IndexeddbPersistence)
   * @param {boolean} [options.connect=true] - Whether to automatically connect upon initialization
   * @param {Function} [options.onSendError] - Error handler for sending operations/awareness changes
   * @param {Function} [options.fetchClient] - Custom fetch implementation to use for sending operations/awareness changes
   */
  constructor({
    doc,
    operations,
    awareness,
    resumeStateProvider,
    databaseProvider,
    connect = true,
    onSendError,
    fetchClient,
  }: {
    doc: Y.Doc
    operations: {
      options: OperationsShapeOptions
      endpoint: string
    }
    awareness?: {
      options: AwarenessShapeOptions
      endpoint: string
      protocol: awarenessProtocol.Awareness
    }
    resumeStateProvider?: ResumeStateProvider
    databaseProvider?: Observable<string>
    connect?: boolean
    onSendError?: (error: unknown, context: string) => Promise<boolean>
    fetchClient?: typeof fetch
  }) {
    super()

    this.doc = doc
    this.operations = operations

    if (onSendError) {
      this.onSendError = onSendError
    }
    this.awareness = awareness

    this.fetchClient = fetchClient
    this.resumeStateProvider = resumeStateProvider

    this._ready = false
    this._connected = false
    this._synced = false

    this.resume = this.resumeStateProvider?.load() ?? {}

    // recovery
    if (this.resume.batching || this.resume.sending) {
      console.log(`recover from unfinished push`)
      if (this.resume.sending) {
        this.batch(this.resume.sending)
      }
      this.resumeStateProvider?.save(this.resume)
    }

    this.operationsHandler = (update, origin) => {
      // don't re-send updates from electric
      if (origin === `server`) {
        return
      }

      this.batch(update)
      this.sendOperations()
    }

    this.awarenessHandler = (update, origin) =>
      this.sendAwarenessState(update, origin)

    if (env.isNode && typeof process !== `undefined`) {
      this.exitHandler = () => {
        process.on(`exit`, () => this.destroy())
      }
    }

    if (databaseProvider) {
      databaseProvider.once(`synced`, () => {
        this.ready = true
        if (connect) {
          this.connect()
        }
      })
    } else {
      this.ready = true
      if (connect) {
        this.connect()
      }
    }
  }

  set ready(state: boolean) {
    if (state) {
      this._ready = true
      this.doc.on(`update`, this.operationsHandler)
      this.awareness?.protocol.on(`update`, this.awarenessHandler)
    } else {
      this.doc.off(`update`, this.operationsHandler)
      this.awareness?.protocol.off(`update`, this.awarenessHandler)
    }
  }

  get ready() {
    return this._ready
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

  set connected(state) {
    if (this._connected !== state) {
      this._connected = state
      if (state) {
        this.sendOperations()
      }
      this.emit(`status`, [{ status: state ? `connected` : `disconnected` }])
    }
  }

  get connected() {
    return this._connected
  }

  private batch(update: Uint8Array) {
    if (this.resume.batching) {
      this.resume.batching = Y.mergeUpdates([this.resume.batching, update])
    } else {
      this.resume.batching = update
    }
    this.resumeStateProvider?.save(this.resume)
  }

  destroy() {
    this.disconnect()
    this.ready = false

    if (env.isNode && typeof process !== `undefined`) {
      process.off(`exit`, this.exitHandler!)
    }
    super.destroy()
  }

  disconnect() {
    this.unsubscribeShapes?.()

    if (!this.connected) {
      return
    }

    if (this.awareness) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness.protocol,
        Array.from(this.awareness.protocol.getStates().keys()).filter(
          (client) => client !== this.doc.clientID
        ),
        this
      )

      // try to notifying other clients that we are disconnecting
      awarenessProtocol.removeAwarenessStates(
        this.awareness.protocol,
        [this.doc.clientID],
        `local`
      )

      this.awareness.protocol.setLocalState({})
    }

    this.emit(`connection-close`, [])

    this.pendingAwarenessUpdate = null

    this.connected = false
    this.synced = false
  }

  connect() {
    if (!this.ready || this.connected) {
      return
    }
    const abortController = new AbortController()

    const operationsStream = new ShapeStream<OperationMessage>({
      ...this.operations.options,
      ...this.resume.operations,
      signal: abortController.signal,
    })

    const operationsShapeUnsubscribe = operationsStream.subscribe(
      (messages) => {
        this.operationsShapeHandler(
          messages,
          operationsStream.lastOffset,
          operationsStream.shapeHandle!
        )
      }
    )

    let awarenessShapeUnsubscribe: () => void | undefined
    if (this.awareness) {
      const awarenessStream = new ShapeStream<AwarenessMessage>({
        ...this.awareness.options,
        ...this.resume.awareness,
        signal: abortController.signal,
      })

      awarenessShapeUnsubscribe = awarenessStream.subscribe((messages) => {
        this.awarenessShapeHandler(
          messages,
          awarenessStream.lastOffset,
          awarenessStream.shapeHandle!
        )
      })
    }

    this.unsubscribeShapes = () => {
      abortController.abort()
      operationsShapeUnsubscribe()

      if (this.awareness) {
        awarenessShapeUnsubscribe()
      }

      this.unsubscribeShapes = undefined
    }

    this.emit(`status`, [{ status: `connecting` }])
  }

  private async sendOperations() {
    if (!this.connected || this.resume.sending) {
      return
    }

    try {
      while (this.resume.batching && this.resume.batching.length > 2) {
        this.resume.sending = this.resume.batching
        this.resume.batching = undefined

        const encoder = encoding.createEncoder()
        syncProtocol.writeUpdate(encoder, this.resume.sending)

        const success = await this.send(encoder, `operations`)
        if (!success) {
          this.batch(this.resume.sending)
          throw new Error(`Failed to send changes`)
        }
        this.resumeStateProvider?.save(this.resume)
      }
    } finally {
      this.resume.sending = undefined
    }
  }

  private operationsShapeHandler(
    messages: Message<OperationMessage>[],
    offset: Offset,
    handle: string
  ) {
    for (const message of messages) {
      if (isChangeMessage(message) && message.value.op) {
        const decoder = message.value.op
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, 0)

        while (decoder.pos !== decoder.arr.length) {
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, `server`)
        }
      } else if (
        isControlMessage(message) &&
        message.headers.control === `up-to-date`
      ) {
        this.resume.operations = {
          offset,
          handle,
        }
        this.resumeStateProvider?.save(this.resume)
        this.synced = true
        this.connected = true
      }
    }
  }

  private async sendAwarenessState(
    awarenessUpdate: AwarenessUpdate,
    origin: unknown
  ) {
    if (origin !== `local` || !this.connected || !this.awareness) {
      return
    }

    if (this.sendingAwarenessState) {
      this.pendingAwarenessUpdate = awarenessUpdate
      return
    }

    this.sendingAwarenessState = true

    try {
      let update: AwarenessUpdate | null = awarenessUpdate

      while (update && this.connected) {
        const { added, updated, removed } = update
        const changedClients = added.concat(updated).concat(removed)
        const encoder = encoding.createEncoder()

        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            this.awareness.protocol,
            changedClients
          )
        )
        await this.send(encoder, `awareness`)

        update = this.pendingAwarenessUpdate
        this.pendingAwarenessUpdate = null
      }
    } finally {
      this.sendingAwarenessState = false
    }
  }

  private awarenessShapeHandler(
    messages: Message<AwarenessMessage>[],
    offset: Offset,
    handle: string
  ) {
    if (!this.awareness) {
      return
    }

    for (const message of messages) {
      if (isChangeMessage(message)) {
        if (message.headers.operation === `delete`) {
          awarenessProtocol.removeAwarenessStates(
            this.awareness.protocol,
            [Number(message.value.client_id)],
            `remote`
          )
        } else {
          const decoder = message.value.op
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness.protocol,
            decoding.readVarUint8Array(decoder),
            this
          )
        }
      } else if (
        isControlMessage(message) &&
        message.headers.control === `up-to-date`
      ) {
        this.resume.awareness = {
          offset: offset,
          handle: handle,
        }
        this.resumeStateProvider?.save(this.resume)
      }
    }
  }

  private async send(
    encoder: encoding.Encoder,
    endpointType: `operations` | `awareness`
  ): Promise<boolean> {
    const op = encoding.toUint8Array(encoder)

    const endpoint =
      endpointType === `operations`
        ? this.operations.endpoint
        : this.awareness?.endpoint

    let badResponse = false
    try {
      const response = await (this.fetchClient ?? fetch)(endpoint!, {
        method: `PUT`,
        headers: {
          "Content-Type": `application/octet-stream`,
        },
        body: op,
      })

      if (!response.ok) {
        badResponse = true
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
      }

      return true
    } catch (error) {
      if (!badResponse) {
        const shouldRetry = await (this.onSendError?.(error, endpointType) ??
          false)
        if (!shouldRetry) {
          this.disconnect()
        }
        return shouldRetry
      }
      throw error
    }
  }
}
