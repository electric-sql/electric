import EventEmitter from 'events'
import { ConnectionOptions, Data, Socket, SocketFactory } from './index'
import { WebSocket } from 'ws'
import { SatelliteError, SatelliteErrorCode } from '../util'

export class WebSocketNodeFactory implements SocketFactory {
  create(): WebSocketNode {
    return new WebSocketNode()
  }
}

export class WebSocketNode extends EventEmitter implements Socket {
  private socket?: WebSocket

  constructor() {
    super()
  }

  open(opts: ConnectionOptions): this {
    this.socket = new WebSocket(opts.url)
    this.socket.binaryType = 'nodebuffer'

    this.socket.on('open', () => this.emit('open'))
    this.socket.on('message', (data) => this.emit('message', data))

    // TODO: check if can get extract more info from the socket error
    // and propagate that to the handler
    this.socket.on('error', (_unusedError) =>
      this.emit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.SOCKET_ERROR,
          'failed to establish connection'
        )
      )
    )

    return this
  }

  write(data: string | Uint8Array | Buffer): this {
    this.socket?.send(data)
    return this
  }

  closeAndRemoveListeners(): this {
    this.removeAllListeners()
    this.socket?.removeAllListeners()
    this.socket?.close()
    return this
  }

  onMessage(cb: (data: Data) => void): void {
    this.on('message', cb)
  }

  onError(cb: (error: Error) => void): void {
    this.on('error', cb)
  }

  onClose(cb: () => void): void {
    this.on('close', cb)
  }

  onceConnect(cb: () => void): void {
    this.once('open', cb)
  }

  onceError(cb: (error: Error) => void): void {
    this.once('error', cb)
  }

  removeErrorListener(cb: (error: Error) => void): void {
    this.removeListener('error', cb)
  }
}
