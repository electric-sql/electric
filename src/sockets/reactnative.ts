import {Buffer} from 'buffer';
import { ConnectionOptions, Data, Socket } from '.';

export class WebSocketReactNative implements Socket {
  private socket?: WebSocket;

  private connectCallbacks: (() => void)[];
  private errorCallbacks: ((error: Error) => void)[];
  private messageCallbacks: ((data: any) => void)[];

  constructor() {
    this.connectCallbacks = [];
    this.errorCallbacks = [];
    this.messageCallbacks = [];
  }

  open(opts: ConnectionOptions): Socket {
    this.socket = new WebSocket(opts.url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      while (this.connectCallbacks.length > 0) {
        this.connectCallbacks.pop()!();
      }
    };

    this.socket.onerror = (event: any) => {
      while (this.errorCallbacks.length > 0) {
        this.errorCallbacks.pop()!(new Error(event.message));
      }
    };

    this.socket.onmessage = (event: any) => {
      for (const cb of this.messageCallbacks) {
        // no alloc because message.data is ArrayBuffer
        const buffer = new Buffer(event.data);
        cb(buffer);
      }
    };

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
    this.messageCallbacks.push(cb);
  }

  onceConnect(cb: () => void): void {
    this.connectCallbacks.push(cb);
  }

  onceError(cb: (error: Error) => void): void {
    this.errorCallbacks.push(cb);
  }
}
