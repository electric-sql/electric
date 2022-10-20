import { ConnectionOptions, Data, Socket } from '.';

export class WebSocketWeb implements Socket {
    private socket?: WebSocket;

    private connectCallbacks: (() => void)[];
    private errorCallbacks: ((error: Error) => void)[];

    constructor() {
        this.connectCallbacks = [];
        this.errorCallbacks = [];
    }

    open(opts: ConnectionOptions): Socket {
        this.socket = new WebSocket(opts.url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.addEventListener('open', () => {
            while (this.connectCallbacks.length > 0) {
                this.connectCallbacks.pop()!();
            }
        });

        // event doesn't provide much
        this.socket.addEventListener('error', () => {
            while (this.errorCallbacks.length > 0) {
                this.errorCallbacks.pop()!(new Error('failed to establish connection'));
            }
        });

        return this;
    }

    write(data: Data): Socket {
        this.socket?.send(data);
        return this;
    }

    closeAndRemoveListeners(): Socket {
        this.socket?.close();
        return this;
    }

    onMessage(cb: (data: Data) => void): void {
        this.socket?.addEventListener('message', (event) => {
            const buffer = new Uint8Array(event.data)
            cb(buffer)
        })
    }

    onceConnect(cb: () => void): void {
        this.connectCallbacks.push(cb);
    }

    onceError(cb: (error: Error) => void): void {
        this.errorCallbacks.push(cb);
    }
}
