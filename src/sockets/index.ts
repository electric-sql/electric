import { EventEmitter } from 'events';

type Data = string | Buffer | Uint8Array;

export interface ConnectionOptions {
    url: string;
}

export interface Socket extends EventEmitter {
    open(opts: ConnectionOptions): Socket;
    write(data: Data): Socket;
    close(): Socket;
}