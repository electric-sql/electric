import anyTest, { TestFn } from 'ava'
import Long from 'long'
import { AuthState } from '../../src/auth'
import { MockNotifier } from '../../src/notifiers'
import {
  deserializeRow,
  SatelliteClient,
  serializeRow,
} from '../../src/satellite/client'
import { OplogEntry, toTransactions } from '../../src/satellite/oplog'
import { WebSocketNodeFactory } from '../../src/sockets/node'
import { base64, bytesToNumber, numberToBytes } from '../../src/util/common'
import {
  getObjFromString,
  getTypeFromCode,
  getTypeFromString,
  SatPbMsg,
} from '../../src/util/proto'
import {
  AckType,
  DataChangeType,
  Relation,
  SatelliteErrorCode,
  DataTransaction,
} from '../../src/util/types'
import * as Proto from '../../src/_generated/protocol/satellite'
import { relations } from './common'
import { SatelliteWSServerStub } from './server_ws_stub'
import { ShapeRequest } from '../../src/satellite/shapes/types'

interface Context extends AuthState {
  server: SatelliteWSServerStub
  client: SatelliteClient
  clientId: string
}

const test = anyTest as TestFn<Context>

test.beforeEach((t) => {
  const server = new SatelliteWSServerStub()
  server.start()

  const dbName = 'dbName'

  const client = new SatelliteClient(
    dbName,
    new WebSocketNodeFactory(),
    new MockNotifier(dbName),
    {
      host: '127.0.0.1',
      port: 30002,
      timeout: 10000,
      ssl: false,
      pushPeriod: 100,
    }
  )
  const clientId = '91eba0c8-28ba-4a86-a6e8-42731c2c6694'

  t.context = {
    server,
    client,
    clientId,
    token: 'fake_token',
  }
})

test.afterEach.always(async (t) => {
  const { server, client } = t.context

  client.close()
  server.close()
})

test.serial('connect success', async (t) => {
  const { client } = t.context

  await client.connect()
  t.pass()
})

test.serial('connection backoff success', async (t) => {
  const { client, server } = t.context

  server.close()

  const retry = (_e: any, a: number) => {
    if (a > 0) {
      t.pass()
      return false
    }
    return true
  }

  try {
    client['connectRetryHandler'] = retry
    await client.connect()
  } catch (e) {}
})

test.serial('connection backoff failure', async (t) => {
  const { client, server } = t.context

  server.close()

  const retry = (_e: any, a: number) => {
    if (a > 0) {
      return false
    }
    return true
  }

  try {
    client['connectRetryHandler'] = retry
    await client.connect()
  } catch (e) {
    t.pass()
  }
})

// TODO: handle connection errors scenarios

async function connectAndAuth(context: Context) {
  await context.client.connect()

  const authResp = Proto.SatAuthResp.fromPartial({})
  context.server.nextResponses([authResp])
  await context.client.authenticate(context)
}

test.serial('replication start timeout', async (t) => {
  const { client, server } = t.context
  client['opts'].timeout = 10
  await client.connect()

  // empty response will trigger client timeout
  server.nextResponses([])
  try {
    await client.startReplication()
    t.fail(`start replication should throw`)
  } catch (error: any) {
    t.is(error.code, SatelliteErrorCode.TIMEOUT)
  }
})

test.serial('connect subscription error', async (t) => {
  const { client, server } = t.context
  const startResp = Proto.SatInStartReplicationResp.fromPartial({
    err: {
      code: Proto.SatInStartReplicationResp_ReplicationError_Code.BEHIND_WINDOW,
      message: 'Test',
    },
  })
  await client.connect()

  server.nextResponses([startResp])

  try {
    const resp = await client.startReplication()
    t.is(resp.error?.code, SatelliteErrorCode.BEHIND_WINDOW)
  } catch (e: any) {
    t.fail()
  }
})

test.serial('authentication success', async (t) => {
  const { client, server } = t.context
  await client.connect()

  const authResp = Proto.SatAuthResp.fromPartial({ id: 'server_identity' })
  server.nextResponses([authResp])

  const res = await client.authenticate(t.context)
  t.assert(res)
  t.is(res['serverId'], 'server_identity')
  t.is(client['inbound'].authenticated, true)
})

test.serial('replication start success', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])

  await client.startReplication()
  t.pass()
})

test.serial('replication start sends empty', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  return new Promise(async (resolve) => {
    server.nextResponses([
      (data?: Buffer) => {
        const msgType = data!.readUInt8()
        if (
          msgType == getTypeFromString(Proto.SatInStartReplicationReq.$type)
        ) {
          const req = decode(data!) as Proto.SatInStartReplicationReq
          t.deepEqual(req.lsn, new Uint8Array())
          t.pass()
          resolve()
        }
      },
    ])
    await client.startReplication()
  })
})

test.serial('replication start sends schemaVersion', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  return new Promise(async (resolve) => {
    server.nextResponses([
      (data?: Buffer) => {
        const msgType = data!.readUInt8()
        t.assert(
          msgType == getTypeFromString(Proto.SatInStartReplicationReq.$type)
        )

        const req = decode(data!) as Proto.SatInStartReplicationReq
        t.assert(req.schemaVersion === '20230711')

        resolve()
      },
    ])
    await client.startReplication(new Uint8Array(), '20230711')
  })
})

test.serial('replication start failure', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])

  try {
    await client.startReplication()
    await client.startReplication() // fails
  } catch (error) {
    t.is((error as any).code, SatelliteErrorCode.REPLICATION_ALREADY_STARTED)
  }
})

test.serial('replication stop success', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const start = Proto.SatInStartReplicationResp.fromPartial({})
  const stop = Proto.SatInStopReplicationResp.fromPartial({})
  server.nextResponses([start])
  server.nextResponses([stop])

  await client.startReplication()
  await client.stopReplication()
  t.pass()
})

test.serial('replication stop failure', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const stop = Proto.SatInStopReplicationResp.fromPartial({})
  server.nextResponses([stop])

  try {
    await client.stopReplication()
    t.fail(`stop replication should throw`)
  } catch (error) {
    t.is((error as any).code, SatelliteErrorCode.REPLICATION_NOT_STARTED)
  }
})

test.serial('server pings client', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const start = Proto.SatInStartReplicationResp.fromPartial({})
  const ping = Proto.SatPingReq.fromPartial({})
  const stop = Proto.SatInStopReplicationResp.fromPartial({})

  return new Promise(async (resolve) => {
    server.nextResponses([start, ping])
    server.nextResponses([
      () => {
        t.pass()
        resolve()
      },
    ])
    server.nextResponses([stop])

    await client.startReplication()
    await client.stopReplication()
  })
})

test.serial('receive transaction over multiple messages', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const start = Proto.SatInStartReplicationResp.fromPartial({})
  const begin = Proto.SatOpBegin.fromPartial({ commitTimestamp: Long.ZERO })
  const commit = Proto.SatOpCommit.fromPartial({})

  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'table',
    tableType: Proto.SatRelation_RelationType.TABLE,
    columns: [
      { name: 'name1', type: 'TEXT', isNullable: true },
      { name: 'name2', type: 'TEXT', isNullable: true },
    ],
  }

  const relation = Proto.SatRelation.fromPartial({
    relationId: 1,
    schemaName: 'schema',
    tableName: 'table',
    tableType: Proto.SatRelation_RelationType.TABLE,
    columns: [
      Proto.SatRelationColumn.fromPartial({
        name: 'name1',
        type: 'TEXT',
        isNullable: true,
      }),
      Proto.SatRelationColumn.fromPartial({
        name: 'name2',
        type: 'TEXT',
        isNullable: true,
      }),
    ],
  })

  const insertOp = Proto.SatOpInsert.fromPartial({
    relationId: 1,
    rowData: serializeRow({ name1: 'Foo', name2: 'Bar' }, rel),
  })

  const updateOp = Proto.SatOpUpdate.fromPartial({
    relationId: 1,
    rowData: serializeRow({ name1: 'Hello', name2: 'World!' }, rel),
    oldRowData: serializeRow({ name1: '', name2: '' }, rel),
  })
  const deleteOp = Proto.SatOpDelete.fromPartial({
    relationId: 1,
    oldRowData: serializeRow({ name1: 'Hello', name2: 'World!' }, rel),
  })

  const firstOpLogMessage = Proto.SatOpLog.fromPartial({
    ops: [
      Proto.SatTransOp.fromPartial({ begin }),
      Proto.SatTransOp.fromPartial({ insert: insertOp }),
    ],
  })

  const secondOpLogMessage = Proto.SatOpLog.fromPartial({
    ops: [
      Proto.SatTransOp.fromPartial({ update: updateOp }),
      Proto.SatTransOp.fromPartial({ delete: deleteOp }),
      Proto.SatTransOp.fromPartial({ commit }),
    ],
  })

  const stop = Proto.SatInStopReplicationResp.fromPartial({})

  server.nextResponses([start, relation, firstOpLogMessage, secondOpLogMessage])
  server.nextResponses([stop])

  await new Promise<void>(async (res) => {
    client.on('transaction', (transaction: DataTransaction) => {
      t.is(transaction.changes.length, 3)
      res()
    })

    await client.startReplication()
  })
})

test.serial('acknowledge lsn', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const lsn = base64.toBytes('FAKE')

  const start = Proto.SatInStartReplicationResp.fromPartial({})
  const begin = Proto.SatOpBegin.fromPartial({
    lsn: lsn,
    commitTimestamp: Long.ZERO,
  })
  const commit = Proto.SatOpCommit.fromPartial({})

  const opLog = Proto.SatOpLog.fromPartial({
    ops: [
      Proto.SatTransOp.fromPartial({ begin }),
      Proto.SatTransOp.fromPartial({ commit }),
    ],
  })

  const stop = Proto.SatInStopReplicationResp.fromPartial({})

  server.nextResponses([start, opLog])
  server.nextResponses([stop])

  await new Promise<void>(async (res) => {
    client.on('transaction', (_t: DataTransaction, ack: any) => {
      const lsn0 = client['inbound'].ack_lsn
      t.is(lsn0, undefined)
      ack()
      const lsn1 = base64.fromBytes(client['inbound'].ack_lsn!)
      t.is(lsn1, 'FAKE')
      res()
    })

    await client.startReplication()
  })
})

test.serial('send transaction', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})

  const opLogEntries: OplogEntry[] = [
    {
      namespace: 'main',
      tablename: 'parent',
      optype: 'INSERT',
      newRow: '{"id":0}',
      oldRow: undefined,
      primaryKey: '{"id":0}',
      rowid: 0,
      timestamp: '1970-01-01T00:00:01.000Z',
      clearTags: '[]',
    },
    {
      namespace: 'main',
      tablename: 'parent',
      optype: 'UPDATE',
      newRow: '{"id":1}',
      oldRow: '{"id":1}',
      primaryKey: '{"id":1}',
      rowid: 1,
      timestamp: '1970-01-01T00:00:01.000Z',
      clearTags: '["origin@1231232347"]',
    },
    {
      namespace: 'main',
      tablename: 'parent',
      optype: 'UPDATE',
      newRow: '{"id":1}',
      oldRow: '{"id":1}',
      primaryKey: '{"id":1}',
      rowid: 2,
      timestamp: '1970-01-01T00:00:02.000Z',
      clearTags: '["origin@1231232347"]',
    },
    {
      namespace: 'main',
      tablename: 'parent',
      optype: 'INSERT',
      newRow: '{"id":2}',
      oldRow: undefined,
      primaryKey: '{"id":2}',
      rowid: 3,
      timestamp: '1970-01-01T00:00:03.000Z',
      clearTags: '[]',
    },
  ]

  const transaction = toTransactions(opLogEntries, relations)
  // console.log(transaction)

  t.plan(10) // We expect exactly 1 + 3 messages to be sent by the client, with 3 checks per non-relation message

  return new Promise(async (res, rej) => {
    server.nextResponses([startResp])
    server.nextResponses([])

    let expectedCount = 4

    // first message is a relation
    server.nextResponses([
      (data?: Buffer) => {
        expectedCount -= 1
        const msgType = data!.readUInt8()
        if (msgType == getTypeFromString(Proto.SatRelation.$type)) {
          const relation = decode(data!) as Proto.SatRelation
          t.deepEqual(relation.relationId, 1)
        }
      },
    ])

    // second message is a transaction
    server.nextResponses([
      (data?: Buffer) => {
        expectedCount -= 1
        const msgType = data!.readUInt8()
        t.is(getTypeFromString(Proto.SatOpLog.$type), msgType)

        const satOpLog = (decode(data!) as Proto.SatOpLog).ops
        const lsn = satOpLog[0].begin?.lsn as Uint8Array

        t.is(bytesToNumber(lsn), 1)
        t.deepEqual(satOpLog[0].begin?.commitTimestamp, Long.UZERO.add(1000))
      },
    ])

    // third message after new enqueue does not send relation
    server.nextResponses([
      (data?: Buffer) => {
        expectedCount -= 1
        const msgType = data!.readUInt8()
        t.is(getTypeFromString(Proto.SatOpLog.$type), msgType)

        const satOpLog = (decode(data!) as Proto.SatOpLog).ops
        const lsn = satOpLog[0].begin?.lsn as Uint8Array

        t.is(bytesToNumber(lsn), 2)
        t.deepEqual(satOpLog[0].begin?.commitTimestamp, Long.UZERO.add(2000))
      },
    ])

    // fourth message is also an insert
    server.nextResponses([
      (data?: Buffer) => {
        expectedCount -= 1
        const msgType = data!.readUInt8()
        t.is(getTypeFromString(Proto.SatOpLog.$type), msgType)

        const satOpLog = (decode(data!) as Proto.SatOpLog).ops
        const lsn = satOpLog[0].begin?.lsn as Uint8Array

        t.is(bytesToNumber(lsn), 3)
        t.deepEqual(satOpLog[0].begin?.commitTimestamp, Long.UZERO.add(3000))

        res()
      },
    ])

    setTimeout(() => {
      rej()
      t.fail(
        `Timed out while waiting for server to get all expected requests. Missing ${expectedCount}`
      )
    }, 300)

    await client.startReplication()

    // wait a little for replication to start in the opposite direction
    setTimeout(() => {
      client.enqueueTransaction(transaction[0])
      client.enqueueTransaction(transaction[1])
      client.enqueueTransaction(transaction[2])
    }, 100)
  })
})

test('ack on send and pong', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const lsn_1 = numberToBytes(1)

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  const pingResponse = Proto.SatPingResp.fromPartial({ lsn: lsn_1 })

  server.nextResponses([startResp])
  server.nextResponses([])
  server.nextResponses([pingResponse])

  await client.startReplication()

  const transaction: DataTransaction = {
    lsn: lsn_1,
    commit_timestamp: Long.UZERO,
    changes: [
      {
        relation: relations.parent,
        type: DataChangeType.INSERT,
        record: { id: 0 },
        tags: [], // actual value is not relevent here
      },
    ],
  }

  const res = new Promise<void>((res) => {
    let sent = false
    client.subscribeToAck((lsn, type) => {
      if (type == AckType.LOCAL_SEND) {
        t.is(bytesToNumber(lsn), 1)
        sent = true
      } else if (sent && type == AckType.REMOTE_COMMIT) {
        t.is(bytesToNumber(lsn), 1)
        t.is(sent, true)
        res()
      }
    })
  })

  setTimeout(() => {
    client.enqueueTransaction(transaction)
  }, 100)

  await res
})

test.serial('default and null test', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const start = Proto.SatInStartReplicationResp.fromPartial({})
  const begin = Proto.SatOpBegin.fromPartial({ commitTimestamp: Long.ZERO })
  const commit = Proto.SatOpCommit.fromPartial({})
  const stop = Proto.SatInStopReplicationResp.fromPartial({})

  const rel: Relation = {
    id: 1,
    schema: 'schema',
    table: 'Items',
    tableType: Proto.SatRelation_RelationType.TABLE,
    columns: [
      { name: 'id', type: 'uuid', isNullable: false },
      { name: 'content', type: 'text', isNullable: false },
      { name: 'text_null', type: 'text', isNullable: true },
      { name: 'text_null_default', type: 'text', isNullable: true },
      { name: 'intvalue_null', type: 'integer', isNullable: true },
      { name: 'intvalue_null_default', type: 'integer', isNullable: true },
    ],
  }

  const relation = Proto.SatRelation.fromPartial({
    relationId: 1,
    schemaName: 'schema',
    tableName: 'table',
    tableType: Proto.SatRelation_RelationType.TABLE,
    columns: [
      Proto.SatRelationColumn.fromPartial({ name: 'id', type: 'uuid' }),
      Proto.SatRelationColumn.fromPartial({ name: 'content', type: 'varchar' }),
      Proto.SatRelationColumn.fromPartial({ name: 'text_null', type: 'text' }),
      Proto.SatRelationColumn.fromPartial({
        name: 'text_null_default',
        type: 'text',
      }),
      Proto.SatRelationColumn.fromPartial({
        name: 'intvalue_null',
        type: 'int4',
      }),
      Proto.SatRelationColumn.fromPartial({
        name: 'intvalue_null_default',
        type: 'int4',
      }),
    ],
  })

  const insertOp = Proto.SatOpInsert.fromPartial({
    relationId: 1,
    rowData: serializeRow(
      {
        id: 'f989b58b-980d-4d3c-b178-adb6ae8222f1',
        content: 'hello from pg_1',
        text_null: null,
        text_null_default: '',
        intvalue_null: null,
        intvalue_null_default: '10',
      },
      rel
    ),
  })

  const serializedRow: Proto.SatOpRow = {
    $type: 'Electric.Satellite.v1_4.SatOpRow',
    nullsBitmask: new Uint8Array([40]),
    values: [
      new Uint8Array([
        102, 57, 56, 57, 98, 53, 56, 98, 45, 57, 56, 48, 100, 45, 52, 100, 51,
        99, 45, 98, 49, 55, 56, 45, 97, 100, 98, 54, 97, 101, 56, 50, 50, 50,
        102, 49,
      ]),
      new Uint8Array([
        104, 101, 108, 108, 111, 32, 102, 114, 111, 109, 32, 112, 103, 95, 49,
      ]),
      new Uint8Array([]),
      new Uint8Array([]),
      new Uint8Array([]),
      new Uint8Array([49, 48]),
    ],
  }

  const record: any = deserializeRow(serializedRow, rel)!

  const firstOpLogMessage = Proto.SatOpLog.fromPartial({
    ops: [
      Proto.SatTransOp.fromPartial({ begin }),
      Proto.SatTransOp.fromPartial({ insert: insertOp }),
      Proto.SatTransOp.fromPartial({ commit }),
    ],
  })

  server.nextResponses([start, relation, firstOpLogMessage])
  server.nextResponses([stop])

  await new Promise<void>(async (res) => {
    client.on('transaction', (transaction: any) => {
      t.is(record['id'] as any, transaction.changes[0].record['id'] as any)
      t.is(
        record['content'] as any,
        transaction.changes[0].record['content'] as any
      )
      t.is(
        record['text_null'] as any,
        transaction.changes[0].record['text_null'] as any
      )
      res()
    })

    await client.startReplication()
  })
})

test.serial('subscription succesful', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])
  await client.startReplication()

  const shapeReq: ShapeRequest = {
    requestId: 'fake',
    definition: {
      selects: [{ tablename: 'fake' }],
    },
  }

  const subscriptionId = 'THE_ID'
  const subsResp = Proto.SatSubsResp.fromPartial({ subscriptionId })
  server.nextResponses([subsResp])

  const res = await client.subscribe(subscriptionId, [shapeReq])
  t.is(res.subscriptionId, subscriptionId)
})

test.serial(
  'RPC correctly handles interleaved subscribe responses',
  async (t) => {
    await connectAndAuth(t.context)
    const { client, server } = t.context

    const startResp = Proto.SatInStartReplicationResp.fromPartial({})
    server.nextResponses([startResp])
    await client.startReplication()

    const shapeReq1: ShapeRequest = {
      requestId: 'fake1',
      definition: {
        selects: [{ tablename: 'fake1' }],
      },
    }

    const shapeReq2: ShapeRequest = {
      requestId: 'fake2',
      definition: {
        selects: [{ tablename: 'fake2' }],
      },
    }

    const subscriptionId1 = 'subscription id 1'
    const subscriptionId2 = 'subscription id 2'
    const subsResp1 = Proto.SatSubsResp.fromPartial({
      subscriptionId: subscriptionId1,
    })
    const subsResp2 = Proto.SatSubsResp.fromPartial({
      subscriptionId: subscriptionId2,
    })
    server.nextResponses([subsResp1, subsResp2])

    const p1 = client.subscribe(subscriptionId1, [shapeReq1])
    const p2 = client.subscribe(subscriptionId2, [shapeReq2])
    const [resp1, resp2] = await Promise.all([p1, p2])

    t.is(resp1.subscriptionId, subscriptionId1)
    t.is(resp2.subscriptionId, subscriptionId2)
  }
)

test.serial('listen to subscription events: error', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])
  await client.startReplication()

  const shapeReq: ShapeRequest = {
    requestId: 'fake',
    definition: {
      selects: [{ tablename: 'fake' }],
    },
  }

  const subscriptionId = 'THE_ID'

  const subsResp = Proto.SatSubsResp.fromPartial({ subscriptionId })
  const subsError = Proto.SatSubsDataError.fromPartial({
    code: Proto.SatSubsDataError_Code.SHAPE_DELIVERY_ERROR,
    message: 'FAKE ERROR',
    subscriptionId,
  })
  server.nextResponses([subsResp, subsError])

  const success = () => t.fail()
  const error = () => t.pass()

  client.subscribeToSubscriptionEvents(success, error)
  const res = await client.subscribe(subscriptionId, [shapeReq])
  t.is(res.subscriptionId, subscriptionId)
})

test.serial('subscription incorrect protocol sequence', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])
  await client.startReplication()

  const requestId = 'THE_REQUEST_ID'
  const subscriptionId = 'THE_SUBS_ID'
  const shapeUuid = 'THE_SHAPE_ID'
  const tablename = 'THE_TABLE_ID'

  const shapeReq: ShapeRequest = {
    requestId,
    definition: {
      selects: [{ tablename }],
    },
  }

  const subsResp = Proto.SatSubsResp.fromPartial({ subscriptionId })
  const subsRespWithErr = Proto.SatSubsResp.fromPartial({
    subscriptionId,
    err: {
      code: Proto.SatSubsResp_SatSubsError_Code.SHAPE_REQUEST_ERROR,
    },
  })
  const beginSub = Proto.SatSubsDataBegin.fromPartial({ subscriptionId })
  const beginShape = Proto.SatShapeDataBegin.fromPartial({
    requestId,
    uuid: shapeUuid,
  })
  const endShape = Proto.SatShapeDataEnd.fromPartial({})
  const endSub = Proto.SatSubsDataEnd.fromPartial({})
  const satOpLog = Proto.SatOpLog.fromPartial({})

  const begin = Proto.SatOpBegin.fromPartial({
    commitTimestamp: Long.ZERO,
  })
  const commit = Proto.SatOpCommit.fromPartial({})

  const insert = Proto.SatOpInsert.fromPartial({})

  const satTransOpBegin = Proto.SatTransOp.fromPartial({ begin })
  const satTransOpInsert = Proto.SatTransOp.fromPartial({ insert })
  const satTransOpCommit = Proto.SatTransOp.fromPartial({ commit })

  const wrongSatOpLog1 = Proto.SatOpLog.fromPartial({
    ops: [satTransOpCommit],
  })

  const wrongSatOpLog2 = Proto.SatOpLog.fromPartial({
    ops: [satTransOpBegin],
  })

  const wrongSatOpLog3 = Proto.SatOpLog.fromPartial({
    ops: [satTransOpInsert, satTransOpBegin],
  })

  const wrongSatOpLog4 = Proto.SatOpLog.fromPartial({
    ops: [satTransOpInsert, satTransOpCommit],
  })

  const validSatOpLog = Proto.SatOpLog.fromPartial({
    ops: [satTransOpInsert, satTransOpInsert],
  })

  const testCases = [
    [subsResp, beginShape],
    [subsResp, endShape],
    [subsResp, endSub],
    [subsResp, beginSub, endShape],
    [subsResp, beginSub, beginShape, endSub],
    [subsResp, beginSub, endShape],
    [subsResp, beginSub, satOpLog],
    [subsResp, beginSub, beginShape, endShape, satOpLog],
    [subsResp, beginSub, beginShape, satOpLog, endSub],
    [subsResp, beginSub, beginShape, wrongSatOpLog1],
    [subsResp, beginSub, beginShape, wrongSatOpLog2],
    [subsResp, beginSub, beginShape, wrongSatOpLog3],
    [subsResp, beginSub, beginShape, wrongSatOpLog4],
    [subsResp, beginSub, beginShape, validSatOpLog, endShape, validSatOpLog],
    [subsRespWithErr, beginSub],
  ]
  t.plan(testCases.length) // Expect exactly this amount of assertions
  for (const next of testCases) {
    server.nextResponses(next)
    const promise = new Promise<void>((res, rej) => {
      const success = () => {
        t.fail('expected the client to fail on an invalid message sequence')
        rej()
      }
      const error = () => {
        client.unsubscribeToSubscriptionEvents(success, error)
        t.pass()
        res()
      }
      client.subscribeToSubscriptionEvents(success, error)
      client.subscribe(subscriptionId, [shapeReq, shapeReq])
    })
    await promise
  }
})

test.serial('subscription correct protocol sequence with data', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])
  await client.startReplication()

  const rel: Relation = {
    id: 0,
    schema: 'schema',
    table: 'table',
    tableType: Proto.SatRelation_RelationType.TABLE,
    columns: [
      { name: 'name1', type: 'TEXT', isNullable: true },
      { name: 'name2', type: 'TEXT', isNullable: true },
    ],
  }

  const clientAsAny = client as any
  clientAsAny['inbound']['relations'].set(0, rel)

  const requestId1 = 'THE_REQUEST_ID_1'
  const requestId2 = 'THE_REQUEST_ID_2'
  const subscriptionId = 'THE_SUBS_ID'
  const uuid1 = 'THE_SHAPE_ID_1'
  const uuid2 = 'THE_SHAPE_ID_2'
  const tablename = 'THE_TABLE_ID'

  const shapeReq1: ShapeRequest = {
    requestId: requestId1,
    definition: {
      selects: [{ tablename }],
    },
  }

  const shapeReq2: ShapeRequest = {
    requestId: requestId2,
    definition: {
      selects: [{ tablename }],
    },
  }

  const subsResp = Proto.SatSubsResp.fromPartial({ subscriptionId })
  const beginSub = Proto.SatSubsDataBegin.fromPartial({ subscriptionId })
  const beginShape1 = Proto.SatShapeDataBegin.fromPartial({
    requestId: requestId1,
    uuid: uuid1,
  })
  const beginShape2 = Proto.SatShapeDataBegin.fromPartial({
    requestId: requestId2,
    uuid: uuid2,
  })
  const endShape = Proto.SatShapeDataEnd.fromPartial({})
  const endSub = Proto.SatSubsDataEnd.fromPartial({})

  const promise = new Promise<void>((res, rej) => {
    const success = () => {
      t.pass()
      res()
    }

    const error = (e: any) => {
      rej(e.message)
    }
    client.subscribeToSubscriptionEvents(success, error)
  })

  const insertOp = Proto.SatOpInsert.fromPartial({
    relationId: 0,
    rowData: serializeRow({ name1: 'Foo', name2: 'Bar' }, rel),
  })

  const satTransOpInsert = Proto.SatTransOp.fromPartial({ insert: insertOp })

  const satOpLog1 = Proto.SatOpLog.fromPartial({
    ops: [satTransOpInsert],
  })

  server.nextResponses([
    subsResp,
    beginSub,
    beginShape1,
    satOpLog1,
    endShape,
    beginShape2,
    satOpLog1,
    endShape,
    endSub,
  ])
  await client.subscribe(subscriptionId, [shapeReq1, shapeReq2])

  await promise
})

function decode(data: Buffer): SatPbMsg {
  const code = data.readUInt8()
  const type = getTypeFromCode(code)
  const obj = getObjFromString(type)
  return obj!.decode(data.subarray(1))
}

test.serial('unsubscribe successfull', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.fromPartial({})
  server.nextResponses([startResp])
  await client.startReplication()

  const subscriptionId = 'THE_ID'

  const unsubResp = Proto.SatUnsubsResp.fromPartial({})
  server.nextResponses([unsubResp])
  const resp = await client.unsubscribe([subscriptionId])
  t.deepEqual(resp, {})
})
