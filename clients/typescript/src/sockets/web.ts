import { ConnectionOptions, Data, Socket, SocketFactory } from '.'
import { SatelliteError, SatelliteErrorCode } from '../util'

export class WebSocketWebFactory implements SocketFactory {
  create(): WebSocketWeb {
    return new WebSocketWeb()
  }
}

// FIXME: This implementation is a bit contrived because it is not using EventEmitter
export class WebSocketWeb implements Socket {
  private socket?: WebSocket

  private connectCallbacks: (() => void)[] = []
  private errorCallbacks: ((error: SatelliteError) => void)[] = []
  private onceErrorCallbacks: ((error: SatelliteError) => void)[] = []

  // event doesn't provide much
  private errorListener = () => {
    for (const callback of this.errorCallbacks) {
      callback(
        new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error')
      )
    }

    let callback: ((error: SatelliteError) => void) | undefined
    while ((callback = this.onceErrorCallbacks.pop())) {
      callback(
        new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error')
      )
    }
  }

  private connectListener = () => {
    let callback: (() => void) | undefined
    while ((callback = this.connectCallbacks.pop())) {
      callback()
    }
  }
  private messageListener?: (event: MessageEvent<any>) => void
  private closeListener?: () => void

  open(opts: ConnectionOptions): this {
    if (this.socket) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'trying to open a socket before closing existing socket'
      )
    }

    this.socket = new WebSocket(opts.url)
    this.socket.binaryType = 'arraybuffer'

    this.socket.addEventListener('open', this.connectListener)

    this.socket.addEventListener('error', this.errorListener)

    return this
  }

  write(data: Data): this {
    this.socket?.send(data)
    return this
  }

  closeAndRemoveListeners(): this {
    this.socket?.removeEventListener('error', this.errorListener)
    if (this.messageListener)
      this.socket?.removeEventListener('message', this.messageListener)
    if (this.closeListener)
      this.socket?.removeEventListener('close', this.closeListener)

    this.socket?.close()

    this.socket = undefined
    return this
  }

  onMessage(cb: (data: Data) => void): void {
    if (this.messageListener) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'socket does not support multiple message listeners'
      )
    }

    this.messageListener = (event: MessageEvent<any>) => {
      const buffer = new Uint8Array(event.data)
      cb(buffer)
    }
    this.socket?.addEventListener('message', this.messageListener)
  }

  onError(cb: (error: SatelliteError) => void): void {
    this.errorCallbacks.push(cb)
  }

  onClose(cb: () => void): void {
    if (this.closeListener) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'socket does not support multiple close listeners'
      )
    }

    this.closeListener = cb
    this.socket?.addEventListener('close', this.closeListener)
  }

  onceConnect(cb: () => void): void {
    this.connectCallbacks.push(cb)
  }

  onceError(cb: (error: SatelliteError) => void): void {
    this.onceErrorCallbacks.push(cb)
  }

  removeErrorListener(cb: (error: SatelliteError) => void): void {
    const idx = this.errorCallbacks.indexOf(cb)
    if (idx >= 0) {
      this.errorCallbacks.splice(idx, 1)
    }

    const idxOnce = this.onceErrorCallbacks.indexOf(cb)
    if (idxOnce >= 0) {
      this.onceErrorCallbacks.splice(idxOnce, 1)
    }
  }
}
