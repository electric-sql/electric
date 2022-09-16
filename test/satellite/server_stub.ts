import * as net from 'net';
import * as frame from 'frame-stream';
import { SatPbMsg, getTypeFromString, getSizeBuf } from '../../src/util/proto';

import { SatInStartReplicationResp, SatInStopReplicationResp, SatOpLog } from '../../src/_generated/proto/satellite';

const PORT = 30002;
const IP = '127.0.0.1';

export class TCPSatelliteServerStub {
  private server: net.Server;
  private queue: SatPbMsg[][];

  constructor() {
    this.queue = [];
    this.server = net.createServer((socket: net.Socket) => {
      // Replies to any request with message in queue
      socket.pipe(frame.decode()).on('data', (_data: Buffer) => {
        const encode = frame.encode();
        encode.pipe(socket);

        const next = this.queue.shift();
        if (next == undefined) {
          // do nothing
        } else {
          for (const msg of next) {
            const msgType = getTypeFromString(msg.$type);

            if (msgType == getTypeFromString(SatInStartReplicationResp.$type)) {
              encode.write(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatInStartReplicationResp.encode(msg as SatInStartReplicationResp).finish(),
                ]),
              );
            }

            if (msgType == getTypeFromString(SatInStopReplicationResp.$type)) {
              encode.write(
                Buffer.concat([
                  getSizeBuf(msg),
                  SatInStopReplicationResp.encode(msg as SatInStopReplicationResp).finish(),
                ]),
              );
            }

            if (msgType == getTypeFromString(SatOpLog.$type)) {
              encode.write(Buffer.concat([getSizeBuf(msg), SatOpLog.encode(msg as SatOpLog).finish()]));
            }
          }
        }
      });

      socket.on('error', error => console.error(error));
    });
  }

  start() {
    this.server.listen(PORT, IP);
  }

  close() {
    this.server.close();
  }

  nextResponse(message: SatPbMsg) {
    this.queue.push([message]);
  }
  nextSequence(messages: SatPbMsg[]) {
    this.queue.push(messages);
  }
}
