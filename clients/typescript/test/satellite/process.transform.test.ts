import anyTest, { TestFn } from 'ava'
import { QualifiedTablename } from '../../src/util/tablename'
import { SatelliteProcess } from '../../src/satellite/process'
import {
  makeContext,
  cleanAndStopSatellite,
  ContextType,
  relations,
} from './common'
import { AuthState } from '../../src/auth'
import Long from 'long'
import { DataChange, DataChangeType } from '../../src/util'
import { UnsubscribeFunction } from '../../src/notifiers'

const startSatellite = async (
  satellite: SatelliteProcess,
  authState: AuthState,
  token: string
) => {
  await satellite.start(authState)
  satellite.setToken(token)
  const connectionPromise = satellite.connectWithBackoff()
  await connectionPromise
}

const test = anyTest as TestFn<ContextType>
test.beforeEach(makeContext)
test.afterEach.always(cleanAndStopSatellite)

test('setReplicationTransform transforms outbound INSERTs, UPDATEs, and DELETEs', async (t) => {
  const { adapter, runMigrations, satellite, authState, client, token } =
    t.context

  await runMigrations()
  await startSatellite(satellite, authState, token)

  t.deepEqual(client.outboundTransactionsEnqueued, [])

  const statementsToCompare = [
    {
      sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
      args: [1, 'local', null],
    },
    {
      sql: `UPDATE parent SET value = ?, other = ? WHERE id = ?;`,
      args: ['different', 2, 1],
    },
    {
      sql: `DELETE FROM parent WHERE id = ?;`,
      args: [1],
    },
  ]

  // perform snapshot for replication without transform
  for (const stmt of statementsToCompare) {
    await adapter.run(stmt)
  }
  await satellite._performSnapshot()

  // set replication transform and perform same operations for replication
  satellite.setReplicationTransform(
    new QualifiedTablename('main', 'parent'),
    (row) => ({
      ...row,
      value: 'transformed_inbound_' + row.value,
    }),
    (row) => ({
      ...row,
      value: 'transformed_outbound_' + row.value,
    })
  )
  for (const stmt of statementsToCompare) {
    await adapter.run(stmt)
  }
  await satellite._performSnapshot()

  const plainChanges = client.outboundTransactionsEnqueued[0].changes
  const transformedChanges = client.outboundTransactionsEnqueued[1].changes

  // ensure plain change actually has plain data
  t.deepEqual(plainChanges[0].record, {
    id: 1,
    value: 'local',
    other: null,
  })

  // assert INSERTs are transformed
  t.deepEqual(transformedChanges[0], {
    ...plainChanges[0],
    record: {
      id: 1,
      value: 'transformed_outbound_local',
      other: null,
    },
  })

  // assert UPDATEs are transformed
  t.deepEqual(transformedChanges[1], {
    ...plainChanges[1],
    oldRecord: {
      id: 1,
      value: 'transformed_outbound_local',
      other: null,
    },
    record: {
      id: 1,
      value: 'transformed_outbound_different',
      // other remains unchanged
      other: 2,
    },
  })

  // assert DELETEs are transformed
  t.deepEqual(transformedChanges[2], {
    ...plainChanges[2],
    oldRecord: {
      id: 1,
      value: 'transformed_outbound_different',
      other: 2,
    },
  })
})

test('setReplicationTransform transforms inbound INSERTs and UPDATEs', async (t) => {
  const {
    adapter,
    runMigrations,
    satellite,
    authState,
    client,
    token,
    notifier,
  } = t.context

  await runMigrations()
  await startSatellite(satellite, authState, token)

  const applyServerSideChange = (change: DataChange): Promise<void> => {
    let unsubscribeFn: UnsubscribeFunction
    return new Promise((res) => {
      unsubscribeFn = notifier.subscribeToDataChanges(res)
      client.transactionsCb?.({
        commit_timestamp: Long.fromNumber(new Date().getTime()),
        id: new Long(10),
        lsn: new Uint8Array(),
        changes: [change],
      })
    }).then(() => unsubscribeFn())
  }

  const serverChangesToCompare = [
    {
      relation: relations.parent,
      record: {
        id: 1,
        value: 'local',
        other: null,
      },
      tags: [],
      type: DataChangeType.INSERT,
    },
    {
      relation: relations.parent,
      record: {
        id: 1,
        value: 'different',
        other: 2,
      },
      tags: [],
      type: DataChangeType.UPDATE,
    },
    {
      relation: relations.parent,
      record: {
        id: 1,
        value: 'different',
        other: 2,
      },
      tags: [],
      type: DataChangeType.DELETE,
    },
  ]

  const plainRecords = []
  const transformedRecords = []

  // perform snapshot for replication without transform
  for (const change of serverChangesToCompare) {
    await applyServerSideChange(change)
    const result = await adapter.query({
      sql: `SELECT * FROM parent WHERE id = ?;`,
      args: [1],
    })
    plainRecords.push(...result)
  }

  // set replication transform and perform same server-side operations
  satellite.setReplicationTransform(
    new QualifiedTablename('main', 'parent'),
    (row) => ({
      ...row,
      value: 'transformed_inbound_' + row.value,
    }),
    (row) => ({
      ...row,
      value: 'transformed_outbound_' + row.value,
    })
  )
  for (const change of serverChangesToCompare) {
    await applyServerSideChange(change)
    const result = await adapter.query({
      sql: `SELECT * FROM parent WHERE id = ?;`,
      args: [1],
    })
    transformedRecords.push(...result)
  }

  // assert INSERT was transformed
  t.deepEqual(transformedRecords[0], {
    ...plainRecords[0],
    value: 'transformed_inbound_local',
  })

  // assert UPDATE was transformed
  t.deepEqual(transformedRecords[1], {
    ...plainRecords[1],
    value: 'transformed_inbound_different',
  })

  // assert DELETE occurred regardless of transform
  t.is(transformedRecords[2], plainRecords[2])
  t.is(transformedRecords[2] as unknown, undefined)
})
