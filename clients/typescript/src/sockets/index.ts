export type Data = string | Uint8Array

export interface ConnectionOptions {
  url: string
}

export interface Socket {
  open(opts: ConnectionOptions): this
  write(data: Data): this
  closeAndRemoveListeners(): this

  onMessage(cb: (data: Data) => void): void
  onError(cb: (error: Error) => void): void
  onClose(cb: () => void): void

  onceConnect(cb: () => void): void
  onceError(cb: (error: Error) => void): void

  removeErrorListener(cb: (error: Error) => void): void
}

export interface SocketFactory {
  create(): Socket
}
