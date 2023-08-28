import { ConnectionOptions, Data, Socket, SocketFactory } from '.'
import { SatelliteError, SatelliteErrorCode } from '../util'

// FIXME: This implementation is a bit contrived because it is not using EventEmitter
export class WebSocketReactNativeFactory implements SocketFactory {
  create(): WebSocketReactNative {
    return new WebSocketReactNative()
  }
}

export class WebSocketReactNative implements Socket {
  private socket?: WebSocket

  private connectCallbacks: (() => void)[] = []
  private errorCallbacks: ((error: SatelliteError) => void)[] = []
  private onceErrorCallbacks: ((error: SatelliteError) => void)[] = []
  private messageCallbacks: ((data: any) => void)[] = []

  open(opts: ConnectionOptions): this {
    if (this.socket) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'trying to open a socket before closing existing socket'
      )
    }

    this.socket = new WebSocket(opts.url)
    this.socket.binaryType = 'arraybuffer'

    this.socket.onopen = () => {
      let callback: (() => void) | undefined
      while ((callback = this.connectCallbacks.pop())) {
        callback()
      }
    }

    // event doesn't provide much
    this.socket.onerror = () => {
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

    this.socket.onmessage = (event: any) => {
      for (const cb of this.messageCallbacks) {
        // no alloc because message.data is ArrayBuffer
        const buffer = new Uint8Array(event.data)
        cb(buffer)
      }
    }

    return this
  }

  write(data: Data): this {
    this.socket?.send(data)
    return this
  }

  closeAndRemoveListeners(): this {
    this.connectCallbacks = []
    this.errorCallbacks = []
    this.messageCallbacks = []

    this.socket?.close()
    return this
  }

  onMessage(cb: (data: Data) => void): void {
    this.messageCallbacks.push(cb)
  }

  onError(cb: (error: SatelliteError) => void): void {
    if (this.socket) {
      this.socket.onerror = () => {
        cb(new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error'))
      }
    }
  }

  onClose(cb: () => void): void {
    if (this.socket) {
      this.socket.onclose = () => {
        cb()
      }
    }
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
