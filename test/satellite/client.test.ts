import {
  SatInStopReplicationResp,
  SatInStartReplicationResp,
  SatOpCommit,
  SatOpBegin,
  SatOpLog,
} from '../../src/_generated/proto/satellite';
import { SocketNode } from '../../src/sockets/socket';
import { SatelliteClientErrorCode, SatelliteError, TCPSatelliteClient } from '../../src/satellite/client';
import { TCPSatelliteServerStub } from './server_stub';
import test from 'ava'

test.beforeEach(t => {
  const server = new TCPSatelliteServerStub();
  server.start();

  const socket = new SocketNode();
  const client = new TCPSatelliteClient(socket, {
    address: '127.0.0.1',
    port: 30002,
    timeout: 10000,
  });

  t.context = {
    server,
    client
  }
})

test.afterEach.always(async t => {
  const { server, client } = t.context as any;

  await client.close();
  server.close();
})

test.serial('connect success', async t => {
  const { client } = t.context as any;

  try {
    await client.connect();
  } catch (err) {
    t.fail(`unexpected error: ${err}`);
  } finally {
    t.pass();
  }

  // TODO: handle connection errors
});

test.serial('replication start timeout', async t => {
  const { client, server } = t.context as any;
  client.opts.timeout = 10
  client.connect();

  server.nextSequence([]); // empty response will trigger client timeout
  try {
    await client.startReplication("", false);
    t.fail(`start replication should throw`);
  } catch (error) {
    t.is((error as SatelliteError).code, SatelliteClientErrorCode.TIMEOUT);
  }
});

// TODO: make test that shows that timeout is not triggered while mensages are being sent

test.serial('replication start success', async t => {
  const { client, server } = t.context as any;
  client.connect();

  let startResp: SatInStartReplicationResp = SatInStartReplicationResp.fromPartial({});
  server.nextResponse(startResp);

  try {
    await client.startReplication("", false);
  } catch (err) {
    t.fail(`unexpected error: ${err}`);
  } finally {
    t.pass();
  }
});

test.serial('replication start failure', async t => {
  const { client, server } = t.context as any;
  client.connect();

  let startResp: SatInStartReplicationResp = SatInStartReplicationResp.fromPartial({});
  server.nextResponse(startResp);

  try {
    await client.startReplication("", false);
    await client.startReplication("", false); // fails after started
  } catch (error) {
    t.is((error as any).code, SatelliteClientErrorCode.REPLICATION_ALREADY_STARTED);
  }
});

test.serial('replication stop success', async t => {
  const { client, server } = t.context as any;
  client.connect();

  const start: SatInStartReplicationResp = SatInStartReplicationResp.fromPartial({});
  const stop: SatInStopReplicationResp = SatInStopReplicationResp.fromPartial({});
  server.nextResponse(start);
  server.nextResponse(stop);

  try {
    await client.startReplication("");
    await client.stopReplication();
  } catch (error) {
    t.fail(`unexpected error: ${error}`);
  } finally {
    t.pass();
  }
});

test.serial('replication stop failure', async t => {
  const { client, server } = t.context as any;
  client.connect();

  let stop: SatInStopReplicationResp = SatInStopReplicationResp.fromPartial({});
  server.nextResponse(stop);

  try {
    await client.stopReplication();
    t.fail(`stop replication should throw`);
  } catch (error) {
    t.is((error as any).code, SatelliteClientErrorCode.REPLICATION_NOT_STARTED);
  }
});

test.serial('receive empty transaction', async t => {
  const { client, server } = t.context as any;
  client.connect();

  const start: SatInStartReplicationResp = SatInStartReplicationResp.fromPartial({});
  const begin: SatOpBegin = SatOpBegin.fromPartial({});
  const commit: SatOpCommit = SatOpCommit.fromPartial({});
  const oplog: SatOpLog = SatOpLog.fromPartial({ ops: [{ begin, commit }] });
  const stop: SatInStopReplicationResp = SatInStopReplicationResp.fromPartial({});

  // would be nicer that server would periodically process the queue,
  // but let's do that only when necessary.
  server.nextSequence([start, oplog]);
  server.nextResponse(stop);
  await new Promise<void>(async (resolve, _reject) => {
    client.on('transaction', () => {
      t.pass();

    });

    client.on('stopped', () => {
      resolve();
    });

    await client.startReplication("");
    await client.stopReplication();
  });
});

// test handleIncoming error
// test handler is not called after client stops replication (is removeListener used correctly?)