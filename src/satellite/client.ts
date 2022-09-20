import {
  SatAuthReq,
  SatAuthResp,
  SatErrorResp,
  SatErrorResp_ErrorCode,
  SatInStartReplicationReq,
  SatInStartReplicationReq_Option,
  SatInStartReplicationResp,
  SatInStopReplicationReq,
  SatInStopReplicationResp,
  SatOpLog,
  SatPingResp,
  SatRelation,
  SatRelation_RelationType,
} from '../_generated/proto/satellite';
import { getObjFromString, getSizeBuf, getTypeFromCode, SatPbMsg } from '../util/proto';
import { Socket } from '../sockets/socket';
import _m0 from 'protobufjs/minimal.js';
import { EventEmitter } from 'events';
import Long from 'long';
import { AuthResponse, SatelliteError, SatelliteErrorCode } from '../util/types';

export interface SatelliteClient extends EventEmitter {
  connect(): Promise<void | SatelliteError>;
  close(): Promise<void | SatelliteError>;
  authenticate(): Promise<AuthResponse | SatelliteError>;
  startReplication(lsn: string, resume?: boolean): Promise<void | SatelliteError>;
  stopReplication(): Promise<void | SatelliteError>;
  subscribeToTransactions(callback: (transaction: Transaction) => Promise<void>): void;
}

export interface SatelliteOptions {
  appId: string,
  token: string
  port: number;
  address: string;
  timeout?: number;
}

export type AckCallback = () => void;

export type Transaction = {
  commit_timestamp: Long,
  lsn: string
  changes: Change[],
};

export enum ChangeType {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE'
}

type Change = {
  relation: Relation,
  type: ChangeType,
  record?: Record,
  oldRecord?: Record
}

type Record = { [key: string]: string | number }

type Replication = {
  authenticated: boolean
  isReplicating: ReplicationStatus
  relations: Map<number, Relation>
  ack_lsn: string
  transaction: Transaction
}

type Relation = {
  id: number
  schema: string
  table: string
  tableType: SatRelation_RelationType
  columns: RelationColumn[]
}

type RelationColumn = { name: string, type: string };

enum ReplicationStatus {
  STOPPED,
  STARTING,
  STOPPING,
  ACTIVE
}

interface PrivateSatelliteOptions extends SatelliteOptions {
  timeout: number;
}

const defSatelliteOptions = {
  timeout: 5000,
};

type IncomingHandler = { handle: (msg: any) => any | void, isRpc: boolean }

export class SatelliteWSClient extends EventEmitter implements SatelliteClient {
  private opts: PrivateSatelliteOptions;

  private socket: Socket;
  private inbound: Replication;
  private outbound: Replication;

  private socketHandler?: (any: any) => void;

  private handlerForMessageType: { [k: string]: IncomingHandler } = {
    "Electric.Satellite.SatAuthResp": { handle: (resp) => this.handleAuthResp(resp), isRpc: true },
    "Electric.Satellite.SatInStartReplicationResp": { handle: () => this.handleStartResp(), isRpc: true },
    "Electric.Satellite.SatInStartReplicationReq": { handle: (req) => this.handleStartReq(req), isRpc: false },
    "Electric.Satellite.SatInStopReplicationReq": { handle: () => this.handleStopReq(), isRpc: false },
    "Electric.Satellite.SatInStopReplicationResp": { handle: () => this.handleStopResp(), isRpc: true },
    "Electric.Satellite.SatPingReq": { handle: () => this.handlePingReq(), isRpc: true },
    "Electric.Satellite.SatRelation": { handle: (req) => this.handleRelation(req), isRpc: false },
    "Electric.Satellite.SatOpLog": { handle: (req) => this.handleTransaction(req), isRpc: false },
    "Electric.Satellite.SatErrorResp": { handle: (error: SatErrorResp) => this.handleError(error), isRpc: false },
  }

  constructor(socket: Socket, opts: SatelliteOptions) {
    super();

    this.opts = { ...defSatelliteOptions, ...opts };
    this.socket = socket;

    this.inbound = this.resetReplication();
    this.outbound = this.resetReplication();
  }  

  private resetReplication(): Replication {
    return {
      authenticated: false,
      isReplicating: ReplicationStatus.STOPPED,
      relations: new Map(),
      ack_lsn: "0",
      transaction: {
        commit_timestamp: Long.ZERO,
        lsn: "0",
        changes: []
      }
    }
  }

  // TODO: handle connection errors
  connect(): Promise<void | SatelliteError> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', async () => {
        this.socketHandler = message => this.handleIncoming(message);
        this.socket.on('message', this.socketHandler);
        resolve();
      });
      this.socket.once('error', error => reject(error));

      const { address, port } = this.opts;
      this.socket.open({ url: `ws://${address}:${port}/ws` });
    });
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      if (this.socketHandler) {
        this.removeListener('message', this.socketHandler);
      }
      this.socket.close();
      resolve();
    });
  }

  startReplication(lsn: string, resumeFromLast?: boolean): Promise<void | SatelliteError> {
    if (this.inbound.isReplicating != ReplicationStatus.STOPPED) {
      return Promise.reject(new SatelliteError(
        SatelliteErrorCode.REPLICATION_ALREADY_STARTED, `replication already started`));
    }
    this.inbound = this.resetReplication();
    this.outbound = this.resetReplication();

    this.inbound.isReplicating = ReplicationStatus.STARTING;
    this.inbound.ack_lsn = lsn;

    const options = resumeFromLast ? [SatInStartReplicationReq_Option.LAST_ACKNOWLEDGED] : [];
    const request = SatInStartReplicationReq.fromPartial({ lsn, options });
    return this.rpc(request);
  }

  stopReplication(): Promise<void | SatelliteError> {
    if (this.inbound.isReplicating != ReplicationStatus.ACTIVE) {
      return Promise.reject(new SatelliteError(
        SatelliteErrorCode.REPLICATION_NOT_STARTED, `replication not active`));
    }

    this.inbound.isReplicating = ReplicationStatus.STOPPING;
    const request = SatInStopReplicationReq.fromPartial({});
    return this.rpc(request);
  }

  authenticate(): Promise<AuthResponse | SatelliteError> {
    const { appId: id, token } = this.opts;
    const request = SatAuthReq.fromPartial({ id, token });
    return this.rpc<AuthResponse>(request);
  }

  subscribeToTransactions(callback: (transaction: Transaction) => Promise<void>) {
    this.on('transaction', async (txn, ackCb) => {
      await callback(txn) // calls the callback provided by the subscriber
      // acknowledge the transaction has been processed
      // we might want to do this separately or document the behavior
      ackCb()
    });
  }

  private handleAuthResp(message: SatAuthResp | SatErrorResp): AuthResponse {
    let error, serverId;
    if (message.$type == SatAuthResp.$type) {
      serverId = message.id;
      this.inbound.authenticated = true;
    } else {
      error = new SatelliteError(SatelliteErrorCode.AUTH_ERROR, `${message.errorType}`);
    }
    return { serverId, error };
  }

  private handleStartResp() {
    if (this.inbound.isReplicating == ReplicationStatus.STARTING) {
      this.inbound.isReplicating = ReplicationStatus.ACTIVE;
    } else {
      this.emit('error', new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        `unexpected state ${this.inbound.isReplicating} handling 'start' response`));
    }
  }

  private handleStartReq(message: SatInStartReplicationReq) {
    if (this.outbound.isReplicating == ReplicationStatus.STOPPED) {
      this.outbound.isReplicating = ReplicationStatus.ACTIVE;
      this.outbound.ack_lsn = message.lsn;

      const response = SatInStartReplicationResp.fromPartial({});
      this.sendMessage(response);
    } else {
      // TODO: what error?
      const response = SatErrorResp.fromPartial({ errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED });
      this.sendMessage(response);

      this.emit('error', new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        `unexpected state ${this.outbound.isReplicating} handling 'start' request`));
    }
  }

  private handleStopReq() {
    if (this.outbound.isReplicating == ReplicationStatus.ACTIVE) {
      this.outbound.isReplicating = ReplicationStatus.STOPPED;

      const response = SatInStopReplicationResp.fromPartial({});
      this.sendMessage(response);
    } else {
      // TODO: what error?
      const response = SatErrorResp.fromPartial({ errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED });
      const buffer = Buffer.concat(
        [getSizeBuf(response), SatErrorResp.encode(response, _m0.Writer.create()).finish()]);
      this.socket.write(buffer);

      this.emit('error', new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        `unexpected state ${this.inbound.isReplicating} handling 'stop' request`));
    }
  }

  private handleStopResp() {
    if (this.inbound.isReplicating == ReplicationStatus.STOPPING) {
      this.inbound.isReplicating = ReplicationStatus.STOPPED;
    } else {
      this.emit('error', new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        `unexpected state ${this.inbound.isReplicating} handling 'stop' response`));
    }
  }

  private handleRelation(message: SatRelation) {
    if (this.inbound.isReplicating != ReplicationStatus.ACTIVE) {
      this.emit('error', new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        `unexpected state ${this.inbound.isReplicating} handling 'relation' message`));
      return;
    }

    const relation = {
      id: message.relationId,
      schema: message.schemaName,
      table: message.tableName,
      tableType: message.tableType,
      columns: message.columns.map(c => ({ name: c.name, type: c.type }))
    };

    this.inbound.relations.set(relation.id, relation);
  }

  private handleTransaction(message: SatOpLog) {
    this.processOpLogMessage(message, this.inbound);
  }

  private handlePingReq() {
    const pong = SatPingResp.fromPartial({ lsn: this.inbound.ack_lsn });
    this.sendMessage(pong);
  }

  private handleError(error: SatErrorResp) {
    this.emit('error',
      new Error(`server replied with error code: ${error.errorType}`))
  }

  private handleIncoming(data: Buffer) {
    const messageOrError = this.toMessage(data);
    if (messageOrError instanceof Error) {
      this.emit('error', messageOrError);
    } else {
      const handler = this.handlerForMessageType[messageOrError.$type];
      const response = handler.handle(messageOrError);
      if (handler.isRpc) {
        this.emit('rpc_response', response);
      }
    }
  }

  // TODO: handle multi-message transactions
  private processOpLogMessage(opLogMessage: SatOpLog, replication: Replication) {
    opLogMessage.ops.map((op) => {
      if (op.begin) { 
        const transaction = {
          commit_timestamp: op.begin.commitTimestamp,
          lsn: op.begin.lsn,
          changes: []
        }
        replication.transaction = transaction;
      }

      if (op.commit) {
        const { commit_timestamp, lsn, changes } = replication.transaction;
        const transaction: Transaction = {
          commit_timestamp,
          lsn,
          changes
        }
        this.emit('transaction', transaction,
          () => this.inbound.ack_lsn = transaction.lsn as any);
      }

      if (op.insert) {
        const rid = op.insert.relationId;
        const rel = replication.relations.get(rid);
        if (!rel) {
          throw new SatelliteError(SatelliteErrorCode.PROTOCOL_VIOLATION,
            `missing relation ${op.insert.relationId} for incoming operation`);
        }

        const change = {
          relation: rel,
          type: ChangeType.INSERT,
          record: Object.fromEntries(rel.columns.map((c, i) =>
            [c.name, this.deserializeColumnData(op.insert?.rowData[i] as any, c)]))
        };
        replication.transaction.changes.push(change);
      }

      if (op.update) {
        const rid = op.update.relationId;
        const rel = replication.relations.get(rid);
        if (!rel) {
          throw new SatelliteError(SatelliteErrorCode.PROTOCOL_VIOLATION,
            "missing relation for incoming operation");
        }

        const change = ({
          relation: rel,
          type: ChangeType.UPDATE,
          record: Object.fromEntries(rel.columns.map((c, i) =>
            [c.name, this.deserializeColumnData(op.update?.rowData[i] as any, c)])),
          oldRecord: Object.fromEntries(rel.columns.map((c, i) =>
            [c.name, this.deserializeColumnData(op.update?.oldRowData[i] as any, c)]))
        });
        replication.transaction.changes.push(change);
      }

      if (op.delete) {
        const rid = op.delete.relationId;
        const rel = replication.relations.get(rid);
        if (!rel) {
          throw new SatelliteError(SatelliteErrorCode.PROTOCOL_VIOLATION,
            "missing relation for incoming operation");
        }

        const change = ({
          relation: rel,
          type: ChangeType.DELETE,
          oldRecord: Object.fromEntries(rel.columns.map((c, i) =>
            [c.name, this.deserializeColumnData(op.delete?.oldRowData[i] as any, c)]))
        });
        replication.transaction.changes.push(change);
      }
    });    
  }

  // TODO: add type missing types
  private deserializeColumnData(column: Uint8Array, columnInfo: RelationColumn): string {
    if (columnInfo.type == 'varchar') {
      return new String(column).toString();
    }
    if (columnInfo.type == 'uuid') {
      return new String(column).toString();
    }
    throw new SatelliteError(SatelliteErrorCode.UNKNOWN_DATA_TYPE, `can't deserialize ${columnInfo.type}`);
  }

  private toMessage(data: Buffer): SatPbMsg | Error {
    const code = data.readUInt8();
    const type = getTypeFromCode(code);
    const obj = getObjFromString(type);
    if (obj == undefined) {
      return new SatelliteError(SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE, `${code})`);
    }
    return obj.decode(data.subarray(1));
  }

  private sendMessage(request: SatPbMsg) {
    const obj = getObjFromString(request.$type);
    if (obj == undefined) {
      throw new SatelliteError(SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE, `${request.$type})`);
    }

    const reqBuf = Buffer.concat([
      getSizeBuf(request),
      obj.encode(request, _m0.Writer.create()).finish()
    ]);
    this.socket.write(reqBuf);
  }

  private async rpc<T>(request: SatPbMsg): Promise<T | SatelliteError> {
    let waitingFor: NodeJS.Timeout;
    return new Promise<T | SatelliteError>((resolve, reject) => {
      waitingFor = setTimeout(() => {
        const error = new SatelliteError(SatelliteErrorCode.TIMEOUT, `${request.$type}`);
        return reject(error);
      }, this.opts.timeout);

      // reject on any error
      this.once('error', (error: SatelliteError) => {
        return reject(error);
      });

      this.once('rpc_response', (resp: T) => {
        return resolve(resp);
      });

      this.sendMessage(request);
    }).finally(() => clearTimeout(waitingFor));
  }
}
