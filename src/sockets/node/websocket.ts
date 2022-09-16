import EventEmitter from "events";
import { ConnectionOptions, Socket } from "../socket";
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

    close(): Socket {
        this.socket?.close();
        return this;
    }
}