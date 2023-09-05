import { SatelliteError } from '../util'
import { LIB_VERSION } from '../version'

export type Data = string | Uint8Array

export interface ConnectionOptions {
  url: string
}

// Take major & minor version of the library
export const PROTOCOL_VSN =
  'satellite.' + LIB_VERSION.split('.').slice(0, 2).join('.')

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

export type SocketFactory = new (protocolVersion: string) => Socket
