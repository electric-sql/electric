import anyTest, { TestFn } from 'ava'
import { QualifiedTablename } from '../../src/util/tablename'
import { SatelliteProcess } from '../../src/satellite/process'
import { makeContext, cleanAndStopSatellite, ContextType } from './common'
import { AuthState } from '../../src/auth'

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
