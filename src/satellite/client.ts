import {
  SatInStartReplicationReq,
  SatInStartReplicationReq_Option,
  SatInStartReplicationResp,
  SatInStopReplicationReq,
  SatInStopReplicationResp,
  SatOpLog,
  SatTransOp,
} from '../_generated/proto/satellite';
import { getSizeBuf, getTypeFromString, SatPbMsg, SatPbMsgObj } from '../util/proto';
import { Socket, ConnectionOptions } from '../sockets/socket';
import _m0 from 'protobufjs/minimal.js';
import { EventEmitter } from 'events';

export interface SatelliteClient extends EventEmitter {
  connect(opts: ConnectionOptions): Promise<void | Error>;
  close(): Promise<void>;
  startReplication(lsn: string, resume?: boolean): Promise<void | Error>;
  stopReplication(): Promise<void | Error>;
}

export enum SatelliteClientErrorCode {
  INTERNAL = 0,
  TIMEOUT = 1,
  REPLICATION_NOT_STARTED = 2,
  REPLICATION_ALREADY_STARTED = 3,
  INVALID_STATE = 4,
  UNEXPECTED_MESSAGE_TYPE = 5,
}
export class SatelliteError extends Error {
  public code: SatelliteClientErrorCode;

  constructor(code: SatelliteClientErrorCode, message?: string) {
    super(message);
    this.code = code;
  }
}

export interface SatelliteOptions {
  port: number;
  address: string;
  timeout?: number;
  maxTxnSize?: number;
}

export interface PrivateSatelliteOptions extends SatelliteOptions {
  timeout: number;
  maxTxnSize: number;
}

const defSatelliteOptions = {
  timeout: 5000,
  maxTxnSize: 100,
};

export class TCPSatelliteClient extends EventEmitter implements SatelliteClient {
  private opts: PrivateSatelliteOptions;

  private socket: Socket;

  private isReplicating: boolean;
  private connectionHandler?: (any: any) => void;
  private replicationHandler?: (any: any) => void;

  constructor(socket: Socket, opts: SatelliteOptions) {
    super();
    this.opts = { ...defSatelliteOptions, ...opts };
    this.socket = socket;
    this.isReplicating = false;
  }

  // TODO: handle EADDRINUSE? and other errors
  async connect(): Promise<void | Error> {
    return new Promise((resolve, reject) => {
      this.socket.once('connect', () => {
        this.connectionHandler = data => this.handleConnection(data);
        this.socket.on('data', this.connectionHandler);
        return resolve();
      });
      this.socket.once('error', error => reject(error));

      this.socket.connect(this.opts);
    });
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.socket.once('close', () => {
        if (this.connectionHandler) {
          this.removeListener('data', this.connectionHandler);
        }
        resolve();
      });
      this.socket.destroy();
    });
  }

  async startReplication(lsn: string, resumeFromLast?: boolean): Promise<void | SatelliteError> {
    if (this.isReplicating) {
      return Promise.reject({ code: SatelliteClientErrorCode.REPLICATION_ALREADY_STARTED });
    }

    const options = resumeFromLast ? [SatInStartReplicationReq_Option.LAST_ACKNOWLEDGED] : [];
    const request = SatInStartReplicationReq.fromPartial({ lsn, options });
    return this.connectionRequest(request, SatInStartReplicationReq, 'started');
  }

  async stopReplication(): Promise<void | SatelliteError> {
    if (!this.isReplicating) {
      return Promise.reject({ code: SatelliteClientErrorCode.REPLICATION_NOT_STARTED });
    }

    const request = SatInStopReplicationReq.fromPartial({});
    return this.connectionRequest(request, SatInStopReplicationReq, 'stopped');
  }

  // TODO: add keep-alive messages
  // ... and relation messages
  handleReplication(data: Buffer) {
    const handler = (message: SatPbMsg) => {
      switch (message.$type) {
        case SatOpLog.$type: {
          const transaction = this.getTransaction(message.ops);
          this.emit('transaction', transaction);
          break;
        }
      }
    };
    this.handleData(handler, data, [SatOpLog]);
  }

  handleConnection(data: Buffer) {
    const handler = (message: SatPbMsg) => {
      switch (message.$type) {
        case SatInStartReplicationResp.$type: {
          this.isReplicating = true;
          this.replicationHandler = data => this.handleReplication(data);
          this.socket.on('data', this.replicationHandler);

          this.emit('started');
          break;
        }
        case SatInStopReplicationResp.$type: {
          this.isReplicating = false;
          if (this.replicationHandler) {
            this.socket.removeListener('data', this.replicationHandler);
          }

          this.emit('stopped');
          break;
        }
      }
    };
    this.handleData(handler, data, [SatInStartReplicationResp, SatInStopReplicationResp]);
  }

  handleData(handler: (message: SatPbMsg) => void, data: Buffer, types: SatPbMsgObj[]) {
    const messageOrError = this.toMessage(data, types);
    if (messageOrError instanceof Error) {
      this.emit('error', messageOrError);
    } else {
      handler(messageOrError);
    }
  }

  /* 
   Executes a 'request' to server and waits for ConnectionHandler to emit 'responseEvent'.
   It is possible to wait one request per 'responseEvent' maximum. 
   Reject the request on any ConnectionHandler error.

   Sets a timeout that will trigger if the channel is inactive for longer than timeout.
   The timeout will not trigger while the socket is receiving data from the server.

   TODO: possibly extend the interface just to trigger on specific erros emitted by ConnectionHandler
   TODO: record the start time of 'event' and check timeout for any other message received
   */

  private async connectionRequest(
    request: SatPbMsg,
    requestObj: SatPbMsgObj,
    responseEvent: string,
  ): Promise<void | SatelliteError> {
    this.socket.setTimeout(this.opts.timeout);
    const reqBuf = Buffer.concat([getSizeBuf(request), requestObj.encode(request, _m0.Writer.create()).finish()]);

    return new Promise<void | SatelliteError>((resolve, reject) => {
      this.socket.once('timeout', () => {
        return reject({ code: SatelliteClientErrorCode.TIMEOUT });
      });

      // wait for resonse event to resolve promise
      this.once(responseEvent, () => resolve());

      this.once('error', error => reject(error));

      this.socket.write(reqBuf);
    }).finally(() => this.socket.setTimeout(0));
  }

  toMessage(data: Buffer, types: SatPbMsgObj[]): SatPbMsg | Error {
    var msgType = data.readUint8();
    for (const type of types) {
      if (msgType == getTypeFromString(type.$type)) {
        return type.decode(data.subarray(1));
      }
    }
    return new SatelliteError(SatelliteClientErrorCode.UNEXPECTED_MESSAGE_TYPE);
  }

  // TODO: need to complete
  getTransaction(_ops: SatTransOp[]): any {
    return [];
  }
}
