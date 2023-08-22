import { ConnectionOptions, Data, Socket, SocketFactory } from '.'
import { SatelliteError, SatelliteErrorCode } from '../util'

export class WebSocketWebFactory implements SocketFactory {
  create(): WebSocketWeb {
    return new WebSocketWeb()
  }
}

export class WebSocketWeb implements Socket {
  private socket?: WebSocket

  private connectCallbacks: (() => void)[] = []
  private errorCallbacks: ((error: Error) => void)[] = []
  private onceErrorCallbacks: ((error: Error) => void)[] = []

  open(opts: ConnectionOptions): this {
    this.socket = new WebSocket(opts.url)
    this.socket.binaryType = 'arraybuffer'

    this.socket.addEventListener('open', () => {
      while (this.connectCallbacks.length > 0) {
        this.connectCallbacks.pop()!()
      }
    })

    // event doesn't provide much
    this.socket.addEventListener('error', () => {
      for (const cb of this.errorCallbacks) {
        cb(new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error'))
      }

      for (const cb of this.onceErrorCallbacks) {
        cb(new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error'))
      }
    })

    return this
  }

  write(data: Data): this {
    this.socket?.send(data)
    return this
  }

  closeAndRemoveListeners(): this {
    this.socket?.close()
    return this
  }

  onMessage(cb: (data: Data) => void): void {
    this.socket?.addEventListener('message', (event) => {
      const buffer = new Uint8Array(event.data)
      cb(buffer)
    })
  }

  onError(cb: (error: Error) => void): void {
    this.errorCallbacks.push(cb)
  }

  onClose(cb: () => void): void {
    this.socket?.addEventListener('close', cb)
  }

  onceConnect(cb: () => void): void {
    this.connectCallbacks.push(cb)
  }

  onceError(cb: (error: Error) => void): void {
    this.onceErrorCallbacks.push(cb)
  }

  removeErrorListener(cb: (error: Error) => void): void {
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
