import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import { ObservableV2 } from 'lib0/observable'
import * as env from 'lib0/environment'
import * as Y from 'yjs'
import {
  GetExtensions,
  isChangeMessage,
  isControlMessage,
  Message,
  Offset,
  Row,
  ShapeStream,
  ShapeStreamOptions,
} from '@electric-sql/client'
import {
  YProvider,
  ResumeState,
  SendErrorRetryHandler,
  ElectricProviderOptions,
} from './types'

type AwarenessUpdate = {
  added: number[]
  updated: number[]
  removed: number[]
}

export class ElectricProvider<
  RowWithDocumentUpdate extends Row<decoding.Decoder> = never,
  RowWithAwarenessUpdate extends Row<decoding.Decoder> = never,
> extends ObservableV2<YProvider> {
  private doc: Y.Doc

  private documentUpdates: {
    shape: ShapeStreamOptions<GetExtensions<RowWithDocumentUpdate>>
    sendUrl: string | URL
    getUpdateFromRow: (row: RowWithDocumentUpdate) => decoding.Decoder
    sendErrorRetryHandler?: SendErrorRetryHandler
  }

  private awarenessUpdates?: {
    shape: ShapeStreamOptions<GetExtensions<RowWithAwarenessUpdate>>
    sendUrl: string | URL
    protocol: awarenessProtocol.Awareness
    getUpdateFromRow: (row: RowWithAwarenessUpdate) => decoding.Decoder
    sendErrorRetryHandler?: SendErrorRetryHandler
  }

  private _connected: boolean = false
  private _synced: boolean = false

  private resumeState: ResumeState
  private sendingPendingChanges: boolean = false
  private pendingChanges: Uint8Array | null = null
  private sendingAwarenessState: boolean = false
  private pendingAwarenessUpdate: AwarenessUpdate | null = null
  private debounceMs: number
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  private documentUpdateHandler: (
    update: Uint8Array,
    origin: unknown,
    doc: Y.Doc,
    transaction: Y.Transaction
  ) => void
  private awarenessUpdateHandler?: (
    update: AwarenessUpdate,
    origin: unknown
  ) => void

  private exitHandler: () => void
  private unsubscribeShapes?: () => void

  private fetchClient?: typeof fetch

  /**
   * Creates a new ElectricProvider instance that connects YJS documents to Electric SQL.
   *
   * @constructor
   * @param {ElectricProviderOptions} options - Configuration options for the provider
   * @param {Y.Doc} options.doc - The YJS document to be synchronized
   * @param {Object} options.documentUpdates - Document updates configuration
   * @param {ShapeStreamOptions} options.documentUpdates.shape - Options for the document updates shape stream
   * @param {string|URL} options.documentUpdates.sendUrl - URL endpoint for sending document updates
   * @param {Function} options.documentUpdates.getUpdateFromRow - Function to extract document update from row
   * @param {SendErrorRetryHandler} [options.documentUpdates.sendErrorRetryHandler] - Error handler for retrying document updates
   * @param {Object} [options.awarenessUpdates] - Awareness updates configuration (optional)
   * @param {ShapeStreamOptions} options.awarenessUpdates.shape - Options for the awareness updates shape stream
   * @param {string|URL} options.awarenessUpdates.sendUrl - URL endpoint for sending awareness updates
   * @param {awarenessProtocol.Awareness} options.awarenessUpdates.protocol - Awareness protocol instance
   * @param {Function} options.awarenessUpdates.getUpdateFromRow - Function to extract awareness update from row
   * @param {SendErrorRetryHandler} [options.awarenessUpdates.sendErrorRetryHandler] - Error handler for retrying awareness updates
   * @param {ResumeState} [options.resumeState] - Resume state for the provider
   * @param {boolean} [options.connect=true] - Whether to automatically connect upon initialization
   * @param {typeof fetch} [options.fetchClient] - Custom fetch implementation to use for HTTP requests
   * @param {number} [options.debounceMs] - Debounce window in milliseconds for sending document updates. If 0 or undefined, debouncing is disabled.
   */
  constructor({
    doc,
    documentUpdates: documentUpdatesConfig,
    awarenessUpdates: awarenessUpdatesConfig,
    resumeState,
    connect = true,
    fetchClient,
    debounceMs,
  }: ElectricProviderOptions<RowWithDocumentUpdate, RowWithAwarenessUpdate>) {
    super()

    this.doc = doc
    this.documentUpdates = documentUpdatesConfig
    this.awarenessUpdates = awarenessUpdatesConfig
    this.resumeState = resumeState ?? {}
    this.debounceMs = debounceMs ?? 0

    this.fetchClient = fetchClient

    this.exitHandler = () => {
      if (env.isNode && typeof process !== `undefined`) {
        process.on(`exit`, this.destroy.bind(this))
      }
    }

    this.documentUpdateHandler = this.doc.on(
      `update`,
      this.applyDocumentUpdate.bind(this)
    )
    if (this.awarenessUpdates) {
      this.awarenessUpdateHandler = this.applyAwarenessUpdate.bind(this)
      this.awarenessUpdates.protocol.on(`update`, this.awarenessUpdateHandler!)
    }

    // enqueue unsynced changes from document if the
    // resume state provides the document state vector
    if (this.resumeState?.stableStateVector) {
      this.pendingChanges = Y.encodeStateAsUpdate(
        this.doc,
        this.resumeState.stableStateVector
      )
    }

    if (connect) {
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
    if (this.pendingChanges) {
      this.pendingChanges = Y.mergeUpdates([this.pendingChanges, update])
    } else {
      this.pendingChanges = update
    }
  }

  private clearDebounceTimer() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private scheduleSendOperations() {
    if (this.debounceMs > 0) {
      if (this.debounceTimer === null) {
        this.debounceTimer = setTimeout(async () => {
          this.debounceTimer = null
          await this.sendOperations()
          if (
            this.pendingChanges &&
            this.connected &&
            !this.sendingPendingChanges
          ) {
            this.scheduleSendOperations()
          }
        }, this.debounceMs)
      }
    } else {
      this.sendOperations()
    }
  }

  destroy() {
    this.clearDebounceTimer()
    this.disconnect()

    this.doc.off(`update`, this.documentUpdateHandler)
    this.awarenessUpdates?.protocol.off(`update`, this.awarenessUpdateHandler!)

    if (env.isNode && typeof process !== `undefined`) {
      process.off(`exit`, this.exitHandler!)
    }
    super.destroy()
  }

  disconnect() {
    // Flush any pending changes before disconnecting
    this.clearDebounceTimer()
    if (this.pendingChanges && this.connected) {
      this.sendOperations()
    }

    this.unsubscribeShapes?.()

    if (!this.connected) {
      return
    }

    if (this.awarenessUpdates) {
      awarenessProtocol.removeAwarenessStates(
        this.awarenessUpdates.protocol,
        Array.from(this.awarenessUpdates.protocol.getStates().keys()).filter(
          (client) => client !== this.awarenessUpdates!.protocol.clientID
        ),
        this
      )

      // try to notifying other clients that we are disconnecting
      awarenessProtocol.removeAwarenessStates(
        this.awarenessUpdates.protocol,
        [this.awarenessUpdates.protocol.clientID],
        `local`
      )

      this.awarenessUpdates.protocol.setLocalState({})
    }

    // TODO: await for events before closing
    this.emit(`connection-close`, [])

    this.pendingAwarenessUpdate = null

    this.connected = false
    this.synced = false
  }

  connect() {
    if (this.connected) {
      return
    }
    const abortController = new AbortController()

    const operationsStream = new ShapeStream<RowWithDocumentUpdate>({
      ...this.documentUpdates.shape,
      ...this.resumeState.document,
      signal: abortController.signal,
    })

    const operationsShapeUnsubscribe = operationsStream.subscribe(
      (messages: Message<RowWithDocumentUpdate>[]) => {
        this.operationsShapeHandler(
          messages,
          operationsStream.lastOffset,
          operationsStream.shapeHandle!
        )
      }
    )

    let awarenessShapeUnsubscribe: () => void | undefined
    if (this.awarenessUpdates) {
      const awarenessStream = new ShapeStream<RowWithAwarenessUpdate>({
        ...this.awarenessUpdates.shape,
        signal: abortController.signal,
        offset: `now`,
      })

      awarenessShapeUnsubscribe = awarenessStream.subscribe(
        (messages: Message<RowWithAwarenessUpdate>[]) => {
          this.awarenessShapeHandler(messages)
        }
      )
    }

    this.unsubscribeShapes = () => {
      abortController.abort()
      operationsShapeUnsubscribe()
      awarenessShapeUnsubscribe?.()
      this.unsubscribeShapes = undefined
    }

    this.emit(`status`, [{ status: `connecting` }])
  }

  private operationsShapeHandler(
    messages: Message<RowWithDocumentUpdate>[],
    offset: Offset,
    handle: string
  ) {
    for (const message of messages) {
      if (isChangeMessage(message)) {
        const decoder = this.documentUpdates.getUpdateFromRow(message.value)
        while (decoder.pos !== decoder.arr.length) {
          const operation = decoding.readVarUint8Array(decoder)
          Y.applyUpdate(this.doc, operation, `server`)
        }
      } else if (
        isControlMessage(message) &&
        message.headers.control === `up-to-date`
      ) {
        this.resumeState.document = {
          offset,
          handle,
        }

        if (!this.sendingPendingChanges) {
          this.synced = true
          this.resumeState.stableStateVector = Y.encodeStateVector(this.doc)
        }
        this.emit(`resumeState`, [this.resumeState])
        this.connected = true
      }
    }
  }

  private async applyDocumentUpdate(update: Uint8Array, origin: unknown) {
    // don't re-send updates from electric
    if (origin === `server`) {
      return
    }

    this.batch(update)
    this.scheduleSendOperations()
  }

  private async sendOperations() {
    this.clearDebounceTimer()

    if (!this.connected || this.sendingPendingChanges) {
      return
    }

    try {
      this.sendingPendingChanges = true
      while (
        this.pendingChanges &&
        this.pendingChanges.length > 2 &&
        this.connected
      ) {
        const sending = this.pendingChanges
        this.pendingChanges = null

        const encoder = encoding.createEncoder()
        encoding.writeVarUint8Array(encoder, sending)

        const success = await send(
          encoder,
          this.documentUpdates.sendUrl,
          this.fetchClient ?? fetch,
          this.documentUpdates.sendErrorRetryHandler
        )
        if (!success) {
          this.batch(sending)
          this.disconnect()
        }
      }
      // no more pending changes, move stableStateVector forward
      this.resumeState.stableStateVector = Y.encodeStateVector(this.doc)
      this.emit(`resumeState`, [this.resumeState])
    } finally {
      this.sendingPendingChanges = false
    }
  }

  private async applyAwarenessUpdate(
    awarenessUpdate: AwarenessUpdate,
    origin: unknown
  ) {
    if (origin !== `local` || !this.connected) {
      return
    }

    this.pendingAwarenessUpdate = awarenessUpdate

    if (this.sendingAwarenessState) {
      return
    }

    this.sendingAwarenessState = true

    try {
      while (this.pendingAwarenessUpdate && this.connected) {
        const update = this.pendingAwarenessUpdate
        this.pendingAwarenessUpdate = null

        const { added, updated, removed } = update
        const changedClients = added.concat(updated).concat(removed)
        const encoder = encoding.createEncoder()

        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            this.awarenessUpdates!.protocol,
            changedClients
          )
        )
        const success = await send(
          encoder,
          this.awarenessUpdates!.sendUrl,
          this.fetchClient ?? fetch,
          this.awarenessUpdates!.sendErrorRetryHandler
        )
        if (!success) {
          this.disconnect()
        }
      }
    } finally {
      this.sendingAwarenessState = false
    }
  }

  private awarenessShapeHandler(messages: Message<RowWithAwarenessUpdate>[]) {
    for (const message of messages) {
      if (isChangeMessage(message)) {
        if (message.headers.operation === `delete`) {
          awarenessProtocol.removeAwarenessStates(
            this.awarenessUpdates!.protocol,
            [Number(message.value.client_id)],
            `remote`
          )
        } else {
          const decoder = this.awarenessUpdates!.getUpdateFromRow(message.value)
          awarenessProtocol.applyAwarenessUpdate(
            this.awarenessUpdates!.protocol,
            decoding.readVarUint8Array(decoder),
            this
          )
        }
      }
    }
  }
}

async function send(
  encoder: encoding.Encoder,
  endpoint: string | URL,
  fetchClient: typeof fetch,
  retryHandler?: SendErrorRetryHandler
): Promise<boolean> {
  let response: Response | undefined
  const op = encoding.toUint8Array(encoder)

  try {
    response = await fetchClient(endpoint!, {
      method: `PUT`,
      headers: {
        'Content-Type': `application/octet-stream`,
      },
      body: op as BodyInit,
    })

    if (!response.ok) {
      throw new Error(`Server did not return 2xx`)
    }

    return true
  } catch (error) {
    const shouldRetry = await (retryHandler?.({
      response,
      error,
    }) ?? false)
    return shouldRetry
  }
}
