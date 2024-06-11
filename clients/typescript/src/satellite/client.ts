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
  SatRelation,
  SatRelationColumn,
  SatSubsResp,
  SatSubsReq,
  SatSubsDataError,
  SatSubsDataBegin,
  SatSubsDataEnd,
  SatShapeDataBegin,
  SatShapeDataEnd,
  SatUnsubsReq,
  SatUnsubsResp,
  SatUnsubsDataBegin,
  SatUnsubsDataEnd,
  Root,
  RootClientImpl,
  SatRpcRequest,
  SatInStartReplicationReq_Dialect,
} from '../_generated/protocol/satellite'
import {
  getObjFromString,
  getBufWithMsgTag,
  getTypeFromCode,
  SatPbMsg,
  getFullTypeName,
  startReplicationErrorToSatelliteError,
  shapeRequestToSatShapeReq,
  subsErrorToSatelliteError,
  msgToString,
  serverErrorToSatelliteError,
  HandlerMapping,
  RpcResponder,
} from '../util/proto'
import { PROTOCOL_VSN, Socket, SocketFactory } from '../sockets/index'
import _m0 from 'protobufjs/minimal.js'
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
  DbRecord,
  Relation,
  SchemaChange,
  StartReplicationResponse,
  StopReplicationResponse,
  ErrorCallback,
  RelationCallback,
  OutboundStartedCallback,
  TransactionCallback,
  ServerTransaction,
  InboundReplication,
  SocketCloseReason,
  AdditionalData,
  DataInsert,
  AdditionalDataCallback,
  DataChange,
  isDataChange,
  ReplicatedRowTransformer,
  DataGone,
  GoneBatchCallback,
} from '../util/types'
import {
  base64,
  sqliteTypeEncoder,
  sqliteTypeDecoder,
  bytesToNumber,
  TypeEncoder,
  TypeDecoder,
  pgTypeEncoder,
  pgTypeDecoder,
} from '../util/encoders'
import { DEFAULT_LOG_POS } from '../util/common'
import { Client } from '.'
import { SatelliteClientOpts, satelliteClientDefaults } from './config'
import Log from 'loglevel'
import isequal from 'lodash.isequal'
import {
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  ShapeRequest,
  SubscribeResponse,
  SubscriptionDeliveredCallback,
  SubscriptionErrorCallback,
  SubscriptionId,
  UnsubscribeResponse,
} from './shapes/types'
import { SubscriptionsDataCache } from './shapes/cache'
import { setMaskBit, getMaskBit } from '../util/bitmaskHelpers'
import { RPC, rpcRespond, withRpcRequestLogging } from './RPC'
import { Mutex } from 'async-mutex'
import { DbSchema } from '../client/model'
import { PgBasicType, PgDateType, PgType } from '../client/conversions/types'
import { AsyncEventEmitter, QualifiedTablename, startSpan } from '../util'
import { AuthState } from '../auth'
import Long from 'long'

const DEFAULT_ACK_PERIOD = 60000

type IncomingHandler = (msg: any) => void

const subscriptionError = [
  SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
  SatelliteErrorCode.SUBSCRIPTION_ERROR,
  SatelliteErrorCode.SUBSCRIPTION_ALREADY_EXISTS,
  SatelliteErrorCode.SUBSCRIPTION_ID_ALREADY_EXISTS,
  SatelliteErrorCode.SUBSCRIPTION_NOT_FOUND,
  SatelliteErrorCode.SHAPE_DELIVERY_ERROR,
]

type Events = {
  error: (error: SatelliteError) => void
  relation: (relation: Relation) => void
  transaction: (
    transaction: ServerTransaction,
    ackCb: () => void
  ) => Promise<void>
  additionalData: (data: AdditionalData, ack: () => void) => Promise<void>
  outbound_started: () => void
  [SUBSCRIPTION_DELIVERED]: SubscriptionDeliveredCallback
  [SUBSCRIPTION_ERROR]: SubscriptionErrorCallback
  goneBatch: (
    lsn: LSN,
    subscriptionIds: SubscriptionId[],
    changes: DataGone[],
    ack: () => void
  ) => Promise<void>
}
type EventEmitter = AsyncEventEmitter<Events>

export class SatelliteClient implements Client {
  private opts: Required<SatelliteClientOpts>
  private dialect: SatInStartReplicationReq_Dialect
  private encoder: TypeEncoder
  private decoder: TypeDecoder

  private emitter: EventEmitter

  private socketFactory: SocketFactory
  private socket?: Socket

  private inbound: InboundReplication
  private outbound: Replication<DataTransaction>

  // can only handle a single subscription at a time
  private subscriptionsDataCache: SubscriptionsDataCache

  private replicationTransforms: Map<
    string,
    ReplicatedRowTransformer<DbRecord>
  > = new Map()

  private socketHandler?: (any: any) => void
  private throttledPushTransaction?: () => void

  private rpcClient: RPC
  private service: Root
  private incomingMutex: Mutex = new Mutex()
  private allowedMutexedRpcResponses: Array<keyof Root> = []

  private dbDescription: DbSchema<any>
  private isDown = false

  private handlerForMessageType: { [k: string]: IncomingHandler } =
    Object.fromEntries(
      Object.entries({
        SatRelation: (msg) => this.handleRelation(msg),
        SatOpLog: (msg) => this.handleTransaction(msg),
        SatErrorResp: (error) => this.handleError(error),
        SatSubsDataError: (msg) => this.handleSubscriptionError(msg),
        SatSubsDataBegin: (msg) => this.handleSubscriptionDataBegin(msg),
        SatSubsDataEnd: (msg) => this.handleSubscriptionDataEnd(msg),
        SatShapeDataBegin: (msg) => this.handleShapeDataBegin(msg),
        SatShapeDataEnd: (msg) => this.handleShapeDataEnd(msg),
        SatRpcResponse: (msg) => this.rpcClient.handleResponse(msg),
        SatRpcRequest: (msg) => this.handleRpcRequest(msg),
        SatOpLogAck: (msg) => void msg, // Server doesn't send that
        SatUnsubsDataBegin: (msg) => this.handleUnsubsDataBegin(msg),
        SatUnsubsDataEnd: (msg) => this.handleUnsubsDataEnd(msg),
      } satisfies HandlerMapping).map((e) => [getFullTypeName(e[0]), e[1]])
    )

  private handlerForRpcRequests: RpcResponder = {
    startReplication: this.handleStartReq.bind(this),
    stopReplication: this.handleStopReq.bind(this),
  }

  /* eslint-disable-next-line @typescript-eslint/ban-types --
   * This remapping actually is generic from a function to a function of the same type,
   * but there's no way to express that. It's needed because we're wrapping the original
   * callback in our own, which makes `.removeListener` not work.
   */
  private listenerRemapping: Map<Function, Function> = new Map()

  constructor(
    dbDescription: DbSchema<any>,
    socketFactory: SocketFactory,
    opts: SatelliteClientOpts
  ) {
    this.emitter = new AsyncEventEmitter<Events>()

    this.opts = { ...satelliteClientDefaults, ...opts }
    this.dialect =
      opts.dialect === 'SQLite'
        ? SatInStartReplicationReq_Dialect.SQLITE
        : SatInStartReplicationReq_Dialect.POSTGRES
    this.encoder = opts.dialect === 'SQLite' ? sqliteTypeEncoder : pgTypeEncoder
    this.decoder = opts.dialect === 'SQLite' ? sqliteTypeDecoder : pgTypeDecoder
    this.socketFactory = socketFactory

    this.inbound = this.resetInboundReplication()
    this.outbound = this.resetReplication()
    this.dbDescription = dbDescription

    this.subscriptionsDataCache = new SubscriptionsDataCache(
      dbDescription,
      this.decoder
    )
    this.rpcClient = new RPC(
      this.sendMessage.bind(this),
      this.opts.timeout,
      Log
    )

    this.service = withRpcRequestLogging(
      new RootClientImpl(this.rpcClient),
      Log
    )
  }

  private resetReplication<T = any>(
    last_lsn?: LSN,
    isReplicating?: ReplicationStatus
  ): Replication<T> {
    return {
      authenticated: false,
      isReplicating: isReplicating ? isReplicating : ReplicationStatus.STOPPED,
      relations: new Map(),
      last_lsn: last_lsn,
      transactions: [],
    }
  }

  private resetInboundReplication(
    last_lsn?: LSN,
    isReplicating?: ReplicationStatus
  ): InboundReplication {
    return {
      ...this.resetReplication(last_lsn, isReplicating),
      lastTxId: undefined,
      lastAckedTxId: undefined,
      unackedTxs: 0,
      maxUnackedTxs: 30,
      ackPeriod: DEFAULT_ACK_PERIOD,
      ackTimer: setTimeout(
        () => this.maybeSendAck('timeout'),
        DEFAULT_ACK_PERIOD
      ),
      additionalData: [],
      goneBatch: [],
      receivingUnsubsBatch: false,
      unseenAdditionalDataRefs: new Set(),
      seenAdditionalDataSinceLastTx: {
        dataRefs: [],
        subscriptions: [],
        gone: [],
      },
    }
  }

  connect(): Promise<void> {
    if (this.isDown) {
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        'client has already shutdown'
      )
    }
    if (this.isConnected()) {
      this.disconnect()
    }
    const span = startSpan('satellite.client.connect', {
      isClientRequest: true,
    })
    return new Promise<void>((resolve, reject) => {
      this.socket = new this.socketFactory(PROTOCOL_VSN)

      const onceError = (error: Error) => {
        this.disconnect()
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
          if (this.emitter.listenerCount('error') === 0) {
            this.disconnect()
            Log.error(
              `socket error but no listener is attached: ${error.message}`
            )
          }
          this.emitter.enqueueEmit('error', error)
        })
        this.socket.onClose((ev: SocketCloseReason) => {
          this.disconnect()
          if (this.emitter.listenerCount('error') === 0) {
            Log.error(`socket closed but no listener is attached`)
          }
          this.emitter.enqueueEmit(
            'error',
            new SatelliteError(ev, 'socket closed')
          )
        })

        resolve()
      }

      this.socket.onceError(onceError)
      this.socket.onceConnect(onceConnect)

      const { host, port, ssl } = this.opts
      const url = `${ssl ? 'wss' : 'ws'}://${host}:${port}/ws`
      this.socket.open({ url })
    }).finally(() => span.end())
  }

  disconnect() {
    this.outbound = this.resetReplication(this.outbound.last_lsn)
    this.inbound = this.resetInboundReplication(this.inbound.last_lsn)

    this.socketHandler = undefined

    if (this.socket !== undefined) {
      this.socket.closeAndRemoveListeners()
      this.socket = undefined
    }
  }

  isConnected(): boolean {
    return !!this.socketHandler
  }

  getOutboundReplicationStatus(): ReplicationStatus {
    return this.outbound.isReplicating
  }

  async shutdown(): Promise<void> {
    this.emitter.removeAllListeners()
    await this.emitter.waitForProcessing()
    this.disconnect()
    this.isDown = true
  }

  startReplication(
    lsn?: LSN,
    schemaVersion?: string,
    subscriptionIds?: string[],
    observedTransactionData?: Long[]
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
    const span = startSpan('satellite.client.startReplication', {
      isClientRequest: true,
    })
    let request: SatInStartReplicationReq
    if (!lsn || lsn.length === 0) {
      Log.info(`no previous LSN, start replication from scratch`)
      if (subscriptionIds && subscriptionIds.length > 0) {
        span.end()
        return Promise.reject(
          new SatelliteError(
            SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
            `Cannot start replication with subscription IDs but without previous LSN.`
          )
        )
      }
      request = SatInStartReplicationReq.fromPartial({
        schemaVersion,
        sqlDialect: this.dialect,
      })
    } else {
      Log.info(
        `starting replication with lsn: ${base64.fromBytes(
          lsn
        )} subscriptions: ${subscriptionIds}`
      )
      request = SatInStartReplicationReq.fromPartial({
        lsn,
        subscriptionIds,
        observedTransactionData,
        sqlDialect: this.dialect,
      })
    }

    // Then set the replication state
    this.inbound = this.resetInboundReplication(lsn, ReplicationStatus.STARTING)

    return this.delayIncomingMessages(
      async () => {
        const requestSpan = startSpan(
          'satellite.client.startReplication.request',
          { parentSpan: span }
        )
        const resp = await this.service.startReplication(request)
        requestSpan.end()
        return this.handleStartResp(resp)
      },
      { allowedRpcResponses: ['startReplication'] }
    ).finally(() => span.end())
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

    const span = startSpan('satellite.client.stopReplication', {
      isClientRequest: true,
    })
    this.inbound.isReplicating = ReplicationStatus.STOPPING
    const request = SatInStopReplicationReq.fromPartial({})
    return this.service
      .stopReplication(request)
      .then(this.handleStopResp.bind(this))
      .finally(() => span.end())
  }

  authenticate({ clientId, token }: AuthState): Promise<AuthResponse> {
    const span = startSpan('satellite.client.authenticate', {
      isClientRequest: true,
    })
    const request = SatAuthReq.fromPartial({
      id: clientId,
      token: token,
      headers: [],
    })
    return this.service
      .authenticate(request)
      .then(this.handleAuthResp.bind(this))
      .finally(() => span.end())
  }

  subscribeToTransactions(callback: TransactionCallback) {
    this.emitter.on('transaction', async (txn, ackCb) => {
      await callback(txn)
      ackCb()
    })
  }

  unsubscribeToTransactions(callback: TransactionCallback) {
    // TODO: This doesn't work because we're building a callback in the function above
    this.emitter.removeListener('transaction', callback)
  }

  subscribeToAdditionalData(callback: AdditionalDataCallback) {
    this.emitter.on('additionalData', async (data, ackCb) => {
      await callback(data)
      ackCb()
    })
  }

  unsubscribeToAdditionalData(_callback: AdditionalDataCallback) {
    // TODO: real removeListener implementation, because the old one for txns doesn't work
  }

  subscribeToRelations(callback: RelationCallback) {
    this.emitter.on('relation', callback)
  }

  unsubscribeToRelations(callback: RelationCallback) {
    this.emitter.removeListener('relation', callback)
  }

  subscribeToGoneBatch(callback: GoneBatchCallback) {
    this.emitter.on('goneBatch', async (lsn, ids, changes, ack) => {
      await callback(lsn, ids, changes)
      ack()
    })
  }
  unsubscribeToGoneBatch(_callback: GoneBatchCallback) {
    // TODO: real removeListener implementation, because the old one for txns doesn't work
  }

  enqueueTransaction(transaction: DataTransaction): void {
    if (this.outbound.isReplicating !== ReplicationStatus.ACTIVE) {
      throw new SatelliteError(
        SatelliteErrorCode.REPLICATION_NOT_STARTED,
        'enqueuing a transaction while outbound replication has not started'
      )
    }

    // apply any specified transforms to the data changes
    transaction.changes = transaction.changes.map((dc) =>
      this._applyDataChangeTransform(dc, 'outbound')
    )

    this.outbound.transactions.push(transaction)
    this.outbound.last_lsn = transaction.lsn

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
    this.emitter.on('error', callback)
  }

  unsubscribeToError(callback: ErrorCallback): void {
    this.emitter.removeListener('error', callback)
  }

  subscribeToOutboundStarted(callback: OutboundStartedCallback): void {
    this.emitter.on('outbound_started', callback)
  }

  unsubscribeToOutboundStarted(callback: OutboundStartedCallback) {
    this.emitter.removeListener('outbound_started', callback)
  }

  subscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void {
    const newCb: SubscriptionDeliveredCallback = async (data) => {
      await successCallback(data)
      this.inbound.seenAdditionalDataSinceLastTx.subscriptions.push(
        data.subscriptionId
      )
      this.maybeSendAck('additionalData')
    }

    this.listenerRemapping.set(successCallback, newCb)

    // We're remapping this callback to internal emitter to keep event queue correct -
    // a delivered subscription processing should not interleave with next transaction processing
    this.emitter.on(SUBSCRIPTION_DELIVERED, newCb)
    this.subscriptionsDataCache.on(SUBSCRIPTION_DELIVERED, (data) =>
      this.emitter.enqueueEmit(SUBSCRIPTION_DELIVERED, data)
    )
    this.emitter.on(SUBSCRIPTION_ERROR, errorCallback)
    this.subscriptionsDataCache.on(SUBSCRIPTION_ERROR, (error) =>
      this.emitter.enqueueEmit(SUBSCRIPTION_ERROR, error)
    )
  }

  unsubscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void {
    this.emitter.removeListener(
      SUBSCRIPTION_DELIVERED,
      (this.listenerRemapping.get(successCallback) as any) || successCallback
    )
    this.emitter.removeListener(SUBSCRIPTION_ERROR, errorCallback)

    this.subscriptionsDataCache.removeAllListeners(SUBSCRIPTION_DELIVERED)
    this.subscriptionsDataCache.removeAllListeners(SUBSCRIPTION_ERROR)
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

    const span = startSpan('satellite.client.subscribe', {
      isClientRequest: true,
    })
    const request = SatSubsReq.fromPartial({
      subscriptionId,
      shapeRequests: shapeRequestToSatShapeReq(shapes),
    })

    this.subscriptionsDataCache.subscriptionRequest(request)

    return this.delayIncomingMessages(
      async () => {
        const requestSpan = startSpan('satellite.client.subscribe.request', {
          parentSpan: span,
        })
        const resp = await this.service.subscribe(request)
        requestSpan.end()
        return this.handleSubscription(resp)
      },
      { allowedRpcResponses: ['subscribe'] }
    ).finally(() => span.end())
  }

  unsubscribe(subscriptionIds: string[]): Promise<UnsubscribeResponse> {
    if (this.inbound.isReplicating !== ReplicationStatus.ACTIVE) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.REPLICATION_NOT_STARTED,
          `replication not active`
        )
      )
    }
    const span = startSpan('satellite.client.unsubscribe', {
      isClientRequest: true,
    })
    const request = SatUnsubsReq.create({ subscriptionIds })

    return this.service
      .unsubscribe(request)
      .then(this.handleUnsubscribeResponse.bind(this))
      .finally(() => span.end())
  }

  private sendMissingRelations(
    transaction: DataTransaction,
    replication: Replication<DataTransaction>
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
        oldRecord = serializeRow(
          change.oldRecord,
          relation,
          this.dbDescription,
          this.encoder
        )
      }
      if (change.record) {
        record = serializeRow(
          change.record,
          relation,
          this.dbDescription,
          this.encoder
        )
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
        case DataChangeType.COMPENSATION:
          changeOp = SatTransOp.fromPartial({
            compensation: {
              pkData: record,
              relationId: relation.id,
              tags: tags,
            },
          })
          break
        case DataChangeType.GONE:
          throw new SatelliteError(
            SatelliteErrorCode.PROTOCOL_VIOLATION,
            'Client is not expected to send GONE messages'
          )
      }
      ops.push(changeOp)
    })

    ops.push(SatTransOp.fromPartial({ commit: {} }))
    return SatOpLog.fromPartial({ ops })
  }

  private handleAuthResp(message: SatAuthResp | SatErrorResp): AuthResponse {
    let error, serverId
    if (message.$type === SatAuthResp.$type) {
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
    if (this.inbound.isReplicating === ReplicationStatus.STARTING) {
      if (resp.err) {
        this.inbound.isReplicating = ReplicationStatus.STOPPED
        return { error: startReplicationErrorToSatelliteError(resp.err) }
      } else {
        this.inbound.isReplicating = ReplicationStatus.ACTIVE
        this.inbound.maxUnackedTxs = resp.unackedWindowSize ?? 30
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

  /**
   * Server may issue RPC requests to the client, and we're handling them here.
   */
  private async handleRpcRequest(message: SatRpcRequest) {
    const responder = rpcRespond(this.sendMessage.bind(this))

    if (message.method === 'startReplication') {
      const decoded = SatInStartReplicationReq.decode(message.message)
      responder(
        message,
        await this.handlerForRpcRequests[message.method](decoded)
      )
    } else if (message.method === 'stopReplication') {
      const decoded = SatInStopReplicationReq.decode(message.message)
      responder(
        message,
        await this.handlerForRpcRequests[message.method](decoded)
      )
    } else {
      Log.warn(
        `Server has sent an RPC request with a method that the client does not support: ${message.method}`
      )

      responder(
        message,
        SatErrorResp.create({
          errorType: SatErrorResp_ErrorCode.INVALID_REQUEST,
        })
      )
    }
  }

  private async handleStartReq(
    message: SatInStartReplicationReq
  ): Promise<SatErrorResp | SatInStartReplicationResp> {
    Log.info(
      `Server sent a replication request to start from ${bytesToNumber(
        message.lsn
      )}, and options ${JSON.stringify(message.options)}`
    )

    if (this.outbound.isReplicating === ReplicationStatus.STOPPED) {
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

      this.emitter.enqueueEmit('outbound_started')
      return SatInStartReplicationResp.create()
    } else {
      this.emitter.enqueueEmit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${this.outbound.isReplicating} handling 'start' request`
        )
      )
      return SatErrorResp.create({
        errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED,
      })
    }
  }

  private async handleStopReq(
    _message: SatInStopReplicationReq
  ): Promise<SatErrorResp | SatInStopReplicationResp> {
    if (this.outbound.isReplicating === ReplicationStatus.ACTIVE) {
      this.outbound.isReplicating = ReplicationStatus.STOPPED

      if (this.throttledPushTransaction) {
        this.throttledPushTransaction = undefined
      }

      return SatInStopReplicationResp.create()
    } else {
      this.emitter.enqueueEmit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${this.inbound.isReplicating} handling 'stop' request`
        )
      )

      return SatErrorResp.create({
        errorType: SatErrorResp_ErrorCode.REPLICATION_FAILED,
      })
    }
  }

  private handleStopResp(): StopReplicationResponse {
    if (this.inbound.isReplicating === ReplicationStatus.STOPPING) {
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
      this.emitter.enqueueEmit(
        'error',
        new SatelliteError(
          SatelliteErrorCode.UNEXPECTED_STATE,
          `unexpected state ${
            ReplicationStatus[this.inbound.isReplicating]
          } handling 'relation' message`
        )
      )
      return
    }

    /* TODO: This makes a generally incorrect assumption that PK columns come in order in the relation
             It works in most cases, but we need actual PK order information on the protocol
             for multi-col PKs to work */
    let pkPosition = 1

    const relation = {
      id: message.relationId,
      schema: message.schemaName,
      table: message.tableName,
      tableType: message.tableType,
      columns: message.columns.map((c) => ({
        name: c.name,
        type: c.type,
        isNullable: c.isNullable,
        primaryKey: c.primaryKey ? pkPosition++ : undefined,
      })),
    } satisfies Relation

    this.inbound.relations.set(relation.id, relation)
    this.emitter.enqueueEmit('relation', relation)
  }

  private handleTransaction(message: SatOpLog) {
    if (this.inbound.receivingUnsubsBatch) {
      this.processUnsubsDataMessage(message)
    } else if (this.subscriptionsDataCache.isDelivering()) {
      try {
        this.subscriptionsDataCache.transaction(message.ops)
      } catch (e) {
        Log.info(
          `Error applying transaction message for subs ${JSON.stringify(e)}`
        )
      }
    } else {
      this.processOpLogMessage(message)
    }
  }

  private handleError(error: SatErrorResp) {
    this.emitter.enqueueEmit('error', serverErrorToSatelliteError(error))
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

  private handleUnsubsDataBegin(msg: SatUnsubsDataBegin): void {
    this.inbound.receivingUnsubsBatch = msg.subscriptionIds
    this.inbound.last_lsn = msg.lsn
  }

  private handleUnsubsDataEnd(_msg: SatUnsubsDataEnd): void {
    if (!this.inbound.receivingUnsubsBatch)
      throw new SatelliteError(
        SatelliteErrorCode.PROTOCOL_VIOLATION,
        'Received a `SatUnsubsDataEnd` message but not the begin message'
      )

    // We need to copy the value here so that the callback we're building 8 lines down
    // will make a closure over array value instead of over `this` and will use current
    // value instead of whatever is the value of `this.inbound.receivingUnsubsBatch` in
    // the future.
    const subscriptionIds = [...this.inbound.receivingUnsubsBatch]

    this.emitter.enqueueEmit(
      'goneBatch',
      this.inbound.last_lsn!,
      subscriptionIds,
      this.inbound.goneBatch,
      () => {
        this.inbound.seenAdditionalDataSinceLastTx.gone.push(...subscriptionIds)
        this.maybeSendAck('additionalData')
      }
    )

    this.inbound.receivingUnsubsBatch = false
    this.inbound.goneBatch = []
  }

  private delayIncomingMessages<T>(
    fn: () => Promise<T>,
    opts: { allowedRpcResponses: Array<keyof Root> }
  ): Promise<T> {
    return this.incomingMutex.runExclusive(async () => {
      this.allowedMutexedRpcResponses = opts.allowedRpcResponses
      try {
        return await fn()
      } finally {
        this.allowedMutexedRpcResponses = []
      }
    })
  }

  // TODO: properly handle socket errors; update connectivity state
  private async handleIncoming(data: Buffer) {
    try {
      const message = toMessage(data)

      if (
        this.incomingMutex.isLocked() &&
        !(
          message.$type === 'Electric.Satellite.SatRpcResponse' &&
          this.allowedMutexedRpcResponses.includes(message.method as keyof Root)
        )
      ) {
        await this.incomingMutex.waitForUnlock()
      }

      if (Log.getLevel() <= 1) {
        Log.debug(`[proto] recv: ${msgToString(message)}`)
      }
      this.handlerForMessageType[message.$type]?.(message)
    } catch (error) {
      if (error instanceof SatelliteError) {
        // subscription errors are emitted through specific event
        if (!subscriptionError.includes(error.code)) {
          this.emitter.enqueueEmit('error', error)
        }
      } else {
        // This is an unexpected runtime error
        throw error
      }
    }
  }

  private getRelation({ relationId }: { relationId: number }): Relation {
    const rel = this.inbound.relations.get(relationId)
    if (!rel) {
      throw new SatelliteError(
        SatelliteErrorCode.PROTOCOL_VIOLATION,
        `missing relation ${relationId} for incoming operation`
      )
    }
    return rel
  }

  private processUnsubsDataMessage(msg: SatOpLog): void {
    msg.ops.forEach((op) => {
      if (!op.gone)
        throw new SatelliteError(
          SatelliteErrorCode.PROTOCOL_VIOLATION,
          'Expected to see only GONE messages in unsubscription data'
        )

      const rel = this.getRelation(op.gone)
      this.inbound.goneBatch.push({
        relation: rel,
        type: DataChangeType.GONE,
        oldRecord: deserializeRow(
          op.gone.pkData!,
          rel,
          this.dbDescription,
          this.decoder
        ),
        tags: [],
      })
    })
  }

  private processOpLogMessage(opLogMessage: SatOpLog): void {
    const replication = this.inbound
    opLogMessage.ops.map((op) => {
      if (op.begin) {
        const transaction: ServerTransaction = {
          commit_timestamp: op.begin.commitTimestamp,
          lsn: op.begin.lsn,
          changes: [],
          origin: op.begin.origin!,
          id: op.begin.transactionId!,
        }
        replication.incomplete = 'transaction'
        replication.transactions.push(transaction)
      }

      if (op.additionalBegin) {
        replication.incomplete = 'additionalData'
        replication.additionalData.push({
          ref: op.additionalBegin.ref,
          changes: [],
        })
      }

      const lastTxnIdx = replication.transactions.length - 1
      const lastDataIdx = replication.additionalData.length - 1
      if (op.commit) {
        if (replication.incomplete !== 'transaction')
          throw new Error('Unexpected commit message while not waiting for txn')

        const { commit_timestamp, lsn, changes, origin, migrationVersion, id } =
          replication.transactions[lastTxnIdx]

        // apply any specified transforms to the data changes
        const transformedChanges = changes.map((change) => {
          if (!isDataChange(change)) return change
          return this._applyDataChangeTransform(change, 'inbound')
        })

        const transaction: ServerTransaction = {
          commit_timestamp,
          lsn,
          changes: transformedChanges,
          origin,
          migrationVersion,
          id,
          additionalDataRef: op.commit.additionalDataRef.isZero()
            ? undefined
            : op.commit.additionalDataRef,
        }
        this.emitter.enqueueEmit('transaction', transaction, () => {
          this.inbound.last_lsn = transaction.lsn
          this.inbound.lastTxId = transaction.id
          this.inbound.unackedTxs++
          this.inbound.seenAdditionalDataSinceLastTx = {
            dataRefs: [],
            subscriptions: [],
            gone: [],
          }
          this.maybeSendAck()
        })
        replication.transactions.splice(lastTxnIdx)
        replication.incomplete = undefined
        if (!op.commit.additionalDataRef.isZero())
          replication.unseenAdditionalDataRefs.add(
            op.commit.additionalDataRef.toString()
          )
      }

      if (op.additionalCommit) {
        if (replication.incomplete !== 'additionalData')
          throw new Error(
            'Unexpected additionalCommit message while not waiting for additionalData'
          )
        const ref = op.additionalCommit!.ref

        // TODO: We need to include these in the ACKs as well
        this.emitter.enqueueEmit(
          'additionalData',
          replication.additionalData[lastDataIdx],
          () => {
            this.inbound.seenAdditionalDataSinceLastTx.dataRefs.push(ref)
            this.maybeSendAck('additionalData')
          }
        )
        replication.additionalData.splice(lastDataIdx)
        replication.incomplete = undefined
        replication.unseenAdditionalDataRefs.delete(ref.toString())
      }

      if (op.insert) {
        const rel = this.getRelation(op.insert)

        const change: DataInsert = {
          relation: rel,
          type: DataChangeType.INSERT,
          record: deserializeRow(
            op.insert.rowData!,
            rel,
            this.dbDescription,
            this.decoder
          ),
          tags: op.insert.tags,
        }

        if (replication.incomplete! === 'transaction') {
          replication.transactions[lastTxnIdx].changes.push(change)
        } else {
          replication.additionalData[lastDataIdx].changes.push(change)
        }
      }

      if (op.update) {
        const rel = this.getRelation(op.update)

        const change = {
          relation: rel,
          type: DataChangeType.UPDATE,
          record: deserializeRow(
            op.update.rowData!,
            rel,
            this.dbDescription,
            this.decoder
          ),
          oldRecord: deserializeRow(
            op.update.oldRowData,
            rel,
            this.dbDescription,
            this.decoder
          ),
          tags: op.update.tags,
        }

        replication.transactions[lastTxnIdx].changes.push(change)
      }

      if (op.delete) {
        const rel = this.getRelation(op.delete)

        const change = {
          relation: rel,
          type: DataChangeType.DELETE,
          oldRecord: deserializeRow(
            op.delete.oldRowData!,
            rel,
            this.dbDescription,
            this.decoder
          ),
          tags: op.delete.tags,
        }

        replication.transactions[lastTxnIdx].changes.push(change)
      }

      if (op.gone) {
        const rel = this.getRelation(op.gone)

        const change = {
          relation: rel,
          type: DataChangeType.GONE,
          oldRecord: deserializeRow(
            op.gone.pkData,
            rel,
            this.dbDescription,
            this.decoder
          ),
          tags: [],
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
    if (!this.socket || !this.isConnected()) {
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_STATE,
        'trying to send message, but client is closed'
      )
    }
    const obj = getObjFromString(request.$type)
    if (obj === undefined) {
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
        `${request.$type})`
      )
    }

    const type = getBufWithMsgTag(request)
    const msg = obj.encode(request, _m0.Writer.create()).finish()
    const buffer = new Uint8Array(type.length + msg.length)
    buffer.set(type, 0)
    buffer.set(msg, 1)

    this.socket.write(buffer)
  }

  getLastSentLsn(): LSN {
    return this.outbound.last_lsn ?? DEFAULT_LOG_POS
  }

  private maybeSendAck(reason?: 'timeout' | 'additionalData') {
    // Restart the timer regardless
    if (reason === 'timeout')
      this.inbound.ackTimer = setTimeout(
        () => this.maybeSendAck('timeout'),
        this.inbound.ackPeriod
      )

    // Cannot ack while offline
    if (!this.socket || !this.isConnected()) return
    // or when there's nothing to be ack'd
    if (this.inbound.lastTxId === undefined) return
    // Shouldn't ack the same message
    if (this.inbound.lastAckedTxId?.eq(this.inbound.lastTxId)) return

    // Send acks earlier rather than later to keep the stream continuous -
    // definitely send at 70% of allowed lag.
    const boundary = Math.floor(this.inbound.maxUnackedTxs * 0.7)

    // Send the ack if we're over the boundary, or wait to ack until the timer runs
    // out to avoid making more traffic than required, but we always try to ack on additional data
    if (
      this.inbound.unackedTxs >= boundary ||
      reason === 'timeout' ||
      reason === 'additionalData'
    ) {
      const msg: SatPbMsg = {
        $type: 'Electric.Satellite.SatOpLogAck',
        ackTimestamp: Long.UZERO.add(new Date().getTime()),
        lsn: this.inbound.last_lsn!,
        transactionId: this.inbound.lastTxId,
        subscriptionIds:
          this.inbound.seenAdditionalDataSinceLastTx.subscriptions,
        additionalDataSourceIds:
          this.inbound.seenAdditionalDataSinceLastTx.dataRefs,
        goneSubscriptionIds: this.inbound.seenAdditionalDataSinceLastTx.gone,
      }

      this.sendMessage(msg)
      this.inbound.lastAckedTxId = msg.transactionId
    }
  }

  public setReplicationTransform(
    tableName: QualifiedTablename,
    transform: ReplicatedRowTransformer<DbRecord>
  ): void {
    this.replicationTransforms.set(tableName.tablename, transform)
  }

  public clearReplicationTransform(tableName: QualifiedTablename): void {
    this.replicationTransforms.delete(tableName.tablename)
  }

  private _applyDataChangeTransform(
    dataChange: DataChange,
    dataFlow: 'inbound' | 'outbound'
  ): DataChange {
    const transforms = this.replicationTransforms.get(dataChange.relation.table)
    if (!transforms) return dataChange
    const transformToUse =
      dataFlow === 'inbound'
        ? transforms.transformInbound
        : transforms.transformOutbound
    try {
      return {
        ...dataChange,
        record: dataChange.record && transformToUse(dataChange.record),
        oldRecord: dataChange.oldRecord && transformToUse(dataChange.oldRecord),
      }
    } catch (err: any) {
      throw new SatelliteError(
        SatelliteErrorCode.REPLICATION_TRANSFORM_ERROR,
        err.message
      )
    }
  }
}

/**
 * Fetches the PG type of the given column in the given table.
 * @param dbDescription Database description object
 * @param table Name of the table
 * @param column Name of the column
 * @returns The PG type of the column
 */
function getColumnType(
  dbDescription: DbSchema<any>,
  table: string,
  column: RelationColumn
): PgType {
  if (
    dbDescription.hasTable(table) &&
    dbDescription.getFields(table).has(column.name)
  ) {
    // The table and column are known in the DB description
    return dbDescription.getFields(table).get(column.name)!
  } else {
    // The table or column is not known.
    // There must have been a migration that added it to the DB while the app was running.
    // i.e., it was not known at the time the Electric client for this app was generated
    //       so it is not present in the bundled DB description.
    // Thus, we return the column type that is stored in the relation.
    // Note that it is fine to fetch the column type from the relation
    // because it was received at runtime and thus will have the PG type
    // (which would not be the case for bundled relations fetched
    //  from the endpoint because the endpoint maps PG types to SQLite types).
    return column.type.toUpperCase() as PgType
  }
}

export function serializeRow(
  rec: DbRecord,
  relation: Relation,
  dbDescription: DbSchema<any>,
  encoder: TypeEncoder
): SatOpRow {
  let recordNumColumn = 0
  const recordNullBitMask = new Uint8Array(
    calculateNumBytes(relation.columns.length)
  )
  const recordValues = relation!.columns.reduce(
    (acc: Uint8Array[], c: RelationColumn) => {
      const columnValue = rec[c.name]
      if (columnValue !== null && columnValue !== undefined) {
        const pgColumnType = getColumnType(dbDescription, relation.table, c)
        acc.push(serializeColumnData(columnValue, pgColumnType, encoder))
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
  row: SatOpRow,
  relation: Relation,
  dbDescription: DbSchema<any>,
  decoder: TypeDecoder
): DbRecord
export function deserializeRow(
  row: SatOpRow | undefined,
  relation: Relation,
  dbDescription: DbSchema<any>,
  decoder: TypeDecoder
): DbRecord | undefined
export function deserializeRow(
  row: SatOpRow | undefined,
  relation: Relation,
  dbDescription: DbSchema<any>,
  decoder: TypeDecoder
): DbRecord | undefined {
  if (row === undefined) {
    return undefined
  }
  return Object.fromEntries(
    relation.columns.map((c, i) => {
      let value
      if (getMaskBit(row.nullsBitmask, i) === 1) {
        value = null
      } else {
        const pgColumnType = getColumnType(dbDescription, relation.table, c)
        value = deserializeColumnData(row.values[i], pgColumnType, decoder)
      }
      return [c.name, value]
    })
  )
}

function calculateNumBytes(column_num: number): number {
  const rem = column_num % 8
  if (rem === 0) {
    return column_num / 8
  } else {
    return 1 + (column_num - rem) / 8
  }
}

function deserializeColumnData(
  column: Uint8Array,
  columnType: PgType,
  decoder: TypeDecoder
): boolean | string | number | Uint8Array {
  switch (columnType) {
    case PgBasicType.PG_BOOL:
      return decoder.bool(column)
    case PgBasicType.PG_INT:
    case PgBasicType.PG_INT2:
    case PgBasicType.PG_INT4:
    case PgBasicType.PG_INTEGER:
      return Number(decoder.text(column))
    case PgBasicType.PG_FLOAT4:
    case PgBasicType.PG_FLOAT8:
    case PgBasicType.PG_REAL:
      return decoder.float(column)
    case PgDateType.PG_TIMETZ:
      return decoder.timetz(column)
    case PgBasicType.PG_BYTEA:
      return decoder.bytea(column)
    case PgBasicType.PG_JSON:
    case PgBasicType.PG_JSONB:
      return decoder.json(column)
    default:
      // also covers user-defined enumeration types
      return decoder.text(column)
  }
}

// All values serialized as textual representation
function serializeColumnData(
  columnValue: boolean | string | number | object,
  columnType: PgType,
  encoder: TypeEncoder
): Uint8Array {
  switch (columnType) {
    case PgBasicType.PG_BOOL:
      return (encoder.bool as any)(columnValue) // the encoder accepts the number or bool
    case PgDateType.PG_TIMETZ:
      return encoder.timetz(columnValue as string)
    case PgBasicType.PG_BYTEA:
      return encoder.bytea(columnValue as Uint8Array)
    case PgBasicType.PG_JSON:
    case PgBasicType.PG_JSONB:
      return (encoder.json as any)(columnValue)
    default:
      return encoder.text(String(columnValue))
  }
}

function serializeNullData(): Uint8Array {
  return new Uint8Array()
}

export function toMessage(data: Uint8Array): SatPbMsg {
  const code = data[0]
  const type = getTypeFromCode(code)
  const obj = getObjFromString(type)
  if (obj === undefined) {
    throw new SatelliteError(
      SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
      `${code})`
    )
  }
  return obj.decode(data.subarray(1))
}
