import throttle from 'lodash.throttle'

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
  SatTransOp,
  SatOpRow,
  SatOpLog,
  SatPingResp,
  SatRelation,
  SatRelationColumn,
  SatAuthHeader,
  SatAuthHeaderPair,
} from '../_generated/proto/satellite';
import {
  getObjFromString, getSizeBuf, getTypeFromCode, SatPbMsg,
  getProtocolVersion, getFullTypeName
} from '../util/proto';
import { Socket, SocketFactory } from '../sockets/index';
import _m0 from 'protobufjs/minimal.js';
import { EventEmitter } from 'events';
import {
  AckCallback, AckType, AuthResponse, ChangeType, LSN, RelationColumn, Replication, ReplicationStatus, SatelliteError, SatelliteErrorCode, Transaction, Record, Relation
} from '../util/types';
import { base64, DEFAULT_LOG_POS, typeEncoder, typeDecoder } from '../util/common'
import { Client } from '.';
import { SatelliteClientOpts, satelliteClientDefaults } from './config';
import { backOff, IBackOffOptions } from 'exponential-backoff';
import { Notifier } from '../notifiers';
import Log from 'loglevel';
import { AuthState } from '../auth';

type IncomingHandler = { handle: (msg: any) => any | void, isRpc: boolean }

export class SatelliteClient extends EventEmitter implements Client {
  private opts: Required<SatelliteClientOpts>;
  private dbName: string;

  private socketFactory: SocketFactory;
  private socket?: Socket;

  private notifier: Notifier;

  private inbound: Replication;
  private outbound: Replication;

  private socketHandler?: (any: any) => void;
  private throttledPushTransaction?: () => void;

  private handlerForMessageType: { [k: string]: IncomingHandler } =
    Object.fromEntries(
      Object.entries(
        {
          "SatAuthResp": { handle: (resp: any) => this.handleAuthResp(resp), isRpc: true },
          "SatInStartReplicationResp": { handle: () => this.handleStartResp(), isRpc: true },
          "SatInStartReplicationReq": { handle: (req: any) => this.handleStartReq(req), isRpc: false },
          "SatInStopReplicationReq": { handle: () => this.handleStopReq(), isRpc: false },
          "SatInStopReplicationResp": { handle: () => this.handleStopResp(), isRpc: true },
          "SatPingReq": { handle: () => this.handlePingReq(), isRpc: true },
          "SatPingResp": { handle: (req: any) => this.handlePingResp(req), isRpc: false },
          "SatRelation": { handle: (req: any) => this.handleRelation(req), isRpc: false },
          "SatOpLog": { handle: (req: any) => this.handleTransaction(req), isRpc: false },
          "SatErrorResp": { handle: (error: SatErrorResp) => this.handleError(error), isRpc: false },
        }).map(e => [getFullTypeName(e[0]), e[1]]))

  connectionRetryPolicy: Partial<IBackOffOptions> = {
    delayFirstAttempt: false,
    startingDelay: 100,
    jitter: 'none',
    maxDelay: 100,
    numOfAttempts: 10,
    timeMultiple: 2
  }

  constructor(dbName: string, socketFactory: SocketFactory, notifier: Notifier, opts: SatelliteClientOpts) {
    super();

    this.dbName = dbName

    this.opts = { ...satelliteClientDefaults, ...opts };
    this.socketFactory = socketFactory;

    this.notifier = notifier;

    this.inbound = this.resetReplication();
    this.outbound = this.resetReplication();
  }

  private resetReplication(enqueued?: LSN, ack?: LSN, isReplicating?: ReplicationStatus): Replication {
    return {
      authenticated: false,
      isReplicating: isReplicating ? isReplicating : ReplicationStatus.STOPPED,
      relations: new Map(),
      ack_lsn: ack,
      enqueued_lsn: enqueued,
      transactions: []
    }
  }

  connect(retryHandler?: (error: any, attempt: number) => boolean): Promise<void | SatelliteError> {
    const connectPromise = new Promise<void>((resolve, reject) => {
      // TODO: ensure any previous socket is closed, or reject
      if (this.socket) {
        throw new SatelliteError(SatelliteErrorCode.UNEXPECTED_STATE, "a socket already exist. ensure it is closed before reconnecting.")
      }
      this.socket = this.socketFactory.create()
      this.socket.onceConnect(() => {
        this.socketHandler = message => this.handleIncoming(message)
        this.notifier.connectivityStateChange(this.dbName, 'connected')
        this.socket!.onMessage(this.socketHandler)
        this.socket!.onError(() => {
          this.notifier.connectivityStateChange(this.dbName, 'error')
        })
        this.socket!.onClose(() => {
          this.notifier.connectivityStateChange(this.dbName, 'disconnected')
        })
        resolve()
      })

      this.socket.onceError(error => {
        this.socket = undefined
        this.notifier.connectivityStateChange(this.dbName, "disconnected")
        reject(error)
      })

      const { host, port, ssl } = this.opts
      const url = `${ssl ? "wss" : "ws"}://${host}:${port}/ws`
      this.socket.open({ url })
    })

    const retryPolicy = { ...this.connectionRetryPolicy }
    if (retryHandler) {
      retryPolicy.retry = retryHandler
    }

    return backOff(() => connectPromise, retryPolicy);
  }

  close(): Promise<void> {
    Log.info("closing client")

    this.outbound = this.resetReplication(this.outbound.enqueued_lsn, this.outbound.ack_lsn)
    this.inbound = this.resetReplication(this.inbound.enqueued_lsn, this.inbound.ack_lsn)

    this.socketHandler = undefined;
    this.removeAllListeners();
    if (this.socket != undefined) {
      this.socket!.closeAndRemoveListeners();
      this.socket = undefined
    }

    return Promise.resolve()
  }

  isClosed(): boolean {
    return !this.socketHandler
  }

  startReplication(lsn?: LSN): Promise<void | SatelliteError> {
    if (this.inbound.isReplicating != ReplicationStatus.STOPPED) {
      return Promise.reject(new SatelliteError(
        SatelliteErrorCode.REPLICATION_ALREADY_STARTED, `replication already started`));
    }

    this.inbound = this.resetReplication(lsn, lsn, ReplicationStatus.STARTING)

    let request;
    if (!lsn || lsn.length == 0) {
      Log.info(`no previous LSN, start replication with option FIRST_LSN`)
      request = SatInStartReplicationReq.fromPartial({ options: [SatInStartReplicationReq_Option.FIRST_LSN] })
    } else {
      Log.info(`starting replication with lsn: ${base64.fromBytes(lsn)}`)
      request = SatInStartReplicationReq.fromPartial({ lsn })
    }

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

  authenticate({ clientId, token }: AuthState): Promise<AuthResponse | SatelliteError> {
    const headers = [SatAuthHeaderPair.fromPartial(
      {
        key: SatAuthHeader.PROTO_VERSION,
        value: getProtocolVersion()
      })]
    const request = SatAuthReq.fromPartial({
      id: clientId,
      token: token,
      headers: headers
    });
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
    this.outbound.enqueued_lsn = transaction.lsn

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

      // console.log(`sending message with lsn ${JSON.stringify(next.lsn)}`)
      this.sendMessage(satOpLog)
      this.emit('ack_lsn', next.lsn, AckType.LOCAL_SEND)
    }
  }

  subscribeToAck(callback: AckCallback): void {
    this.on('ack_lsn', callback)
  }

  unsubscribeToAck(callback: AckCallback) {
    this.removeListener('ack_lsn', callback)
  }

  subscribeToOutboundEvent(_event: 'started', callback: () => void): void {
    this.on('outbound_started', callback)
  }

  unsubscribeToOutboundEvent(_event: 'started', callback: () => void) {
    this.removeListener('outbound_started', callback)
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

        this.sendMessage(satRelation)
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
      const relation = this.outbound.relations.get(tx.relation.id)!

      if (tx.oldRecord) {
        oldRecord = serializeRow(tx.oldRecord, relation)
      }
      if (tx.record) {
        record = serializeRow(tx.record, relation)
      }
      switch (tx.type) {
        case ChangeType.DELETE:
          txOp = SatTransOp.fromPartial({
            delete: {
              oldRowData: oldRecord,
              relationId: relation.id
            }
          })
          break
        case ChangeType.INSERT:
          txOp = SatTransOp.fromPartial({
            insert: {
              rowData: record,
              relationId: relation.id
            }
          })
          break
        case ChangeType.UPDATE:
          txOp = SatTransOp.fromPartial({
            update: {
              rowData: record,
              oldRowData: oldRecord,
              relationId: relation.id
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
    Log.info(`received replication request ${JSON.stringify(message)}`)
    if (this.outbound.isReplicating == ReplicationStatus.STOPPED) {
      const replication = { ...this.outbound }
      if (!message.options.find(o =>
        o == SatInStartReplicationReq_Option.LAST_ACKNOWLEDGED)) {
        replication.ack_lsn = message.lsn;
        replication.enqueued_lsn = message.lsn;
      }
      if (!message.options.find(o =>
        o == SatInStartReplicationReq_Option.FIRST_LSN)) {
        replication.ack_lsn = DEFAULT_LOG_POS;
        replication.enqueued_lsn = DEFAULT_LOG_POS;
      }

      this.outbound = this.resetReplication(
        replication.enqueued_lsn,
        replication.ack_lsn,
        ReplicationStatus.ACTIVE);

      const throttleOpts = { leading: true, trailing: true }
      this.throttledPushTransaction = throttle(() => this.pushTransactions(), this.opts.pushPeriod, throttleOpts)

      const response = SatInStartReplicationResp.fromPartial({});
      this.sendMessage(response);
      this.emit('outbound_started', replication.enqueued_lsn)
    } else {
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
      const response = SatErrorResp.fromPartial({ errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED });
      this.sendMessage(response)

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
    Log.info(`respond to ping with last ack ${this.inbound.ack_lsn}`)
    const pong = SatPingResp.fromPartial({ lsn: this.inbound.ack_lsn });
    this.sendMessage(pong);
  }

  // TODO: emit ping request to clear oplog.
  private handlePingResp(message: SatPingResp) {
    if (message.lsn) {
      this.outbound.ack_lsn = message.lsn
      this.emit('ack_lsn', message.lsn, AckType.REMOTE_COMMIT)
    }
  }

  // It might be unsafe not to clear the log before 
  // applying incoming operations that are ordered
  // after the last acked position.
  // TODO: come back here



  private handleError(error: SatErrorResp) {
    this.emit('error',
      new Error(`server replied with error code: ${error.errorType}`))
  }

  // TODO: properly handle socket errors; update connectivity state
  private handleIncoming(data: Buffer) {
    const messageOrError = this.toMessage(data);
    Log.info(`Received message ${JSON.stringify(messageOrError)}`)
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
          () => this.inbound.ack_lsn = transaction.lsn);
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
          record: deserializeRow(op.insert.rowData!, rel)
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
          record: deserializeRow(op.update.rowData!, rel),
          oldRecord: deserializeRow(op.update.oldRowData, rel)
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
          oldRecord: deserializeRow(op.delete.oldRowData!, rel)
        });

        replication.transactions[lastTxnIdx].changes.push(change);
      }
    });
  }

  private toMessage(data: Uint8Array): SatPbMsg | Error {
    const code = data[0]
    const type = getTypeFromCode(code);
    const obj = getObjFromString(type);
    if (obj == undefined) {
      return new SatelliteError(SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE, `${code})`);
    }
    return obj.decode(data.subarray(1));
  }

  private sendMessage(request: SatPbMsg) {
    Log.info(`Sending message ${JSON.stringify(request)}`)
    if (!this.socket) {
      throw new SatelliteError(SatelliteErrorCode.UNEXPECTED_STATE, "trying to send message, but no socket exists")
    }
    const obj = getObjFromString(request.$type);
    if (obj == undefined) {
      throw new SatelliteError(SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE, `${request.$type})`);
    }

    const type = getSizeBuf(request)
    const msg = obj.encode(request, _m0.Writer.create()).finish()
    const buffer = new Uint8Array(type.length + msg.length)
    buffer.set(type, 0)
    buffer.set(msg, 1)

    this.socket.write(buffer);
  }

  private async rpc<T>(request: SatPbMsg): Promise<T | SatelliteError> {
    let waitingFor: NodeJS.Timeout;
    return new Promise<T | SatelliteError>((resolve, reject) => {
      waitingFor = setTimeout(() => {
        console.log(`${request.$type}`)
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

  resetOutboundLogPositions(sent: LSN, ack: LSN): void {
    this.outbound = this.resetReplication(sent, ack)
  }

  getOutboundLogPositions(): { enqueued: LSN, ack: LSN } {
    return {
      ack: this.outbound.ack_lsn ?? DEFAULT_LOG_POS,
      enqueued: this.outbound.enqueued_lsn ?? DEFAULT_LOG_POS
    }
  }
}

export function serializeRow(rec: Record, relation: Relation): SatOpRow {
  var recordNumColumn = 0
  var recordNullBitMask = new Uint8Array(calculateNumBytes(relation.columns.length))
  var recordValues = relation!.columns.reduce((acc: Uint8Array[], c: RelationColumn) => {
    if (rec[c.name] != null) {
      acc.push(serializeColumnData(rec[c.name]!))
    }
    else {
      acc.push(serializeNullData())
      setMaskBit(recordNullBitMask, recordNumColumn)
    }
    recordNumColumn = recordNumColumn + 1
    return acc
  }, [])
  return SatOpRow.fromPartial({
    nullsBitmask: recordNullBitMask,
    values: recordValues
  })
}

export function deserializeRow(row: SatOpRow | undefined, relation: Relation): Record | undefined {
  if (row == undefined) { return undefined }
  return Object.fromEntries(relation!.columns.map(
    (c, i) => {
      var value;
      if (getMaskBit(row.nullsBitmask, i) == 1) {
        value = null
      }
      else {
        value = deserializeColumnData(row.values[i], c);
      }
      return [c.name, value]
    }))
}

/**
 * Sets a bit in the mask. Modifies the mask in place.
 * 
 * Mask is represented as a Uint8Array, which will be serialized element-by-element as a mask.
 * This means that `indexFromStart` enumerates all bits in the mask in the order they will be serialized:
 * 
 * @example
 * setMaskBit(new Uint8Array([0b00000000, 0b00000000]), 0)
 * // => new Uint8Array([0b10000000, 0b00000000])
 * 
 * @example
 * setMaskBit(new Uint8Array([0b00000000, 0b00000000]), 8)
 * // => new Uint8Array([0b00000000, 0b10000000])
 * 
 * @param array Uint8Array mask
 * @param indexFromStart bit index in the mask
 */
function setMaskBit(array: Uint8Array, indexFromStart: number): void {
  const byteIndex = Math.floor(indexFromStart / 8)
  const bitIndex = 7 - (indexFromStart % 8)

  const mask = 0x01 << bitIndex
  array[byteIndex] = array[byteIndex] | mask
}

/**
 * Reads a bit in the mask
 * 
 * Mask is represented as a Uint8Array, which will be serialized element-by-element as a mask.
 * This means that `indexFromStart` enumerates all bits in the mask in the order they will be serialized:
 * 
 * @example
 * getMaskBit(new Uint8Array([0b10000000, 0b00000000]), 0)
 * // => 1
 * 
 * @example
 * getMaskBit(new Uint8Array([0b10000000, 0b00000000]), 8)
 * // => 0
 * 
 * @param array Uint8Array mask
 * @param indexFromStart bit index in the mask
 */
function getMaskBit(array: Uint8Array, indexFromStart: number): number {
  const byteIndex = Math.floor(indexFromStart / 8)
  const bitIndex = 7 - (indexFromStart % 8)

  return (array[byteIndex] >>> bitIndex) & 0x01;
}

function calculateNumBytes(column_num: number): number {
  let rem = column_num % 8
  if (rem == 0) {
    return column_num / 8;
  }
  else {
    return 1 + ((column_num - rem) / 8);
  }
}

function deserializeColumnData(column: Uint8Array, columnInfo: RelationColumn): string | number {
  const columnType = columnInfo.type.toUpperCase();
  switch (columnType) {
    case 'CHAR':
    case 'TEXT':
    case 'UUID':
    case 'VARCHAR':
      return typeDecoder.text(column);
    case 'FLOAT4':
    case 'FLOAT8':
    case 'INT':
    case 'INT2':
    case 'INT4':
    case 'INT8':
    case 'INTEGER':
      return Number(typeDecoder.text(column));
  }
  throw new SatelliteError(SatelliteErrorCode.UNKNOWN_DATA_TYPE, `can't deserialize ${columnInfo.type}`);
}

// All values serialized as textual representation
function serializeColumnData(column: string | number): Uint8Array {
  return typeEncoder.text(column as string);
}

function serializeNullData(): Uint8Array {
  return typeEncoder.text("");
}
