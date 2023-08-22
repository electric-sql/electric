import { EventEmitter } from 'events'
import { ConnectionOptions, Data, Socket, SocketFactory } from './index'

export class MockSocketFactory implements SocketFactory {
  create(): MockSocket {
    return new MockSocket()
  }
}

export class MockSocket extends EventEmitter implements Socket {
  open(_opts: ConnectionOptions): this {
    return this
  }
  write(_data: string | Uint8Array | Buffer): this {
    return this
  }
  closeAndRemoveListeners(): this {
    return this
  }

  onMessage(_cb: (data: Data) => void): void {}
  onError(_cb: (error: Error) => void): void {}
  onClose(_cb: () => void): void {}
  onceConnect(_cb: () => void): void {}
  onceError(_cb: (error: Error) => void): void {}
  removeErrorListener(_cb: (error: Error) => void): void {}
}
