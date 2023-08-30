import { SatelliteError } from '../util'

export type Data = string | Uint8Array

export interface ConnectionOptions {
  url: string
}

export interface Socket {
  open(opts: ConnectionOptions): this
  write(data: Data): this
  closeAndRemoveListeners(): this

  onMessage(cb: (data: Data) => void): void
  onError(cb: (error: SatelliteError) => void): void
  onClose(cb: () => void): void

  onceConnect(cb: () => void): void
  onceError(cb: (error: SatelliteError) => void): void

  removeErrorListener(cb: (error: SatelliteError) => void): void
}

export interface SocketFactory {
  create(): Socket
}
