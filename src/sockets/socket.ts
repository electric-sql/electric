import * as net from 'net';
import * as frame from 'frame-stream';
import { EventEmitter } from 'events';

type Data = string | Buffer | Uint8Array;

export interface ConnectionOptions {
    address: string;
    port: number;
}

// TODO: structure as other adapters
export interface Socket extends EventEmitter {
    connect(opts: ConnectionOptions): Socket;
    write(data: Data): boolean;
    destroy(error?: any): Socket;
    setTimeout(timeout: number): Socket;
}

export class SocketNode extends EventEmitter implements Socket {
    public socket: net.Socket;
    private decoder: frame.Decoder;
    private encoder: frame.Encoder;

    constructor() {
        super();
        this.socket = new net.Socket();

        this.decoder = frame.decode();
        this.encoder = frame.encode();

        this.socket.pipe(this.decoder);
        this.encoder.pipe(this.socket);
    }

    connect(opts: ConnectionOptions): this {
        this.socket.connect(opts.port, opts.address);
        return this;
    }

    destroy(error: any): this {
        this.socket.destroy(error);
        return this;
    }

    write(data: Data): boolean {
        return this.encoder.write(data);
    }

    // figure out if there is a more idiomatic way of doing this
    // 'error': we lose visbility over potenteial decoder errors
    // ...maybe there is a better way
    on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        if (eventName == 'connect' || eventName == 'close' || eventName == 'timeout' || eventName == 'error') {
            this.socket.on(eventName, listener);
        } else {
            this.decoder.on(eventName, listener)
        }
        return this;
    }

    addListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        return this.on(eventName, listener);
    }

    once(eventName: string, listener: (...args: any[]) => void): this {
        if (eventName == 'connect' || eventName == 'close' || eventName == 'timeout' || eventName == 'timeout') {
            this.socket.once(eventName, listener);
        } else {
            this.decoder.once(eventName, listener)
        }
        return this;
    }

    removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
        if (eventName == 'connect' || eventName == 'close' || eventName == 'timeout' || eventName == 'error') {
            this.socket.removeListener(eventName, listener);
        } else {
            this.decoder.removeListener(eventName, listener);
        }
        return this;
    }

    removeAllListeners(event?: string | symbol | undefined): this {
        if (event == 'connect' || event == 'close' || event == 'timeout' || event == 'error') {
            this.socket.removeAllListeners(event);
        } else {
            this.decoder.removeAllListeners(event)
        }
        return this;
    }

    setTimeout(timeout: number): this {
        this.socket.setTimeout(timeout);
        return this;
    }

    // override other necessary EventEmitter methods as necessary

}
