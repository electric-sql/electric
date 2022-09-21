import { EventEmitter } from "events";
import { ConnectionOptions, Socket } from "./index";

export class MockSocket extends EventEmitter implements Socket {
    open(_opts: ConnectionOptions): MockSocket {
        return this;
    }
    write(_data: string | Uint8Array | Buffer): MockSocket {
        return this;
    }
    close(): MockSocket {
        return this;
    }
}