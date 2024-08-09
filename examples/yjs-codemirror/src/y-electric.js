/**
 * @module provider/websocket
 */

/* eslint-env browser */

import * as Y from 'yjs' // eslint-disable-line
import * as time from "lib0/time"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { Observable } from "lib0/observable"
import * as url from "lib0/url"
import * as env from "lib0/environment"

export const messageSync = 0
export const messageQueryAwareness = 3
export const messageAwareness = 1

import { ShapeStream } from "@electric-sql/client"

// Check if we can handle encoding another way
import { Base64 } from "js-base64"

/**
 *                       encoder,          decoder,          provider,          emitSynced, messageType
 * @type {Array<function(encoding.Encoder, decoding.Decoder, ElectricProvider, boolean,    number):void>}
 */
const messageHandlers = []

messageHandlers[messageSync] = (
  encoder,
  decoder,
  provider,
  emitSynced,
  _messageType
) => {
  encoding.writeVarUint(encoder, messageSync)
  const syncMessageType = syncProtocol.readSyncMessage(
    decoder,
    encoder,
    provider.doc,
    provider
  )
  if (
    emitSynced &&
    syncMessageType === syncProtocol.messageYjsSyncStep2 &&
    !provider.synced
  ) {
    provider.synced = true
  }
}

messageHandlers[messageQueryAwareness] = (
  encoder,
  _decoder,
  provider,
  _emitSynced,
  _messageType
) => {
  encoding.writeVarUint(encoder, messageAwareness)
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      provider.awareness,
      Array.from(provider.awareness.getStates().keys())
    )
  )
}

messageHandlers[messageAwareness] = (
  _encoder,
  decoder,
  provider,
  _emitSynced,
  _messageType
) => {
  awarenessProtocol.applyAwarenessUpdate(
    provider.awareness,
    decoding.readVarUint8Array(decoder),
    provider
  )
}

/**
 * @param {ElectricProvider} provider
 */
const setupShapeStream = (provider) => {
  if (provider.shouldConnect && provider.stream === null) {
    provider.connecting = true
    provider.connected = false
    provider.synced = false

    provider.stream = new ShapeStream({
      url: provider.url,
      signal: new AbortController().signal,
    })

    const readMessage = (provider, buf, emitSynced) => {
      const decoder = decoding.createDecoder(buf)
      const encoder = encoding.createEncoder()
      const messageType = decoding.readVarUint(decoder)
      const messageHandler = provider.messageHandlers[messageType]
      if (/** @type {any} */ (messageHandler)) {
        messageHandler(encoder, decoder, provider, emitSynced, messageType)
      } else {
        console.error(`Unable to compute message`)
      }
      return encoder
    }

    const handleSyncMessage = (messages) => {
      provider.lastMessageReceived = time.getUnixTime()
      messages.forEach((message) => {
        if (message[`key`]) {
          const buf = Base64.toUint8Array(message[`value`][`op`])
          readMessage(provider, buf, true)
        }
      })
    }

    const handleError = (event) => {
      console.warn(`fetch shape error`, event)
      provider.emit(`connection-error`, [event, provider])
    }

    const unsubscribeSyncHandler = provider.stream.subscribe(
      handleSyncMessage,
      handleError
    )

    if (provider.awareness.getLocalState() !== null) {
      const encoderAwarenessState = encoding.createEncoder()
      encoding.writeVarUint(encoderAwarenessState, messageAwareness)
      encoding.writeVarUint8Array(
        encoderAwarenessState,
        awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [
          provider.doc.clientID,
        ])
      )
      // websocket.send(encoding.toUint8Array(encoderAwarenessState))
    }

    provider.closeHandler = (event) => {
      provider.stream = null
      provider.connecting = false
      if (provider.connected) {
        provider.connected = false
        provider.synced = false
        // update awareness (all users except local left)
        awarenessProtocol.removeAwarenessStates(
          provider.awareness,
          Array.from(provider.awareness.getStates().keys()).filter(
            (client) => client !== provider.doc.clientID
          ),
          provider
        )
        provider.emit(`status`, [
          {
            status: `disconnected`,
          },
        ])
      }

      unsubscribeSyncHandler()
      provider.closeHandler = null
      provider.emit(`connection-close`, [event, provider])
    }

    const handleOnceUpToDate = () => {
      provider.lastMessageReceived = time.getUnixTime()
      provider.connecting = false
      provider.connected = true
      provider.emit(`status`, [
        {
          status: `connected`,
        },
      ])

      provider.pending
        .splice(0)
        .forEach((buf) => broadcastMessage(provider, buf))
    }

    provider.stream.subscribeOnceToUpToDate(
      () => handleOnceUpToDate(),
      () => handleError()
    )

    provider.emit(`status`, [
      {
        status: `connecting`,
      },
    ])
  }
}

/**
 * @param {ElectricProvider} provider
 * @param {Uint8Array} buf
 */
const broadcastMessage = (provider, buf) => {
  if (provider.connected && provider.stream !== null) {
    const clientId = provider.doc.clientID
    const name = provider.roomname
    const op = Base64.fromUint8Array(buf)

    const mutation = {
      action: `insert`,
      schema: `public`,
      tablename: `ydoc_updates`,
      row: { name, op },
    }
    const req = buildRequest(clientId, new Date().getTime(), [mutation])
    fetch(req)
  }
}

function buildRequest(clientId, requestId, mutations) {
  const url = `http://localhost:8080/`
  return new Request(url, {
    method: `POST`,
    headers: {
      "Content-Type": `application/json`,
      "X-Electric-Request-Id": requestId,
      "X-Electric-User-Id": clientId, // TODO: drop this
    },
    body: JSON.stringify(mutations),
  })
}

/**
 * Websocket Provider for Yjs. Creates a websocket connection to sync the shared document.
 * The document name is attached to the provided url. I.e. the following example
 * creates a websocket connection to http://localhost:1234/my-document-name
 *
 * @example
 *   import * as Y from 'yjs'
 *   import { ElectricProvider } from 'y-websocket'
 *   const doc = new Y.Doc()
 *   const provider = new ElectricProvider('http://localhost:1234', 'my-document-name', doc)
 *
 * @extends {Observable<string>}
 */
export class ElectricProvider extends Observable {
  /**
   * @param {string} serverUrl
   * @param {string} roomname
   * @param {Y.Doc} doc
   * @param {object} opts
   * @param {boolean} [opts.connect]
   * @param {awarenessProtocol.Awareness} [opts.awareness]
   * @param {Object<string,string>} [opts.params] specify url parameters
   * @param {Array<string>} [opts.protocols] specify websocket protocols
   * @param {number} [opts.maxBackoffTime] Maximum amount of time to wait before trying to reconnect (we try to reconnect using exponential backoff)
   */
  constructor(
    serverUrl,
    roomname,
    doc,
    { connect = true, awareness = new awarenessProtocol.Awareness(doc) } = {}
  ) {
    super()
    // ensure that url is always ends with /
    while (serverUrl[serverUrl.length - 1] === `/`) {
      serverUrl = serverUrl.slice(0, serverUrl.length - 1)
    }
    this.serverUrl = serverUrl
    this.roomname = roomname
    this.doc = doc
    this.awareness = awareness
    this.connected = false
    this.connecting = false

    this.messageHandlers = messageHandlers.slice()
    /**
     * @type {boolean}
     */
    this._synced = false

    this.lastMessageReceived = 0
    /**
     * Whether to connect to other peers or not
     * @type {boolean}
     */
    this.shouldConnect = connect

    /**
     * @type {ShapeStream?}
     */

    this.stream = null

    this.pending = []

    this.closeHandler = null

    /**
     * Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._updateHandler = (update, origin) => {
      // TODO would be nice to skip updates that are already included
      if (origin !== this) {
        if (!this.connected) {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.writeUpdate(encoder, update)

          this.pending.push(encoding.toUint8Array(encoder))
        } else {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.writeUpdate(encoder, update)
          broadcastMessage(this, encoding.toUint8Array(encoder))
        }
      }
    }
    this.doc.on(`update`, this._updateHandler)

    /**
     * @param {any} changed
     * @param {any} _origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, _origin) => {
      const changedClients = added.concat(updated).concat(removed)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      )
      // broadcastMessage(this, encoding.toUint8Array(encoder))
    }
    this._exitHandler = () => {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [doc.clientID],
        `app closed`
      )
    }
    if (env.isNode && typeof process !== `undefined`) {
      process.on(`exit`, this._exitHandler)
    }
    awareness.on(`update`, this._awarenessUpdateHandler)

    if (connect) {
      this.connect()
    }
  }

  get url() {
    const params = { where: `name = '${this.roomname}'` }
    const encodedParams = url.encodeQueryParams(params)
    return this.serverUrl + `/v1/shape/ydoc_updates?` + encodedParams
  }

  /**
   * @type {boolean}
   */
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

  destroy() {
    this.disconnect()
    if (env.isNode && typeof process !== `undefined`) {
      process.off(`exit`, this._exitHandler)
    }
    this.awareness.off(`update`, this._awarenessUpdateHandler)
    this.doc.off(`update`, this._updateHandler)
    super.destroy()
  }

  disconnect() {
    this.shouldConnect = false
    this.closeHandler()
  }

  connect() {
    this.shouldConnect = true
    if (!this.connected && this.stream === null) {
      setupShapeStream(this)
    }
  }
}
