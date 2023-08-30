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
  SatTransOp,
  SatOpRow,
  SatOpLog,
  SatPingResp,
  SatRelation,
  SatRelationColumn,
  SatAuthHeader,
  SatAuthHeaderPair,
  SatSubsResp,
  SatSubsReq,
  SatSubsDataError,
  SatSubsDataBegin,
  SatSubsDataEnd,
  SatShapeDataBegin,
  SatShapeDataEnd,
  SatUnsubsReq,
  SatUnsubsResp,
} from '../_generated/protocol/satellite'
import {
  getObjFromString,
  getSizeBuf,
  getTypeFromCode,
  SatPbMsg,
  getProtocolVersion,
  getFullTypeName,
  startReplicationErrorToSatelliteError,
  shapeRequestToSatShapeReq,
  subsErrorToSatelliteError,
  msgToString,
  serverErrorToSatelliteError,
} from '../util/proto'
import { Socket, SocketFactory } from '../sockets/index'
import _m0 from 'protobufjs/minimal.js'
import { EventEmitter } from 'events'
import {
  AuthResponse,
  DataChangeType,
  LSN,
  RelationColumn,
  Replication,
  ReplicationStatus,
  SatelliteError,
  SatelliteErrorCode,
  DataTransaction,
  Record,
  Relation,
  SchemaChange,
  OutgoingReplication,
  Transaction,
  StartReplicationResponse,
  StopReplicationResponse,
  ErrorCallback,
} from '../util/types'
import {
  base64,
  DEFAULT_LOG_POS,
  typeEncoder,
  typeDecoder,
  bytesToNumber,
} from '../util/common'
import { Client } from '.'
import { SatelliteClientOpts, satelliteClientDefaults } from './config'
import { Notifier } from '../notifiers'
import Log from 'loglevel'
import { AuthState } from '../auth'
import isequal from 'lodash.isequal'
import {
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  ShapeRequest,
  SubscribeResponse,
  SubscriptionDeliveredCallback,
  SubscriptionErrorCallback,
  UnsubscribeResponse,
} from './shapes/types'
import { SubscriptionsDataCache } from './shapes/cache'
import { setMaskBit, getMaskBit } from '../util/bitmaskHelpers'

type IncomingHandler = {
  handle: (
    msg: any
  ) =>
    | void
    | AuthResponse
    | StartReplicationResponse
    | StopReplicationResponse
    | SubscribeResponse
    | UnsubscribeResponse
  isRpc: boolean
}

const subscriptionError = [
  SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
  SatelliteErrorCode.SUBSCRIPTION_ERROR,
  SatelliteErrorCode.SUBSCRIPTION_ALREADY_EXISTS,
  SatelliteErrorCode.SUBSCRIPTION_ID_ALREADY_EXISTS,
  SatelliteErrorCode.SUBSCRIPTION_NOT_FOUND,
  SatelliteErrorCode.SHAPE_DELIVERY_ERROR,
]

export class SatelliteClient extends EventEmitter implements Client {
  private opts: Required<SatelliteClientOpts>

  private socketFactory: SocketFactory
  private socket?: Socket

  private inbound: Replication
  private outbound: OutgoingReplication

  // can only handle a single subscription at a time
  private subscriptionsDataCache: SubscriptionsDataCache

  private socketHandler?: (any: any) => void
  private throttledPushTransaction?: () => void

  private handlerForMessageType: { [k: string]: IncomingHandler } =
    Object.fromEntries(
      Object.entries({
        SatAuthResp: {
          handle: (resp: any) => this.handleAuthResp(resp),
          isRpc: true,
        },
        SatInStartReplicationResp: {
          handle: (resp: SatInStartReplicationResp) =>
            this.handleStartResp(resp),
          isRpc: true,
        },
        SatInStartReplicationReq: {
          handle: (req: any) => this.handleStartReq(req),
          isRpc: false,
        },
        SatInStopReplicationReq: {
          handle: () => this.handleStopReq(),
          isRpc: false,
        },
        SatInStopReplicationResp: {
          handle: () => this.handleStopResp(),
          isRpc: true,
        },
        SatPingReq: { handle: () => this.handlePingReq(), isRpc: true },
        SatPingResp: {
          handle: (req: any) => this.handlePingResp(req),
          isRpc: false,
        },
        SatRelation: {
          handle: (req: any) => this.handleRelation(req),
          isRpc: false,
        },
        SatOpLog: {
          handle: (req: any) => this.handleTransaction(req),
          isRpc: false,
        },
        SatErrorResp: {
          handle: (error: SatErrorResp) => this.handleError(error),
          isRpc: false,
        },
        SatSubsResp: {
          handle: (sub: SatSubsResp) => this.handleSubscription(sub),
          isRpc: true,
        },
        SatSubsDataError: {
          handle: (msg: SatSubsDataError) => this.handleSubscriptionError(msg),
          isRpc: false,
        },
        SatSubsDataBegin: {
          handle: (msg: SatSubsDataBegin) =>
            this.handleSubscriptionDataBegin(msg),
          isRpc: false,
        },
        SatSubsDataEnd: {
          handle: (msg: SatSubsDataEnd) => this.handleSubscriptionDataEnd(msg),
          isRpc: false,
        },
        SatShapeDataBegin: {
          handle: (msg: SatShapeDataBegin) => this.handleShapeDataBegin(msg),
          isRpc: false,
        },
        SatShapeDataEnd: {
          handle: (msg: SatShapeDataEnd) => this.handleShapeDataEnd(msg),
          isRpc: false,
        },
        SatUnsubsResp: {
          handle: (msg: SatUnsubsResp) => this.handleUnsubscribeResponse(msg),
          isRpc: true,
        },
      }).map((e) => [getFullTypeName(e[0]), e[1]])
    )

  constructor(
    _dbName: string,
    socketFactory: SocketFactory,
    _notifier: Notifier,
    opts: SatelliteClientOpts
  ) {
    super()

    this.opts = { ...satelliteClientDefaults, ...opts }
    this.socketFactory = socketFactory

    this.inbound = this.resetReplication()
    this.outbound = this.resetReplication()

    this.subscriptionsDataCache = new SubscriptionsDataCache()
  }

  private resetReplication(
    enqueued?: LSN,
    isReplicating?: ReplicationStatus
  ): OutgoingReplication {
    return {
      authenticated: false,
      isReplicating: isReplicating ? isReplicating : ReplicationStatus.STOPPED,
      relations: new Map(),
      enqueued_lsn: enqueued,
      transactions: [],
    }
  }

  async connect(): Promise<void> {
    if (!this.isClosed()) {
      this.close()
    }

    return new Promise<void>((resolve, reject) => {
      this.socket = this.socketFactory.create()

      const onceError = (error: Error) => {
        this.close()
        reject(error)
      }

      const onceConnect = () => {
        if (!this.socket)
          throw new SatelliteError(
            SatelliteErrorCode.UNEXPECTED_STATE,
            'socket got unassigned somehow'
          )

        this.socket.removeErrorListener(onceError)
        this.socketHandler = (message) => this.handleIncoming(message)

        this.socket.onMessage(this.socketHandler)
        this.socket.onError((error) => {
          if (this.listenerCount('error') === 0) {
            this.close()
            Log.error(
              `socket error but no listener is attached: ${error.message}`
            )
          }
          this.emit('error', error)
        })
        this.socket.onClose(() => {
          this.close()
          if (this.listenerCount('error') === 0) {
            Log.error(`socket closed but no listener is attached`)
          }
          this.emit(
            'error',
            new SatelliteError(SatelliteErrorCode.SOCKET_ERROR, 'socket closed')
          )
        })

        resolve()
      }

      this.socket.onceError(onceError)
      this.socket.onceConnect(onceConnect)

      const { host, port, ssl } = this.opts
      const url = `${ssl ? 'wss' : 'ws'}://${host}:${port}/ws`
      this.socket.open({ url })
    })
  }

  close() {
    this.outbound = this.resetReplication(this.outbound.enqueued_lsn)
    this.inbound = this.resetReplication(this.inbound.enqueued_lsn)

    this.socketHandler = undefined

    if (this.socket !== undefined) {
      this.socket!.closeAndRemoveListeners()
      this.socket = undefined
    }
  }

  isClosed(): boolean {
    return !this.socketHandler
  }

  startReplication(
    lsn?: LSN,
    schemaVersion?: string,
    subscriptionIds?: string[]
  ): Promise<StartReplicationResponse> {
    if (this.inbound.isReplicating !== ReplicationStatus.STOPPED) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.REPLICATION_ALREADY_STARTED,
          `replication already started`
        )
      )
    }

    // Perform validations and prepare the request
    let request: SatInStartReplicationReq
    if (!lsn || lsn.length == 0) {
      Log.info(`no previous LSN, start replication from scratch`)
      if (subscriptionIds && subscriptionIds.length > 0) {
        return Promise.reject(
          new SatelliteError(
            SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
            `Cannot start replication with subscription IDs but without previous LSN.`
          )
        )
      }
      request = SatInStartReplicationReq.fromPartial({ schemaVersion })
    } else {
      Log.info(
        `starting replication with lsn: ${base64.fromBytes(
          lsn
        )} subscriptions: ${subscriptionIds}`
      )
      request = SatInStartReplicationReq.fromPartial({ lsn, subscriptionIds })
    }

    // Then set the replication state
    this.inbound = this.resetReplication(lsn, ReplicationStatus.STARTING)
    return this.rpc<StartReplicationResponse, SatInStartReplicationReq>(request)
  }

  stopReplication(): Promise<StopReplicationResponse> {
    if (this.inbound.isReplicating !== ReplicationStatus.ACTIVE) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.REPLICATION_NOT_STARTED,
          `replication not active`
        )
      )
    }

    this.inbound.isReplicating = ReplicationStatus.STOPPING
    const request = SatInStopReplicationReq.fromPartial({})
    return this.rpc(request)
  }

  authenticate({ clientId, token }: AuthState): Promise<AuthResponse> {
    const headers = [
      SatAuthHeaderPair.fromPartial({
        key: SatAuthHeader.PROTO_VERSION,
        value: getProtocolVersion(),
      }),
    ]
    const request = SatAuthReq.fromPartial({
      id: clientId,
      token: token,
      headers: headers,
    })
    return this.rpc<AuthResponse>(request)
  }

  subscribeToTransactions(
    callback: (transaction: Transaction) => Promise<void>
  ) {
    this.on('transaction', async (txn, ackCb) => {
      // move callback execution outside the message handling path
      await callback(txn)
      ackCb()
    })
  }

  subscribeToRelations(callback: (relation: Relation) => void) {
    this.on('relation', callback)
  }

  enqueueTransaction(transaction: DataTransaction): void {
    if (this.outbound.isReplicating !== ReplicationStatus.ACTIVE) {
      throw new SatelliteError(
        SatelliteErrorCode.REPLICATION_NOT_STARTED,
        'enqueuing a transaction while outbound replication has not started'
      )
    }

    this.outbound.transactions.push(transaction)
    this.outbound.enqueued_lsn = transaction.lsn

    this.throttledPushTransaction?.()
  }

  private pushTransactions() {
    if (this.outbound.isReplicating !== ReplicationStatus.ACTIVE) {
      throw new SatelliteError(
        SatelliteErrorCode.REPLICATION_NOT_STARTED,
        'sending a transaction while outbound replication has not started'
      )
    }

    let next: DataTransaction | undefined
    while ((next = this.outbound.transactions.shift())) {
      // TODO: divide into SatOpLog array with max size
      this.sendMissingRelations(next, this.outbound)
      const satOpLog: SatOpLog = this.transactionToSatOpLog(next)

      this.sendMessage(satOpLog)
    }
  }

  subscribeToError(callback: ErrorCallback): void {
    this.on('error', callback)
  }

  unsubscribeToError(callback: ErrorCallback): void {
    this.removeListener('error', callback)
  }

  subscribeToOutboundEvent(_event: 'started', callback: () => void): void {
    this.on('outbound_started', callback)
  }

  unsubscribeToOutboundEvent(_event: 'started', callback: () => void) {
    this.removeListener('outbound_started', callback)
  }

  subscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void {
    this.subscriptionsDataCache.on(SUBSCRIPTION_DELIVERED, successCallback)
    this.subscriptionsDataCache.on(SUBSCRIPTION_ERROR, errorCallback)
  }

  unsubscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void {
    this.subscriptionsDataCache.removeListener(
      SUBSCRIPTION_DELIVERED,
      successCallback
    )
    this.subscriptionsDataCache.removeListener(
      SUBSCRIPTION_ERROR,
      errorCallback
    )
  }

  async subscribe(
    subscriptionId: string,
    shapes: ShapeRequest[]
  ): Promise<SubscribeResponse> {
    if (this.inbound.isReplicating !== ReplicationStatus.ACTIVE) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.REPLICATION_NOT_STARTED,
          `replication not active`
        )
      )
    }

    const request = SatSubsReq.fromPartial({
      subscriptionId,
      shapeRequests: shapeRequestToSatShapeReq(shapes),
    })

    this.subscriptionsDataCache.subscriptionRequest(request)
    return this.rpc<SubscribeResponse, SatSubsReq>(request, 'subscriptionId')
  }

  unsubscribe(subIds: string[]): Promise<UnsubscribeResponse> {
    if (this.inbound.isReplicating !== ReplicationStatus.ACTIVE) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.REPLICATION_NOT_STARTED,
          `replication not active`
        )
      )
    }

    const request = SatUnsubsReq.fromPartial({
      subscriptionIds: subIds,
    })

    return this.rpc(request)
  }

  private sendMissingRelations(
    transaction: DataTransaction,
    replication: Replication
  ): void {
    transaction.changes.forEach((change) => {
      const relation = change.relation
      if (
        // this is a new relation
        !this.outbound.relations.has(relation.id) ||
        // or, the relation has changed
        !isequal(this.outbound.relations.get(relation.id), relation)
      ) {
        replication.relations.set(relation.id, relation)

        const satRelation = SatRelation.fromPartial({
          relationId: relation.id,
          schemaName: relation.schema, // TODO
          tableName: relation.table,
          tableType: relation.tableType,
          columns: relation.columns.map((c) =>
            SatRelationColumn.fromPartial({
              name: c.name,
              type: c.type,
              isNullable: c.isNullable,
            })
          ),
        })

        this.sendMessage(satRelation)
      }
    })
  }

  private transactionToSatOpLog(transaction: DataTransaction): SatOpLog {
    const ops: SatTransOp[] = [
      SatTransOp.fromPartial({
        begin: {
          commitTimestamp: transaction.commit_timestamp.toString(),
          lsn: transaction.lsn,
        },
      }),
    ]

    transaction.changes.forEach((change) => {
      let changeOp, oldRecord, record
      const relation = this.outbound.relations.get(change.relation.id)!
      const tags = change.tags
      if (change.oldRecord) {
        oldRecord = serializeRow(change.oldRecord, relation)
      }
      if (change.record) {
        record = serializeRow(change.record, relation)
      }
      switch (change.type) {
        case DataChangeType.DELETE:
          changeOp = SatTransOp.fromPartial({
            delete: {
              oldRowData: oldRecord,
              relationId: relation.id,
              tags: tags,
            },
          })
          break
        case DataChangeType.INSERT:
          changeOp = SatTransOp.fromPartial({
            insert: {
              rowData: record,
              relationId: relation.id,
              tags: tags,
            },
          })
          break
        case DataChangeType.UPDATE:
          changeOp = SatTransOp.fromPartial({
            update: {
              rowData: record,
              oldRowData: oldRecord,
              relationId: relation.id,
              tags: tags,
            },
          })
          break
      }
      ops.push(changeOp)
    })

    ops.push(SatTransOp.fromPartial({ commit: {} }))
    return SatOpLog.fromPartial({ ops })
  }

  private handleAuthResp(message: SatAuthResp | SatErrorResp): AuthResponse {
    let error, serverId
    if (message.$type == SatAuthResp.$type) {
      serverId = message.id
      this.inbound.authenticated = true
    } else {
      error = new SatelliteError(
        SatelliteErrorCode.AUTH_ERROR,
        `An internal error occurred during authentication`
      )
    }
    return { serverId, error }
  }

  private handleStartResp(
    resp: SatInStartReplicationResp
  ): StartReplicationResponse {
    if (this.inbound.isReplicating == ReplicationStatus.STARTING) {
      if (resp.err) {
        this.inbound.isReplicating = ReplicationStatus.STOPPED
        return { error: startReplicationErrorToSatelliteError(resp.err) }
      } else {
        this.inbound.isReplicating = ReplicationStatus.ACTIVE
      }
    } else {
      return {
        error: new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${this.inbound.isReplicating} handling 'start' response`
        ),
      }
    }
    return {}
  }

  private handleStartReq(message: SatInStartReplicationReq) {
    Log.info(
      `Server sent a replication request to start from ${bytesToNumber(
        message.lsn
      )}, and options ${JSON.stringify(message.options)}`
    )

    if (this.outbound.isReplicating == ReplicationStatus.STOPPED) {
      // Use server-sent LSN as the starting point for replication
      this.outbound = this.resetReplication(
        message.lsn,
        ReplicationStatus.ACTIVE
      )

      this.throttledPushTransaction = throttle(
        () => this.pushTransactions(),
        this.opts.pushPeriod,
        { leading: true, trailing: true }
      )

      const response = SatInStartReplicationResp.fromPartial({})
      this.sendMessage(response)
      this.emit('outbound_started', message.lsn)
    } else {
      const response = SatErrorResp.fromPartial({
        errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED,
      })
      this.sendMessage(response)

      this.emit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${this.outbound.isReplicating} handling 'start' request`
        )
      )
    }
  }

  private handleStopReq() {
    if (this.outbound.isReplicating == ReplicationStatus.ACTIVE) {
      this.outbound.isReplicating = ReplicationStatus.STOPPED

      if (this.throttledPushTransaction) {
        this.throttledPushTransaction = undefined
      }

      const response = SatInStopReplicationResp.fromPartial({})
      this.sendMessage(response)
    } else {
      const response = SatErrorResp.fromPartial({
        errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED,
      })
      this.sendMessage(response)

      this.emit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${this.inbound.isReplicating} handling 'stop' request`
        )
      )
    }
  }

  private handleStopResp(): StopReplicationResponse {
    if (this.inbound.isReplicating == ReplicationStatus.STOPPING) {
      this.inbound.isReplicating = ReplicationStatus.STOPPED
      return {}
    }

    return {
      error: new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        `unexpected state ${this.inbound.isReplicating} handling 'stop' response`
      ),
    }
  }

  private handleRelation(message: SatRelation) {
    if (this.inbound.isReplicating !== ReplicationStatus.ACTIVE) {
      this.emit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${this.inbound.isReplicating} handling 'relation' message`
        )
      )
      return
    }

    const relation = {
      id: message.relationId,
      schema: message.schemaName,
      table: message.tableName,
      tableType: message.tableType,
      columns: message.columns.map((c) => ({
        name: c.name,
        type: c.type,
        isNullable: c.isNullable,
        primaryKey: c.primaryKey,
      })),
    }

    this.inbound.relations.set(relation.id, relation)
    this.emit('relation', relation)
  }

  private handleTransaction(message: SatOpLog) {
    if (!this.subscriptionsDataCache.isDelivering()) {
      this.processOpLogMessage(message)
    } else {
      try {
        this.subscriptionsDataCache.transaction(message.ops)
      } catch (e) {
        Log.info(
          `Error applying transaction message for subs ${JSON.stringify(e)}`
        )
      }
    }
  }

  private handlePingReq() {
    Log.info(
      `respond to ping with last ack ${
        this.inbound.ack_lsn ? base64.fromBytes(this.inbound.ack_lsn) : 'NULL'
      }`
    )
    const pong = SatPingResp.fromPartial({ lsn: this.inbound.ack_lsn })
    this.sendMessage(pong)
  }

  private handlePingResp(_message: SatPingResp) {
    // TODO: This message is not used in any way right now.
    //       We might be dropping client-initiated pings completely.
    //       However, the server sends these messages without any prompting,
    //       so this handler cannot just throw an error
  }

  private handleError(error: SatErrorResp) {
    this.emit('error', serverErrorToSatelliteError(error))
  }

  private handleSubscription(msg: SatSubsResp): SubscribeResponse {
    if (msg.err) {
      const error = subsErrorToSatelliteError(msg.err)
      this.subscriptionsDataCache.subscriptionError(msg.subscriptionId)
      return { subscriptionId: msg.subscriptionId, error }
    } else {
      this.subscriptionsDataCache.subscriptionResponse(msg)
      return { subscriptionId: msg.subscriptionId }
    }
  }

  private handleSubscriptionError(msg: SatSubsDataError): void {
    this.subscriptionsDataCache.subscriptionDataError(msg.subscriptionId, msg)
  }

  private handleSubscriptionDataBegin(msg: SatSubsDataBegin): void {
    this.subscriptionsDataCache.subscriptionDataBegin(msg)
  }

  private handleSubscriptionDataEnd(_msg: SatSubsDataEnd): void {
    this.subscriptionsDataCache.subscriptionDataEnd(this.inbound.relations)
  }

  private handleShapeDataBegin(msg: SatShapeDataBegin): void {
    this.subscriptionsDataCache.shapeDataBegin(msg)
  }

  private handleShapeDataEnd(_msg: SatShapeDataEnd): void {
    this.subscriptionsDataCache.shapeDataEnd()
  }

  // For now, unsubscribe responses doesn't send any information back
  // It might eventually confirm that the server processed it or was noop.
  private handleUnsubscribeResponse(_msg: SatUnsubsResp): UnsubscribeResponse {
    return {}
  }

  // TODO: properly handle socket errors; update connectivity state
  private handleIncoming(data: Buffer) {
    let handleIsRpc = false
    try {
      const message = toMessage(data)

      if (Log.getLevel() <= 1) {
        Log.debug(`[proto] recv: ${msgToString(message)}`)
      }

      const handler = this.handlerForMessageType[message.$type]
      const response = handler.handle(message)
      if ((handleIsRpc = handler.isRpc)) {
        this.emit('rpc_response', response)
      }
    } catch (error) {
      if (error instanceof SatelliteError) {
        if (handleIsRpc) {
          this.emit('rpc_error', error)
        } else {
          // subscription errors are emitted through specific event
          if (!subscriptionError.includes(error.code)) {
            this.emit('error', error)
          }
        }
      } else {
        // This is an unexpected runtime error
        throw error
      }
    }
  }

  private processOpLogMessage(opLogMessage: SatOpLog): void {
    const replication = this.inbound
    opLogMessage.ops.map((op) => {
      if (op.begin) {
        const transaction = {
          commit_timestamp: op.begin.commitTimestamp,
          lsn: op.begin.lsn,
          changes: [],
          origin: op.begin.origin!,
        }
        replication.transactions.push(transaction)
      }

      const lastTxnIdx = replication.transactions.length - 1
      if (op.commit) {
        const { commit_timestamp, lsn, changes, origin } =
          replication.transactions[lastTxnIdx]
        const transaction: Transaction = {
          commit_timestamp,
          lsn,
          changes,
          origin,
        }
        this.emit(
          'transaction',
          transaction,
          () => (this.inbound.ack_lsn = transaction.lsn)
        )
        replication.transactions.splice(lastTxnIdx)
      }

      if (op.insert) {
        const rid = op.insert.relationId
        const rel = replication.relations.get(rid)
        if (!rel) {
          throw new SatelliteError(
            SatelliteErrorCode.PROTOCOL_VIOLATION,
            `missing relation ${op.insert.relationId} for incoming operation`
          )
        }

        const change = {
          relation: rel,
          type: DataChangeType.INSERT,
          record: deserializeRow(op.insert.rowData!, rel),
          tags: op.insert.tags,
        }

        replication.transactions[lastTxnIdx].changes.push(change)
      }

      if (op.update) {
        const rid = op.update.relationId
        const rel = replication.relations.get(rid)
        if (!rel) {
          throw new SatelliteError(
            SatelliteErrorCode.PROTOCOL_VIOLATION,
            'missing relation for incoming operation'
          )
        }

        const change = {
          relation: rel,
          type: DataChangeType.UPDATE,
          record: deserializeRow(op.update.rowData!, rel),
          oldRecord: deserializeRow(op.update.oldRowData, rel),
          tags: op.update.tags,
        }

        replication.transactions[lastTxnIdx].changes.push(change)
      }

      if (op.delete) {
        const rid = op.delete.relationId
        const rel = replication.relations.get(rid)
        if (!rel) {
          throw new SatelliteError(
            SatelliteErrorCode.PROTOCOL_VIOLATION,
            'missing relation for incoming operation'
          )
        }

        const change = {
          relation: rel,
          type: DataChangeType.DELETE,
          oldRecord: deserializeRow(op.delete.oldRowData!, rel),
          tags: op.delete.tags,
        }

        replication.transactions[lastTxnIdx].changes.push(change)
      }

      if (op.migrate) {
        // store the version of this migration transaction
        // (within 1 transaction, every SatOpMigrate message
        //  has the same version number)
        // TODO: in the protocol: move the `version` field to the SatOpBegin message
        //       or replace the `is_migration` field by an optional `version` field
        //       --> see issue VAX-718 on linear.
        const tx = replication.transactions[lastTxnIdx]
        tx.migrationVersion = op.migrate.version

        const stmts = op.migrate.stmts
        stmts.forEach((stmt) => {
          const change: SchemaChange = {
            table: op.migrate!.table!,
            migrationType: stmt.type,
            sql: stmt.sql,
          }
          tx.changes.push(change)
        })
      }
    })
  }

  private sendMessage<T extends SatPbMsg>(request: T) {
    if (Log.getLevel() <= 1) Log.debug(`[proto] send: ${msgToString(request)}`)
    if (!this.socket || this.isClosed()) {
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        'trying to send message, but client is closed'
      )
    }
    const obj = getObjFromString(request.$type)
    if (obj == undefined) {
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
        `${request.$type})`
      )
    }

    const type = getSizeBuf(request)
    const msg = obj.encode(request, _m0.Writer.create()).finish()
    const buffer = new Uint8Array(type.length + msg.length)
    buffer.set(type, 0)
    buffer.set(msg, 1)

    this.socket.write(buffer)
  }

  private async rpc<T, Msg extends SatPbMsg = SatPbMsg>(
    request: Msg,
    distinguishOn?: keyof Msg & keyof T
  ): Promise<T> {
    let waitingFor: NodeJS.Timeout
    return new Promise<T>((resolve, reject) => {
      waitingFor = setTimeout(() => {
        Log.error(`${request.$type}`)
        const error = new SatelliteError(
          SatelliteErrorCode.TIMEOUT,
          `${request.$type}`
        )
        return reject(error)
      }, this.opts.timeout)

      // reject on any error
      const errorListener = (error: any) => {
        return reject(error)
      }

      this.once('rpc_error', errorListener)
      if (distinguishOn) {
        const handleRpcResp = (resp: T) => {
          // TODO: remove this comment when RPC types are fixed
          // @ts-ignore this comparison is valid because we expect the same field to be present on both request and response, but it's too much work at the moment to rewrite typings for it
          if (resp[distinguishOn] === request[distinguishOn]) {
            this.removeListener('rpc_error', errorListener)
            return resolve(resp)
          } else {
            // This WAS an RPC response, but not the one we were expecting, waiting more
            this.once('rpc_response', handleRpcResp)
          }
        }
        this.once('rpc_response', handleRpcResp)
      } else {
        this.once('rpc_response', (resp: T) => {
          this.removeListener('rpc_error', errorListener)
          resolve(resp)
        })
      }
      this.sendMessage(request)
    }).finally(() => clearTimeout(waitingFor))
  }

  getLastSentLsn(): LSN {
    return this.outbound.enqueued_lsn ?? DEFAULT_LOG_POS
  }
}

export function serializeRow(rec: Record, relation: Relation): SatOpRow {
  let recordNumColumn = 0
  const recordNullBitMask = new Uint8Array(
    calculateNumBytes(relation.columns.length)
  )
  const recordValues = relation!.columns.reduce(
    (acc: Uint8Array[], c: RelationColumn) => {
      if (rec[c.name] != null) {
        acc.push(serializeColumnData(rec[c.name]!))
      } else {
        acc.push(serializeNullData())
        setMaskBit(recordNullBitMask, recordNumColumn)
      }
      recordNumColumn = recordNumColumn + 1
      return acc
    },
    []
  )
  return SatOpRow.fromPartial({
    nullsBitmask: recordNullBitMask,
    values: recordValues,
  })
}

export function deserializeRow(
  row: SatOpRow | undefined,
  relation: Relation
): Record | undefined {
  if (row == undefined) {
    return undefined
  }
  return Object.fromEntries(
    relation!.columns.map((c, i) => {
      let value
      if (getMaskBit(row.nullsBitmask, i) == 1) {
        value = null
      } else {
        value = deserializeColumnData(row.values[i], c)
      }
      return [c.name, value]
    })
  )
}

function calculateNumBytes(column_num: number): number {
  const rem = column_num % 8
  if (rem == 0) {
    return column_num / 8
  } else {
    return 1 + (column_num - rem) / 8
  }
}

function deserializeColumnData(
  column: Uint8Array,
  columnInfo: RelationColumn
): string | number {
  const columnType = columnInfo.type.toUpperCase()
  switch (columnType) {
    case 'CHAR':
    case 'TEXT':
    case 'UUID':
    case 'VARCHAR':
      return typeDecoder.text(column)
    case 'FLOAT4':
    case 'FLOAT8':
    case 'INT':
    case 'INT2':
    case 'INT4':
    case 'INT8':
    case 'INTEGER':
      return Number(typeDecoder.text(column))
  }
  throw new SatelliteError(
    SatelliteErrorCode.UNKNOWN_DATA_TYPE,
    `can't deserialize ${columnInfo.type}`
  )
}

// All values serialized as textual representation
function serializeColumnData(column: string | number): Uint8Array {
  return typeEncoder.text(column as string)
}

function serializeNullData(): Uint8Array {
  return typeEncoder.text('')
}

export function toMessage(data: Uint8Array): SatPbMsg {
  const code = data[0]
  const type = getTypeFromCode(code)
  const obj = getObjFromString(type)
  if (obj == undefined) {
    throw new SatelliteError(
      SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
      `${code})`
    )
  }
  return obj.decode(data.subarray(1))
}
