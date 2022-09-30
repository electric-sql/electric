import {
  SatInStopReplicationResp,
  SatInStartReplicationResp,
  SatOpCommit,
  SatOpBegin,
  SatOpLog,
  SatPingReq,
  SatOpInsert,
  SatRelation,
  SatRelationColumn,
  SatRelation_RelationType,
  SatOpUpdate,
  SatOpDelete,
  SatTransOp,
  SatAuthResp,
  SatPingResp,
} from '../../src/_generated/proto/satellite';
import { WebSocketNode } from '../../src/sockets/node/websocket';
import { SatelliteClient } from '../../src/satellite/client';
import { SatelliteWSServerStub } from './server_ws_stub';
import test from 'ava'
import Long from 'long';
import { AckType, ChangeType, DEFAULT_LSN, SatelliteErrorCode, Transaction } from '../../src/util/types';
import { getObjFromString, getTypeFromCode, getTypeFromString, SatPbMsg } from '../../src/util/proto';
import { OplogEntry, toTransactions } from '../../src/satellite/oplog';
import { relations } from './common';


test.beforeEach(t => {
  const server = new SatelliteWSServerStub();
  server.start();

  const socket = new WebSocketNode();
  const client = new SatelliteClient(socket, {
    appId: "fake_id",
    token: "fake_token",
    address: '127.0.0.1',
    port: 30002,
    timeout: 10000
  });

  t.context = {
    server,
    client
  }
});

type Context = {
  server: SatelliteWSServerStub,
  client: SatelliteClient
}

test.afterEach.always(async t => {
  const { server, client } = t.context as Context;

  await client.close();
  server.close();
});

test.serial('connect success', async t => {
  const { client } = t.context as Context;

  await client.connect();
  t.pass();
});

// TODO: handle connection errors scenarios

async function connectAndAuth({ client, server }) {
  await client.connect();

  const authResp = SatAuthResp.fromPartial({});
  server.nextResponses([authResp]);
  await client.authenticate();
}

test.serial('replication start timeout', async t => {
  const { client, server } = t.context as Context;
  client['opts'].timeout = 10
  await client.connect();

  // empty response will trigger client timeout
  server.nextResponses([]); 
  try {
    await client.startReplication();
    t.fail(`start replication should throw`);
  } catch (error) {
    t.is(error!.code, SatelliteErrorCode.TIMEOUT);
  }
});

test.serial('authentication success', async t => {
  const { client, server } = t.context as Context;
  await client.connect();

  const authResp = SatAuthResp.fromPartial({ id: "server_identity" });
  server.nextResponses([authResp]);

  const res = await client.authenticate();
  t.is(res['serverId'], "server_identity");
  t.is(client['inbound'].authenticated, true);

});

test.serial('replication start success', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const startResp = SatInStartReplicationResp.fromPartial({});
  server.nextResponses([startResp]);

  await client.startReplication();
  t.pass();
});

test.serial('replication start failure', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const startResp = SatInStartReplicationResp.fromPartial({});
  server.nextResponses([startResp]);

  try {
    await client.startReplication();
    await client.startReplication(); // fails
  } catch (error) {
    t.is((error as any).code, SatelliteErrorCode.REPLICATION_ALREADY_STARTED);
  }
});

test.serial('replication stop success', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const start = SatInStartReplicationResp.fromPartial({});
  const stop = SatInStopReplicationResp.fromPartial({});
  server.nextResponses([start]);
  server.nextResponses([stop]);

  await client.startReplication();
  await client.stopReplication();
  t.pass();
});

test.serial('replication stop failure', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const stop = SatInStopReplicationResp.fromPartial({});
  server.nextResponses([stop]);

  try {
    await client.stopReplication();
    t.fail(`stop replication should throw`);
  } catch (error) {
    t.is((error as any).code, SatelliteErrorCode.REPLICATION_NOT_STARTED);
  }
});

test.serial('server pings client', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const start = SatInStartReplicationResp.fromPartial({});
  const ping = SatPingReq.fromPartial({});
  const stop = SatInStopReplicationResp.fromPartial({});

  return new Promise(async (resolve) => {
    server.nextResponses([start, ping]);
    server.nextResponses([() => {
      t.pass();
      resolve();
    }]);
    server.nextResponses([stop]);

    await client.startReplication();
    await client.stopReplication();
  });
});

test.serial('receive transaction over multiple messages', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const start = SatInStartReplicationResp.fromPartial({});
  const begin = SatOpBegin.fromPartial({ lsn: DEFAULT_LSN, commitTimestamp: Long.ZERO });
  const commit = SatOpCommit.fromPartial({});

  const relation = SatRelation.fromPartial({
    relationId: 1,
    schemaName: 'schema',
    tableName: 'table',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      SatRelationColumn.fromPartial({ name: 'name1', type: 'TEXT' }),
      SatRelationColumn.fromPartial({ name: 'name2', type: 'TEXT' })
    ]
  });

  const encoder = new TextEncoder();

  const insertOp = SatOpInsert.fromPartial({
    relationId: 1,
    rowData: [encoder.encode("Foo"), encoder.encode("Bar")]
  });
  const updateOp = SatOpUpdate.fromPartial({
    relationId: 1,
    rowData: [encoder.encode("Hello"), encoder.encode("World!")],
    oldRowData: [encoder.encode(""), encoder.encode("")]
  });
  const deleteOp = SatOpDelete.fromPartial({
    relationId: 1,
    oldRowData: [encoder.encode("Hello"), encoder.encode("World!")]
  });

  const firstOpLogMessage = SatOpLog.fromPartial({
    ops: [
      SatTransOp.fromPartial({ begin }),
      SatTransOp.fromPartial({ insert: insertOp }),      
    ]
  });

  const secondOpLogMessage = SatOpLog.fromPartial({
    ops: [
      SatTransOp.fromPartial({ update: updateOp }),
      SatTransOp.fromPartial({ delete: deleteOp }),
      SatTransOp.fromPartial({ commit }),
    ]
  });

  const stop = SatInStopReplicationResp.fromPartial({});

  server.nextResponses([start, relation, firstOpLogMessage, secondOpLogMessage]);
  server.nextResponses([stop]);

  await new Promise<void>(async (res) => {
    client.on('transaction', (transaction: Transaction) => {
      t.is(transaction.changes.length, 3);
      res();
    });

    await client.startReplication();
  });
});

test.serial('acknowledge lsn', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const lsn = new TextEncoder().encode("FAKE")
  const lsnDecoder = new TextDecoder()

  const start = SatInStartReplicationResp.fromPartial({});
  const begin = SatOpBegin.fromPartial({ lsn: lsn, commitTimestamp: Long.ZERO });
  const commit = SatOpCommit.fromPartial({});

  const opLog = SatOpLog.fromPartial({
    ops: [
      SatTransOp.fromPartial({ begin }),
      SatTransOp.fromPartial({ commit }),
    ]
  });

  const stop = SatInStopReplicationResp.fromPartial({});

  server.nextResponses([start, opLog]);
  server.nextResponses([stop]);

  await new Promise<void>(async (res) => {
    client.on('transaction', (_t: Transaction, ack: any) => {
      const lsn0 = lsnDecoder.decode(client['inbound'].ack_lsn)
      t.is(lsn0, "0");
      ack();
      const lsn1 = lsnDecoder.decode(client['inbound'].ack_lsn)
      t.is(lsn1, "FAKE");
      res();
    });

    await client.startReplication();
  });
});

test.serial('send transaction', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const startResp = SatInStartReplicationResp.fromPartial({});

  const opLogEntries: OplogEntry[] = [{
    namespace: 'main',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":0}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: 0,
    timestamp: '1970-01-01T00:00:01.000Z'
  },
  {
    namespace: 'main',
    tablename: 'parent',
    optype: 'UPDATE',
    newRow: '{"id":1}',
    oldRow: '{"id":1}',
    primaryKey: '{"id":1}',
    rowid: 1,
    timestamp: '1970-01-01T00:00:01.000Z'
    },
    {
      namespace: 'main',
      tablename: 'parent',
      optype: 'UPDATE',
      newRow: '{"id":1}',
      oldRow: '{"id":1}',
      primaryKey: '{"id":1}',
      rowid: 2,
      timestamp: '1970-01-01T00:00:02.000Z'
  }
  ]

  const transaction = toTransactions(opLogEntries, relations)

  return new Promise(async (res) => {
    server.nextResponses([startResp])
    server.nextResponses([])

    // first message is a relation
    server.nextResponses([
      (data?: Buffer) => {
        const msgType = data!.readUInt8();
        if (msgType == getTypeFromString(SatRelation.$type)) {
          const relation = decode(data!) as SatRelation
          t.deepEqual(relation.relationId, 1)
        }
      }
    ])

    const lsnDecoder = new TextDecoder()

    // second message is a transaction
    server.nextResponses([
      (data?: Buffer) => {
        const msgType = data!.readUInt8();
        if (msgType == getTypeFromString(SatOpLog.$type)) {
          const satOpLog = (decode(data!) as SatOpLog).ops

          const lsn = satOpLog[0].begin?.lsn
          t.is(lsnDecoder.decode(lsn), "1")
          t.deepEqual(satOpLog[0].begin?.commitTimestamp, Long.UZERO.add(1000))
          // TODO: check values
        }
      }
    ])

    // third message after new enqueue does not send relation
    server.nextResponses([
      (data?: Buffer) => {
        const msgType = data!.readUInt8();
        if (msgType == getTypeFromString(SatOpLog.$type)) {
          const satOpLog = (decode(data!) as SatOpLog).ops

          const lsn = satOpLog[0].begin?.lsn
          t.is(lsnDecoder.decode(lsn), "2")
          t.deepEqual(satOpLog[0].begin?.commitTimestamp, Long.UZERO.add(2000))
          // TODO: check values
        }
        res()
      }
    ])

    await client.startReplication()

    // wait a little for replication to start in the opposite direction
    setTimeout(() => {
      client.enqueueTransaction(transaction[0])
      client.enqueueTransaction(transaction[1])
    }, 100)
  })
})

test('ack on send and pong', async t => {
  await connectAndAuth(t.context as Context);
  const { client, server } = t.context as Context;

  const lsnDecoder = new TextDecoder()
  const lsnEncoder = new TextEncoder()

  const lsn_1 = lsnEncoder.encode("1")

  const startResp = SatInStartReplicationResp.fromPartial({});
  const pingResponse = SatPingResp.fromPartial({ lsn: lsn_1 });

  server.nextResponses([startResp])
  server.nextResponses([(pingResponse)])

  await client.startReplication()

  const transaction: Transaction = {
    lsn: lsn_1,
    commit_timestamp: Long.UZERO,
    changes: [
      {
        relation: relations.parent,
        type: ChangeType.INSERT,
        record: { 'id': 0 }
      }]
  }

  await new Promise<void>(res => {
    let sent = false
    client.subscribeToAck((lsn, type) => {
      if (type == AckType.LOCAL_SEND) {
        t.is(lsnDecoder.decode(lsn), "1")
        sent = true
      } else {
        t.is(lsnDecoder.decode(lsn), "1")
        t.is(sent, true)
        res()
      }
    })
    client.enqueueTransaction(transaction)
  })
})



function decode(data: Buffer): SatPbMsg {
  const code = data.readUInt8();
  const type = getTypeFromCode(code);
  const obj = getObjFromString(type);
  return obj.decode(data.subarray(1));
}