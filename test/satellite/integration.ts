import { WebSocketNode } from '../../src/sockets/node/websocket';
import test from 'ava'
import { randomValue } from '../../src/util/random';
import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { SatelliteProcess } from '../../src/satellite/process';
import { BundleMigrator } from '../../src/migrators/bundle';
import { MockNotifier } from '../../src/notifiers/mock';
import { satelliteClientDefaults, satelliteDefaults } from '../../src/satellite/config';
import { readFile, rm as removeFile } from 'fs/promises';
import { Satellite } from '../../src/satellite';
import { SatelliteClient } from '../../src/satellite/client';
import { randomUUID } from 'crypto';

import { data as testMigrationsData } from '../support/migrations'
const { migrations } = testMigrationsData

type Context = {
    dbName: string,
    adapter: DatabaseAdapter,
    client: SatelliteClient,
    satellite: Satellite,
    notifier: MockNotifier,
    runMigrations: () => Promise<void>
}

const opts = Object.assign({}, satelliteDefaults, {
    minSnapshotWindow: 20,
    pollingInterval: 100
})

const clientOpts = Object.assign({}, satelliteClientDefaults, {
    appId: "fake_id",
    token: "fake_token",
    address: '127.0.0.1',
    port: 5133,
    timeout: 10000,
    minSnapshotWindow: 20,
    pollingInterval: 100
})

test.beforeEach(t => {
    // ensure server is started
    const socket = new WebSocketNode();

    const dbName = `integration-${randomValue()}.db`
    const db = new Database(dbName)
    const adapter = new DatabaseAdapter(db)

    const migrator = new BundleMigrator(adapter, migrations)
    const notifier = new MockNotifier(dbName)
    const client = new SatelliteClient(socket, clientOpts)

    const satellite = new SatelliteProcess(dbName, adapter, migrator, notifier, client, opts)

    const runMigrations = async () => {
      migrator.up()
    }

    return t.context = {
        dbName,
        adapter,
        satellite,
        notifier,
        runMigrations
    }
});

test.afterEach.always(async t => {
    const { satellite, dbName } = t.context as Context;
    await satellite.stop();

    await removeFile(dbName, { force: true })
    await removeFile(`${dbName}-journal`, { force: true })
});

test('receive data', async t => {
    // add some data to the replication stream and wait
    const { adapter, satellite, runMigrations } = t.context as Context;
    await runMigrations()

    await satellite.start();

    await new Promise<void>((resolve) => {
        setTimeout(async () => {
            await adapter.query('select * from _electric_meta')
            t.pass()
            resolve()
        }, 3000)
    })
})

test('send data', async t => {
    const { adapter, satellite, runMigrations } = t.context as Context;
    await runMigrations()

    await satellite.start();

    await new Promise<void>((resolve) => {
        setTimeout(async () => {
            try {
                const uuid = randomUUID()
                await adapter.run(`INSERT INTO entries(id, content, content_b) VALUES ('${uuid}','hi', 'there')`)
                await satellite['_performSnapshot']()
                t.pass()
                resolve()
            } catch (error) {
                console.log(error)
            }
        }, 1000)
    })
})
