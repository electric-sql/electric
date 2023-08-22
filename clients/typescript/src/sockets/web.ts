import { ConnectionOptions, Data, Socket, SocketFactory } from '.'
import { SatelliteError, SatelliteErrorCode } from '../util'

export class WebSocketWebFactory implements SocketFactory {
  create() {
    return new WebSocketWeb()
  }
}

export class WebSocketWeb implements Socket {
  private socket?: WebSocket

  private connectCallbacks: (() => void)[]
  private errorCallbacks: ((error: Error) => void)[]

  constructor() {
    this.connectCallbacks = []
    this.errorCallbacks = []
  }

  open(opts: ConnectionOptions): Socket {
    this.socket = new WebSocket(opts.url)
    this.socket.binaryType = 'arraybuffer'

    this.socket.addEventListener('open', () => {
      while (this.connectCallbacks.length > 0) {
        this.connectCallbacks.pop()!()
      }
    })

    // event doesn't provide much
    this.socket.addEventListener('error', () => {
      while (this.errorCallbacks.length > 0) {
        this.errorCallbacks.pop()!(
          new SatelliteError(
            SatelliteErrorCode.CONNECTION_FAILED,
            'failed to establish connection'
          )
        )
      }
    })

    return this
  }

  write(data: Data): Socket {
    this.socket?.send(data)
    return this
  }

  closeAndRemoveListeners(): Socket {
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
    this.socket?.addEventListener('error', () => cb(new Error('socket error')))
  }

  onClose(cb: () => void): void {
    this.socket?.addEventListener('close', cb)
  }

  onceConnect(cb: () => void): void {
    this.connectCallbacks.push(cb)
  }

  onceError(cb: (error: Error) => void): void {
    this.errorCallbacks.push(cb)
  }
}
