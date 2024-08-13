/**
 * @module provider/electric
 */

import * as time from "lib0/time"
import { toBase64, fromBase64 } from "lib0/buffer"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { Observable } from "lib0/observable"
import * as url from "lib0/url"
import * as env from "lib0/environment"

export const messageSync = 0
export const messageAwareness = 1

import { ShapeStream } from "@electric-sql/client"

/**
 * @param {ElectricProvider} provider
 */
const setupShapeStream = (provider) => {
  if (provider.shouldConnect && provider.operationsStream === null) {
    provider.connecting = true
    provider.connected = false
    provider.synced = false

    provider.operationsStream = new ShapeStream({
      url: provider.operationsUrl,
    })

    provider.awarenessStream = new ShapeStream({
      url: provider.awarenessUrl,
    })

    const handleMessages = (messages) => {
      provider.lastMessageReceived = time.getUnixTime()
      return messages
        .filter((message) => message[`key`] && message[`value`][`op`])
        .map((message) => message[`value`][`op`])
        .map((operation) => {
          const base64 = fromBase64(operation)
          return decoding.createDecoder(base64)
        })
    }

    const handleSyncMessage = (messages) =>
      handleMessages(messages).forEach((decoder) => {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        const syncMessageType = syncProtocol.readSyncMessage(
          decoder,
          encoder,
          provider.doc,
          provider
        )
        if (
          syncMessageType === syncProtocol.messageYjsSyncStep2 &&
          !provider.synced
        ) {
          provider.synced = true
        }
      })

    const handleAwarenessMessage = (messages) =>
      handleMessages(messages).forEach((decoder) => {
        awarenessProtocol.applyAwarenessUpdate(
          provider.awareness,
          decoding.readVarUint8Array(decoder),
          provider
        )
      })

    // TODO: need to improve error handling
    const handleError = (event) => {
      console.warn(`fetch shape error`, event)
      provider.emit(`connection-error`, [event, provider])
    }

    const unsubscribeSyncHandler = provider.operationsStream.subscribe(
      handleSyncMessage,
      handleError
    )

    const unsubscribeAwarenessHandler = provider.awarenessStream.subscribe(
      handleAwarenessMessage,
      handleError
    )

    provider.closeHandler = (event) => {
      provider.operationsStream = null
      provider.awarenessStream = null
      provider.connecting = false
      if (provider.connected) {
        provider.connected = false
        provider.synced = false

        awarenessProtocol.removeAwarenessStates(
          provider.awareness,
          Array.from(provider.awareness.getStates().keys()).filter(
            (client) => client !== provider.doc.clientID
          ),
          provider
        )
        provider.emit(`status`, [{ status: `disconnected` }])
      }

      unsubscribeSyncHandler()
      unsubscribeAwarenessHandler()
      provider.closeHandler = null
      provider.emit(`connection-close`, [event, provider])
    }

    const handleOperationsFirstSync = () => {
      provider.lastMessageReceived = time.getUnixTime()
      provider.connecting = false
      provider.connected = true
      provider.emit(`status`, [{ status: `connected` }])

      provider.pending
        .splice(0)
        .forEach((update) => sendOperation(provider, update))
    }

    provider.operationsStream.subscribeOnceToUpToDate(
      () => handleOperationsFirstSync(),
      () => handleError()
    )

    const handleAwarenessFirstSync = () => {
      if (provider.awareness.getLocalState() !== null) {
        sendAwareness(provider, [provider.doc.clientID])
      }
    }

    provider.awarenessStream.subscribeOnceToUpToDate(
      () => handleAwarenessFirstSync(),
      () => handleError()
    )

    provider.emit(`status`, [{ status: `connecting` }])
  }
}

/**
 * @param {ElectricProvider} provider
 * @param {Uint8Array} op
 */
const sendOperation = async (provider, update) => {
  if (!(provider.connected && provider.operationsStream !== null)) {
    provider.pending.push(update)
  } else {
    const encoder = encoding.createEncoder()
    syncProtocol.writeUpdate(encoder, update)
    const op = toBase64(encoding.toUint8Array(encoder))
    const name = provider.roomname

    await fetch(`/api/operation`, {
      method: `POST`,
      body: JSON.stringify({ name, op }),
    })
  }
}

/**
 * @param {ElectricProvider} provider
 * @param {Uint8Array} op
 */
const sendAwareness = async (provider, changedClients) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(provider.awareness, changedClients)
  )
  const op = toBase64(encoding.toUint8Array(encoder))

  if (provider.connected && provider.operationsStream !== null) {
    const name = provider.roomname
    const clientID = `${provider.doc.clientID}`

    await fetch(`/api/awareness`, {
      method: `POST`,
      body: JSON.stringify({ client: clientID, name, op }),
    })
  }
}

export class ElectricProvider extends Observable {
  /**
   * @param {string} serverUrl
   * @param {string} roomname
   * @param {Y.Doc} doc
   * @param {object} opts
   * @param {boolean} [opts.connect]
   * @param {awarenessProtocol.Awareness} [opts.awareness]
   * @param {Object<string,string>} [opts.params] specify url parameters
   */
  constructor(
    serverUrl,
    roomname,
    doc,
    { connect = true, awareness = new awarenessProtocol.Awareness(doc) } = {}
  ) {
    super()

    this.serverUrl = serverUrl
    this.roomname = roomname
    this.doc = doc
    this.awareness = awareness
    this.connected = false
    this.connecting = false
    this._synced = false

    this.lastMessageReceived = 0
    this.shouldConnect = connect

    this.operationsStream = null
    this.awarenessStream = null

    this.pending = []

    this.closeHandler = null

    /**
     * Listens to Yjs updates and sends to the backend
     * @param {Uint8Array} update
     * @param {any} origin
     */
    this._updateHandler = (update, origin) => {
      if (origin !== this) {
        sendOperation(this, update)
      }
    }
    this.doc.on(`update`, this._updateHandler)

    /**
     * @param {any} changed
     * @param {any} origin
     */
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      if (origin === `local`) {
        const changedClients = added.concat(updated).concat(removed)
        sendAwareness(this, changedClients)
      }
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

  get operationsUrl() {
    const params = { where: `name = '${this.roomname}'` }
    const encodedParams = url.encodeQueryParams(params)
    return this.serverUrl + `/v1/shape/ydoc_operations?` + encodedParams
  }

  get awarenessUrl() {
    const params = { where: `name = '${this.roomname}'` }
    const encodedParams = url.encodeQueryParams(params)
    return this.serverUrl + `/v1/shape/ydoc_awareness?` + encodedParams
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
    if (!this.connected && this.operationsStream === null) {
      setupShapeStream(this)
    }
  }
}
