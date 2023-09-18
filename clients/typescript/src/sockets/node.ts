import EventEmitter from 'events'
import { ConnectionOptions, Data, Socket } from './index'
import { WebSocket } from 'ws'
import { SatelliteError, SatelliteErrorCode } from '../util'

export class WebSocketNode extends EventEmitter implements Socket {
  private socket?: WebSocket

  constructor(private protocolVsn: string) {
    super()
  }

  open(opts: ConnectionOptions): this {
    if (this.socket) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'trying to open a socket before closing existing socket'
      )
    }

    this.socket = new WebSocket(opts.url, [this.protocolVsn])
    this.socket.binaryType = 'nodebuffer'

    this.socket.on('open', () => this.emit('open'))
    this.socket.on('message', (data) => this.emit('message', data))
    this.socket.on('error', (_unusedError) =>
      this.emit(
        'error',
        new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error')
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

  onError(cb: (error: SatelliteError) => void): void {
    this.on('error', cb)
  }

  onClose(cb: () => void): void {
    this.on('close', cb)
  }

  onceConnect(cb: () => void): void {
    this.once('open', cb)
  }

  onceError(cb: (error: SatelliteError) => void): void {
    this.once('error', cb)
  }

  removeErrorListener(cb: (error: SatelliteError) => void): void {
    this.removeListener('error', cb)
  }
}
