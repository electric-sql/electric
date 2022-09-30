import { EventEmitter } from "events";
import { ConnectionOptions, Data, Socket } from "./index";

export class MockSocket extends EventEmitter implements Socket {
    open(_opts: ConnectionOptions): MockSocket {
        return this
    }
    write(_data: string | Uint8Array | Buffer): MockSocket {
        return this
    }
    closeAndRemoveListeners(): MockSocket {
        return this
    }

    onMessage(_cb: (data: Data) => void): void { }
    onceConnect(_cb: () => void): void { }
    onceError(_cb: (error: Error) => void): void { }
}