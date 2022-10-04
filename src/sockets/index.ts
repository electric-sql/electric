export type Data = string | Buffer | Uint8Array;

export interface ConnectionOptions {
    url: string;
}

export interface Socket {
    open(opts: ConnectionOptions): Socket
    write(data: Data): Socket
    closeAndRemoveListeners(): Socket

    onMessage(cb: (data: Data) => void): void
    onceConnect(cb: () => void): void
    onceError(cb: (error: Error) => void): void
}