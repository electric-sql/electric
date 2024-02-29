import EventEmitter from 'events'
import { AUTH_EXPIRED_CLOSE_EVENT, ConnectionOptions, Data, Socket } from '.'
import { SatelliteError, SatelliteErrorCode, SocketCloseReason } from '../util'

type WriteType<SupportBuffer extends boolean> = SupportBuffer extends false
  ? Data
  : Data | Buffer

interface MessageEvent<T = any> {
  data: T
}

interface CloseEvent {
  code: number
  reason: string
}

export interface IWebSocket<SupportBuffer extends boolean> {
  send(data: WriteType<SupportBuffer>): void

  addEventListener(event: 'open', cb: () => void): void
  addEventListener(event: 'message', cb: (ev: MessageEvent) => void): void
  addEventListener(event: 'error', cb: (ev: any) => void): void
  addEventListener(event: 'close', cb: (ev: CloseEvent) => void): void

  removeEventListener(
    event: 'open' | 'message' | 'error' | 'close',
    cb: (...args: any[]) => void
  ): void

  close(): void
}

export abstract class GenericWebSocket<SupportBuffer extends boolean = false>
  extends EventEmitter
  implements Socket
{
  protected abstract socket?: IWebSocket<SupportBuffer>
  protected abstract makeSocket(
    opts: ConnectionOptions
  ): IWebSocket<SupportBuffer>

  private openListener = () => this.emit('open')
  protected messageListener = (ev: MessageEvent) => {
    const buffer = new Uint8Array(ev.data)
    this.emit('message', buffer)
  }
  private errorListener = () =>
    this.emit(
      'error',
      new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket error')
    )
  private closeListener = (ev: CloseEvent) => this.emit('close', ev)

  constructor() {
    super()
  }

  open(opts: ConnectionOptions): this {
    if (this.socket) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'trying to open a socket before closing existing socket'
      )
    }

    this.socket = this.makeSocket(opts)

    this.socket.addEventListener('open', this.openListener.bind(this))
    this.socket.addEventListener('message', this.messageListener.bind(this))
    this.socket.addEventListener('error', this.errorListener.bind(this))
    this.socket.addEventListener('close', this.closeListener.bind(this))

    return this
  }

  write(data: WriteType<SupportBuffer>): this {
    this.socket?.send(data)
    return this
  }

  closeAndRemoveListeners(): this {
    this.removeAllListeners()
    this.socket?.removeEventListener('open', this.openListener)
    this.socket?.removeEventListener('message', this.messageListener)
    this.socket?.removeEventListener('error', this.errorListener)
    this.socket?.removeEventListener('close', this.closeListener)
    this.socket?.close()
    return this
  }

  onMessage(cb: (data: Data) => void): void {
    this.on('message', cb)
  }

  onError(cb: (error: SatelliteError) => void): void {
    this.on('error', cb)
  }

  onClose(cb: (reason: SocketCloseReason) => void): void {
    const callback = (ev: CloseEvent) => {
      const reason =
        ev.reason === AUTH_EXPIRED_CLOSE_EVENT
          ? SatelliteErrorCode.AUTH_EXPIRED
          : SatelliteErrorCode.SOCKET_ERROR
      cb(reason)
    }
    this.on('close', callback)
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
