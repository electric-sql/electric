import throttle from 'lodash.throttle'

import {
  SatAuthReq,
  SatAuthResp,
  SatErrorResp,
  SatErrorResp_ErrorCode,
  SatInStartReplicationReq,
  SatInStartReplicationResp,
  SatInStopReplicationReq,
  SatInStopReplicationResp,
  SatOpLog,
  SatPingResp,
  SatRelation,
  SatRelationColumn,
  SatTransOp,
} from '../_generated/proto/satellite';
import { getObjFromString, getSizeBuf, getTypeFromCode, SatPbMsg } from '../util/proto';
import { Socket } from '../sockets/index';
import _m0 from 'protobufjs/minimal.js';
import { EventEmitter } from 'events';
import { AuthResponse, ChangeType, RelationColumn, Replication, ReplicationStatus, SatelliteError, SatelliteErrorCode, Transaction } from '../util/types';
import { Client } from '.';
import { satelliteClientDefaults, SatelliteClientOpts } from './config';

export type AckCallback = () => void;

interface PrivateSatelliteOptions extends SatelliteClientOpts {
  timeout: number;
}

type IncomingHandler = { handle: (msg: any) => any | void, isRpc: boolean }

export class SatelliteClient extends EventEmitter implements Client {
  private opts: PrivateSatelliteOptions;

  private socket: Socket;
  private inbound: Replication;
  private outbound: Replication;

  private socketHandler?: (any: any) => void;
  private throttledPushTransaction?: () => void;

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

  constructor(socket: Socket, opts: SatelliteClientOpts) {
    super();

    this.opts = { ...satelliteClientDefaults, ...opts };
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
      transactions: []
    }
  }

  // TODO: handle connection errors
  connect(): Promise<void | SatelliteError> {
    return new Promise((resolve, reject) => {
      this.socket.onceConnect(() => {
        this.socketHandler = message => this.handleIncoming(message);
        this.socket.onMessage(this.socketHandler);
        resolve();
      })
      this.socket.onceError(error => reject(error))

      const { address, port } = this.opts;
      this.socket.open({ url: `ws://${address}:${port}/ws` });
    });
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.socketHandler = undefined;
      this.socket.closeAndRemoveListeners();
      resolve();
    });
  }

  startReplication(lsn: string): Promise<void | SatelliteError> {
    if (this.inbound.isReplicating != ReplicationStatus.STOPPED) {
      return Promise.reject(new SatelliteError(
        SatelliteErrorCode.REPLICATION_ALREADY_STARTED, `replication already started`));
    }
    this.inbound = this.resetReplication();
    this.outbound = this.resetReplication();

    this.inbound.isReplicating = ReplicationStatus.STARTING;
    this.inbound.ack_lsn = lsn;

    const request = SatInStartReplicationReq.fromPartial({ lsn });
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
      // move callback execution outside the message handling path
      await callback(txn)
      ackCb()
    });
  }

  enqueueTransaction(transaction: Transaction): void | SatelliteError {
    if (this.outbound.isReplicating != ReplicationStatus.ACTIVE) {
      throw new SatelliteError(SatelliteErrorCode.REPLICATION_NOT_STARTED,
        "enqueuing a transaction while outbound replication has not started")
    }

    this.outbound.transactions.push(transaction)
    if (this.throttledPushTransaction) {
      this.throttledPushTransaction()
    }
  }

  private pushTransactions() {
    if (this.outbound.isReplicating != ReplicationStatus.ACTIVE) {
      throw new SatelliteError(SatelliteErrorCode.REPLICATION_NOT_STARTED,
        "sending a transaction while outbound replication has not started")
    }

    while (this.outbound.transactions.length > 0) {
      const next = this.outbound.transactions.splice(0)[0]

      // TODO: divide into SatOpLog array with max size
      this.sendMissingRelations(next, this.outbound)
      const satOpLog: SatOpLog = this.transactionToSatOpLog(next)

      const buffer = Buffer.concat([
        getSizeBuf(satOpLog),
        SatOpLog.encode(satOpLog, _m0.Writer.create()).finish()]);
      this.socket.write(buffer)
    }
  }

  private sendMissingRelations(transaction: Transaction, replication: Replication): void {
    transaction.changes.forEach(change => {
      const relation = change.relation
      if (!this.outbound.relations.has(relation.id)) {
        replication.relations.set(relation.id, relation)

        const satRelation = SatRelation.fromPartial({
          relationId: relation.id,
          schemaName: relation.schema, // TODO
          tableName: relation.table,
          tableType: relation.tableType,
          columns: relation.columns.map(c =>
            SatRelationColumn.fromPartial({ name: c.name, type: c.type }))
        })

        const buffer = Buffer.concat([
          getSizeBuf(satRelation),
          SatRelation.encode(satRelation, _m0.Writer.create()).finish()]);
        this.socket.write(buffer)
      }
    })
  }

  private transactionToSatOpLog(transaction: Transaction): SatOpLog {
    const ops: SatTransOp[] = [SatTransOp.fromPartial({
      begin: {
        commitTimestamp: transaction.commit_timestamp.toString(),
        lsn: transaction.lsn
      }
    })]

    transaction.changes.forEach(tx => {
      let txOp, oldRecord, record
      const relation = this.outbound.relations.get(tx.relation.id)
      if (tx.oldRecord) {
        oldRecord = relation!.columns.reduce((acc: Uint8Array[], c: RelationColumn) => {
          if (tx.oldRecord![c.name] != undefined) {
            acc.push(this.serializeColumnData(tx.oldRecord![c.name], c))
          }
          return acc
        }, [])
      }
      if (tx.record) {
        record = relation!.columns.reduce((acc: Uint8Array[], c: RelationColumn) => {
          if (tx.record![c.name] != undefined) {
            acc.push(this.serializeColumnData(tx.record![c.name], c))
          }
          return acc
        }, [])
      }
      switch (tx.type) {
        case ChangeType.DELETE:
          txOp = SatTransOp.fromPartial({
            delete: {
              oldRowData: oldRecord,
            }
          })
          break
        case ChangeType.INSERT:
          txOp = SatTransOp.fromPartial({
            insert: {
              rowData: record,
            }
          })
          break
        case ChangeType.UPDATE:
          txOp = SatTransOp.fromPartial({
            update: {
              rowData: record,
              oldRowData: oldRecord
            }
          })
          break
      }
      ops.push(txOp)
    })

    ops.push(SatTransOp.fromPartial({ commit: {} }))
    return SatOpLog.fromPartial({ ops })
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

      const throttleOpts = { leading: true, trailing: true }
      this.throttledPushTransaction = throttle(() => this.pushTransactions(), this.opts.pushPeriod, throttleOpts)

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

      if (this.throttledPushTransaction) {
        this.throttledPushTransaction = undefined
      }

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

  private processOpLogMessage(opLogMessage: SatOpLog, replication: Replication) {
    opLogMessage.ops.map((op) => {
      if (op.begin) { 
        const transaction = {
          commit_timestamp: op.begin.commitTimestamp,
          lsn: op.begin.lsn,
          changes: []
        }
        replication.transactions.push(transaction);
      }

      const lastTxnIdx = replication.transactions.length - 1
      if (op.commit) {
        const { commit_timestamp, lsn, changes } = replication.transactions[lastTxnIdx];
        const transaction: Transaction = {
          commit_timestamp,
          lsn,
          changes
        }
        // in the future, emitting this event can be decoupled
        this.emit('transaction', transaction,
          () => this.inbound.ack_lsn = transaction.lsn as any);
        replication.transactions.splice(lastTxnIdx)
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
        replication.transactions[lastTxnIdx].changes.push(change);
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
        replication.transactions[lastTxnIdx].changes.push(change);
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
        replication.transactions[lastTxnIdx].changes.push(change);
      }
    });    
  }

  private deserializeColumnData(column: Uint8Array, columnInfo: RelationColumn): string | number {
    const columnType = columnInfo.type.toUpperCase();
    if (columnType == 'TEXT' || columnType == 'UUID') {
      return new String(column).toString();
    }
    if (columnType == 'INTEGER') {
      return new Number(column).valueOf();
    }
    throw new SatelliteError(SatelliteErrorCode.UNKNOWN_DATA_TYPE, `can't deserialize ${columnInfo.type}`);
  }

  private serializeColumnData(column: string | number, columnInfo: RelationColumn): Uint8Array {
    const textEncoder = new TextEncoder();
    const columnType = columnInfo.type.toUpperCase();
    if (columnType == 'TEXT' || columnType == 'UUID') {
      return textEncoder.encode(column as string)
    }
    if (columnType == 'INTEGER') {
      return textEncoder.encode(column.toString());
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
