import EventEmitter from "events";
import { ConnectionOptions, Data, Socket } from "./index";
import { WebSocket } from 'ws';

export class WebSocketNode extends EventEmitter implements Socket {
    private socket?: WebSocket;

    constructor() {
        super();
    }    

    open(opts: ConnectionOptions): Socket {
        this.socket = new WebSocket(opts.url);
        this.socket.binaryType = "nodebuffer";

        this.socket.on('open', () => this.emit('open'));
        this.socket.on('message', (data) => this.emit('message', data));
        this.socket.on('error', (error) => this.emit('error', error));

        return this;
    }

    write(data: string | Uint8Array | Buffer): Socket {
        this.socket?.send(data);
        return this;
    }

    closeAndRemoveListeners(): Socket {
        this.removeAllListeners();
        this.socket?.removeAllListeners();
        this.socket?.close();        
        return this;
    }

    onMessage(cb: (data: Data) => void): void {
        this.on('message', cb)
    }

    onceConnect(cb: () => void): void {
        this.once('open', cb)
    }

    onceError(cb: (error: Error) => void): void {
        this.once('error', cb)
    }
}