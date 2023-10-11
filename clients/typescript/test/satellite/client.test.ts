import anyTest, { TestFn } from 'ava'
import Long from 'long'
import * as Proto from '../../src/_generated/protocol/satellite'
import { AuthState } from '../../src/auth'
import { MockNotifier } from '../../src/notifiers'
import {
  deserializeRow,
  SatelliteClient,
  serializeRow,
} from '../../src/satellite/client'
import { OplogEntry, toTransactions } from '../../src/satellite/oplog'
import { ShapeRequest } from '../../src/satellite/shapes/types'
import { WebSocketNode } from '../../src/sockets/node'
import { sleepAsync } from '../../src/util'
import { base64, bytesToNumber } from '../../src/util/common'
import {
  DataTransaction,
  Relation,
  SatelliteErrorCode,
  Transaction,
} from '../../src/util/types'
import { dbDescription, relations } from './common'
import { RpcResponse, SatelliteWSServerStub } from './server_ws_stub'
import { DbSchema, TableSchema } from '../../src/client/model/schema'
import { PgBasicType } from '../../src/client/conversions/types'
import { HKT } from '../../src/client/util/hkt'

interface Context extends AuthState {
  server: SatelliteWSServerStub
  client: SatelliteClient
  clientId: string
}

const test = anyTest as TestFn<Context>

test.beforeEach((t) => {
  const server = new SatelliteWSServerStub(t)
  server.start()

  const dbName = 'dbName'

  const client = new SatelliteClient(
    dbName,
    dbDescription,
    WebSocketNode,
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
  client.disconnect()
  server.close()
})

test.serial('connect success', async (t) => {
  const { client } = t.context

  await client.connect()
  t.pass()
})

// TODO: handle connection errors scenarios

async function connectAndAuth(context: Context) {
  await context.client.connect()

  const authResp = Proto.SatAuthResp.create()
  context.server.nextRpcResponse('authenticate', [authResp])
  await context.client.authenticate(context)
}

test.serial('replication start timeout', async (t) => {
  const { client } = t.context
  client['opts'].timeout = 10
  client['rpcClient']['defaultTimeout'] = 10
  await client.connect()

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

  server.nextRpcResponse('startReplication', [startResp])

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
  server.nextRpcResponse('authenticate', [authResp])

  const res = await client.authenticate(t.context)
  t.assert(res)
  t.is(res['serverId'], 'server_identity')
  t.is(client['inbound'].authenticated, true)
})

test.serial('replication start success', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.create()
  server.nextRpcResponse('startReplication', [startResp])

  await client.startReplication()
  t.pass()
})

test.serial('replication start sends empty', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  t.plan(1)

  return new Promise(async (resolve) => {
    server.nextRpcResponse('startReplication', (data) => {
      const req = Proto.SatInStartReplicationReq.decode(data)
      t.deepEqual(req.lsn, new Uint8Array())
      resolve()
      return [Proto.SatInStartReplicationResp.create()]
    })
    await client.startReplication()
  })
})

test.serial('replication start sends schemaVersion', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  t.plan(1)

  return new Promise(async (resolve) => {
    server.nextRpcResponse('startReplication', (data) => {
      const req = Proto.SatInStartReplicationReq.decode(data)
      t.assert(req.schemaVersion === '20230711')
      resolve()
      return [Proto.SatInStartReplicationResp.create()]
    })
    await client.startReplication(new Uint8Array(), '20230711')
  })
})

test.serial('replication start failure', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.create()
  server.nextRpcResponse('startReplication', [startResp])

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

  const start = Proto.SatInStartReplicationResp.create()
  const stop = Proto.SatInStopReplicationResp.create()
  server.nextRpcResponse('startReplication', [start])
  server.nextRpcResponse('stopReplication', [stop])

  await client.startReplication()
  await client.stopReplication()
  t.pass()
})

test.serial('replication stop failure', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const stop = Proto.SatInStopReplicationResp.create()
  server.nextRpcResponse('stopReplication', [stop])
  try {
    await client.stopReplication()
    t.fail(`stop replication should throw`)
  } catch (error) {
    t.is((error as any).code, SatelliteErrorCode.REPLICATION_NOT_STARTED)
  }
})

test.serial('receive transaction over multiple messages', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const dbDescription = new DbSchema(
    {
      table: {
        fields: new Map([
          ['name1', PgBasicType.PG_TEXT],
          ['name2', PgBasicType.PG_TEXT],
        ]),
        relations: [],
      } as unknown as TableSchema<
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        HKT
      >,
    },
    []
  )

  client['dbDescription'] = dbDescription

  const start = Proto.SatInStartReplicationResp.create()
  const begin = Proto.SatOpBegin.fromPartial({ commitTimestamp: Long.ZERO })
  const commit = Proto.SatOpCommit.create()

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
    rowData: serializeRow({ name1: 'Foo', name2: 'Bar' }, rel, dbDescription),
  })

  const updateOp = Proto.SatOpUpdate.fromPartial({
    relationId: 1,
    rowData: serializeRow(
      { name1: 'Hello', name2: 'World!' },
      rel,
      dbDescription
    ),
    oldRowData: serializeRow({ name1: '', name2: '' }, rel, dbDescription),
  })
  const deleteOp = Proto.SatOpDelete.fromPartial({
    relationId: 1,
    oldRowData: serializeRow(
      { name1: 'Hello', name2: 'World!' },
      rel,
      dbDescription
    ),
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

  const stop = Proto.SatInStopReplicationResp.create()

  server.nextRpcResponse('startReplication', [
    start,
    relation,
    firstOpLogMessage,
    secondOpLogMessage,
  ])
  server.nextRpcResponse('stopReplication', [stop])

  await new Promise<void>(async (res) => {
    client.subscribeToTransactions(
      (transaction: Transaction) =>
        new Promise(() => {
          t.is(transaction.changes.length, 3)
          res()
        })
    )

    await client.startReplication()
  })
})

test.serial('migration transaction contains all information', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const newTableRelation = {
    relationId: 2001, // doesn't matter
    schemaName: 'public',
    tableName: 'NewTable',
    tableType: Proto.SatRelation_RelationType.TABLE,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isNullable: false,
        primaryKey: true,
      },
    ],
  }

  const start = Proto.SatInStartReplicationResp.create()
  const relation = Proto.SatRelation.create(newTableRelation)
  const begin = Proto.SatOpBegin.fromPartial({
    commitTimestamp: Long.ZERO,
    isMigration: true,
  })
  const migrationVersion = '123_456'
  const migrate = Proto.SatOpMigrate.create({
    version: migrationVersion,
    stmts: [
      Proto.SatOpMigrate_Stmt.create({
        type: Proto.SatOpMigrate_Type.CREATE_TABLE,
        sql: 'CREATE TABLE "foo" (\n  "value" TEXT NOT NULL,\n  CONSTRAINT "foo_pkey" PRIMARY KEY ("value")\n) WITHOUT ROWID;\n',
      }),
    ],
    table: Proto.SatOpMigrate_Table.create({
      name: 'foo',
      columns: [
        Proto.SatOpMigrate_Column.create({
          name: 'value',
          sqliteType: 'TEXT',
          pgType: Proto.SatOpMigrate_PgColumnType.create({
            name: 'VARCHAR',
            array: [],
            size: [],
          }),
        }),
      ],
      fks: [],
      pks: ['value'],
    }),
  })
  const commit = Proto.SatOpCommit.create()

  const opLogMsg = Proto.SatOpLog.create({
    ops: [
      Proto.SatTransOp.fromPartial({ begin }),
      Proto.SatTransOp.fromPartial({ migrate }),
      Proto.SatTransOp.fromPartial({ commit }),
    ],
  })

  const stop = Proto.SatInStopReplicationResp.create()

  server.nextRpcResponse('startReplication', [start, relation, opLogMsg])
  server.nextRpcResponse('stopReplication', [stop])

  await new Promise<void>(async (res) => {
    client.subscribeToTransactions(
      (transaction: Transaction) =>
        new Promise(() => {
          t.is(transaction.migrationVersion, migrationVersion)
          t.deepEqual(transaction, {
            commit_timestamp: commit.commitTimestamp,
            lsn: begin.lsn,
            changes: [
              {
                migrationType: Proto.SatOpMigrate_Type.CREATE_TABLE,
                table: migrate.table,
                sql: 'CREATE TABLE "foo" (\n  "value" TEXT NOT NULL,\n  CONSTRAINT "foo_pkey" PRIMARY KEY ("value")\n) WITHOUT ROWID;\n',
              },
            ],
            origin: begin.origin,
            migrationVersion: migrationVersion,
          })
          res()
        })
    )

    await client.startReplication()
  })
})

test.serial('acknowledge lsn', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const lsn = base64.toBytes('FAKE')

  const start = Proto.SatInStartReplicationResp.create()
  const begin = Proto.SatOpBegin.fromPartial({
    lsn: lsn,
    commitTimestamp: Long.ZERO,
  })
  const commit = Proto.SatOpCommit.create()

  const opLog = Proto.SatOpLog.fromPartial({
    ops: [
      Proto.SatTransOp.fromPartial({ begin }),
      Proto.SatTransOp.fromPartial({ commit }),
    ],
  })

  const stop = Proto.SatInStopReplicationResp.create()

  server.nextRpcResponse('startReplication', [start, opLog])
  server.nextRpcResponse('stopReplication', [stop])

  await new Promise<void>(async (res) => {
    client['emitter'].on(
      'transaction',
      (_t: DataTransaction, ack: () => void) => {
        const lsn0 = client['inbound'].last_lsn
        t.is(lsn0, undefined)
        ack()
        const lsn1 = base64.fromBytes(client['inbound'].last_lsn!)
        t.is(lsn1, 'FAKE')
        res()
      }
    )

    await client.startReplication()
  })
})

test.serial('send transaction', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const startResp = Proto.SatInStartReplicationResp.create()

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

  t.plan(7) // We expect exactly 1 + 3 messages to be sent by the client, with 2 checks per non-relation message

  return new Promise(async (res, rej) => {
    server.nextRpcResponse('startReplication', [startResp])
    server.nextMsgExpect('SatRpcResponse', [])

    let expectedCount = 4

    // first message is a relation
    server.nextMsgExpect('SatRelation', (data) => {
      expectedCount -= 1
      t.deepEqual(data.relationId, 1)
    })

    // second message is a transaction
    server.nextMsgExpect('SatOpLog', (data) => {
      expectedCount -= 1
      const satOpLog = data.ops
      const lsn = satOpLog[0].begin!.lsn

      t.is(bytesToNumber(lsn), 1)
      t.deepEqual(satOpLog[0].begin!.commitTimestamp, Long.UZERO.add(1000))
    })

    // third message after new enqueue does not send relation
    server.nextMsgExpect('SatOpLog', (data) => {
      const satOpLog = data.ops
      const lsn = satOpLog[0].begin!.lsn

      t.is(bytesToNumber(lsn), 2)
      t.deepEqual(satOpLog[0].begin!.commitTimestamp, Long.UZERO.add(2000))
    })

    // fourth message is also an insert
    server.nextMsgExpect('SatOpLog', (data) => {
      const satOpLog = data.ops
      const lsn = satOpLog[0].begin!.lsn

      t.is(bytesToNumber(lsn), 3)
      t.deepEqual(satOpLog[0].begin!.commitTimestamp, Long.UZERO.add(3000))

      res()
    })

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

test.serial('default and null test', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context

  const start = Proto.SatInStartReplicationResp.create()
  const begin = Proto.SatOpBegin.fromPartial({ commitTimestamp: Long.ZERO })
  const commit = Proto.SatOpCommit.create()
  const stop = Proto.SatInStopReplicationResp.create()

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

  const tbl = {
    fields: new Map([
      ['id', PgBasicType.PG_UUID],
      ['content', PgBasicType.PG_VARCHAR],
      ['text_null', PgBasicType.PG_TEXT],
      ['text_null_default', PgBasicType.PG_TEXT],
      ['intvalue_null', PgBasicType.PG_INT4],
      ['intvalue_null_default', PgBasicType.PG_INT4],
    ]),
    relations: [],
  } as unknown as TableSchema<any, any, any, any, any, any, any, any, any, HKT>

  const dbDescription = new DbSchema(
    {
      table: tbl,
      Items: tbl,
    },
    []
  )

  client['dbDescription'] = dbDescription

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
      rel,
      dbDescription
    ),
  })

  const serializedRow: Proto.SatOpRow = {
    $type: 'Electric.Satellite.SatOpRow',
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

  const record: any = deserializeRow(serializedRow, rel, dbDescription)!

  const firstOpLogMessage = Proto.SatOpLog.fromPartial({
    ops: [
      Proto.SatTransOp.fromPartial({ begin }),
      Proto.SatTransOp.fromPartial({ insert: insertOp }),
      Proto.SatTransOp.fromPartial({ commit }),
    ],
  })

  server.nextRpcResponse('startReplication', [
    start,
    relation,
    firstOpLogMessage,
  ])
  server.nextRpcResponse('stopReplication', [stop])

  t.plan(3)

  await new Promise<void>(async (res) => {
    client.subscribeToTransactions(
      // FIXME
      (transaction: any) =>
        new Promise(() => {
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
    )

    await client.startReplication()
  })
})

test.serial('subscription succesful', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context
  await startReplication(client, server)

  const shapeReq: ShapeRequest = {
    requestId: 'fake',
    definition: {
      selects: [{ tablename: 'fake' }],
    },
  }

  const subscriptionId = 'THE_ID'
  const subsResp = Proto.SatSubsResp.fromPartial({ subscriptionId })
  server.nextRpcResponse('subscribe', [subsResp])

  const res = await client.subscribe(subscriptionId, [shapeReq])
  t.is(res.subscriptionId, subscriptionId)
})

test.serial(
  'RPC correctly handles interleaved subscribe responses',
  async (t) => {
    await connectAndAuth(t.context)
    const { client, server } = t.context
    await startReplication(client, server)

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
    // Result of the first call is delayed
    server.nextRpcResponse('subscribe', async (_req) => {
      await sleepAsync(50)
      return [subsResp1]
    })
    server.nextRpcResponse('subscribe', [subsResp2])

    const p1 = client.subscribe(subscriptionId1, [shapeReq1])
    const p2 = client.subscribe(subscriptionId2, [shapeReq2])
    const [resp1, resp2] = await Promise.race([
      Promise.all([p1, p2]),
      sleepAsync(300).then(() => {
        t.fail('Timed out while waiting for subsciptions to fulfill')
        throw new Error('Timed out while waiting for subsciptions to fulfill')
      }),
    ])

    t.is(resp1.subscriptionId, subscriptionId1)
    t.is(resp2.subscriptionId, subscriptionId2)
  }
)

test.serial('listen to subscription events: error', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context
  await startReplication(client, server)

  const shapeReq: ShapeRequest = {
    requestId: 'fake',
    definition: {
      selects: [{ tablename: 'fake' }],
    },
  }

  const subscriptionId = 'THE_ID'

  const subsResp = Proto.SatSubsResp.fromPartial({ subscriptionId })
  const subsData = Proto.SatSubsDataBegin.fromPartial({
    subscriptionId,
  })
  const subsError = Proto.SatSubsDataError.fromPartial({
    code: Proto.SatSubsDataError_Code.SHAPE_DELIVERY_ERROR,
    message: 'FAKE ERROR',
    subscriptionId,
  })
  server.nextRpcResponse('subscribe', [subsResp, '50ms', subsData, subsError])

  const success = () => t.fail()
  const error = () => t.pass()

  client.subscribeToSubscriptionEvents(success, error)
  const res = await client.subscribe(subscriptionId, [shapeReq])
  t.is(res.subscriptionId, subscriptionId)
})

test.serial('subscription incorrect protocol sequence', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context
  await startReplication(client, server)

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
  const endShape = Proto.SatShapeDataEnd.create()
  const endSub = Proto.SatSubsDataEnd.create()
  const satOpLog = Proto.SatOpLog.create()

  const begin = Proto.SatOpBegin.fromPartial({
    commitTimestamp: Long.ZERO,
  })
  const commit = Proto.SatOpCommit.create()

  const insert = Proto.SatOpInsert.create()

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

  const testCases: RpcResponse<'subscribe'>[] = [
    [subsResp, '10ms', beginShape],
    [subsResp, '10ms', endShape],
    [subsResp, '10ms', endSub],
    [subsResp, '10ms', beginSub, endShape],
    [subsResp, '10ms', beginSub, beginShape, endSub],
    [subsResp, '10ms', beginSub, endShape],
    [subsResp, '10ms', beginSub, satOpLog],
    [subsResp, '10ms', beginSub, beginShape, endShape, satOpLog],
    [subsResp, '10ms', beginSub, beginShape, satOpLog, endSub],
    [subsResp, '10ms', beginSub, beginShape, wrongSatOpLog1],
    [subsResp, '10ms', beginSub, beginShape, wrongSatOpLog2],
    [subsResp, '10ms', beginSub, beginShape, wrongSatOpLog3],
    [subsResp, '10ms', beginSub, beginShape, wrongSatOpLog4],
    [
      subsResp,
      '10ms',
      beginSub,
      beginShape,
      validSatOpLog,
      endShape,
      validSatOpLog,
    ],
    [subsRespWithErr, '10ms', beginSub],
  ]
  t.plan(testCases.length) // Expect exactly this amount of assertions
  for (const next of testCases) {
    server.nextRpcResponse('subscribe', next)
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

  const tablename = 'THE_TABLE_ID'

  const tbl = {
    fields: new Map([
      ['name1', PgBasicType.PG_TEXT],
      ['name2', PgBasicType.PG_TEXT],
    ]),
    relations: [],
  } as unknown as TableSchema<any, any, any, any, any, any, any, any, any, HKT>

  const dbDescription = new DbSchema(
    {
      table: tbl,
      [tablename]: tbl,
    },
    []
  )

  client['dbDescription'] = dbDescription
  client['subscriptionsDataCache']['dbDescription'] = dbDescription

  await startReplication(client, server)

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
  const endShape = Proto.SatShapeDataEnd.create()
  const endSub = Proto.SatSubsDataEnd.create()

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
    rowData: serializeRow({ name1: 'Foo', name2: 'Bar' }, rel, dbDescription),
  })

  const satTransOpInsert = Proto.SatTransOp.fromPartial({ insert: insertOp })

  const satOpLog1 = Proto.SatOpLog.fromPartial({
    ops: [satTransOpInsert],
  })

  server.nextRpcResponse('subscribe', [
    subsResp,
    '10ms',
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

test.serial('unsubscribe successfull', async (t) => {
  await connectAndAuth(t.context)
  const { client, server } = t.context
  await startReplication(client, server)

  const subscriptionId = 'THE_ID'

  const unsubResp = Proto.SatUnsubsResp.create()
  server.nextRpcResponse('unsubscribe', [unsubResp])
  const resp = await client.unsubscribe([subscriptionId])
  t.deepEqual(resp, {})
})

async function startReplication(
  client: Context['client'],
  server: Context['server']
) {
  const startResp = Proto.SatInStartReplicationResp.create()
  server.nextRpcResponse('startReplication', [startResp])
  await client.startReplication()
}
