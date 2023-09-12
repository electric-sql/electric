import test from 'ava'
import Database from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema } from '../generated'

const db = new Database(':memory:')
const electric = await electrify(
  db,
  schema,
  {
    auth: {
      token: 'test-token',
    },
  },
  { registry: new MockRegistry() }
)

const tbl = electric.db.DataTypes

// Sync all shapes such that we don't get warnings on every query
await tbl.sync()

// TODO: SETUP DB!!!! and ALWAYS INVOKE CLEAR between all tests
function setupDB() {
  db.exec('DROP TABLE IF EXISTS DataTypes')
  db.exec(
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'timestamptz' varchar);"
  )
}

test.beforeEach(setupDB)

/*
 * The tests below check that advanced data types
 * can be written into the DB, thereby, testing that
 * JS objects can be transformed to SQLite compatible values on writes
 * and then be converted back to JS objects on reads.
 */

test.serial('support timestamptz type', async (t) => {
  const date = new Date()
  const res = await tbl.create({
    data: {
      id: 1,
      timestamptz: date,
    }
  })

  t.is(res.timestamptz!.toISOString(), date.toISOString())

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1
    }
  })
  
  t.is(fetchRes!.timestamptz!.toISOString(), date.toISOString())

  //const rawRes = await electric.db.raw({ sql: "SELECT * FROM User WHERE id = ?", args: [ author1.id ] })
  //console.log("raw res is:\n" + JSON.stringify(rawRes))
})

test.serial('support null value for timestamptz type', async (t) => {
  const expectedRes = {
    id: 1,
    timestamptz: null
  }

  const res = await tbl.create({
    data: {
      id: 1,
      timestamptz: null,
    }
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1
    }
  })

  t.deepEqual(fetchRes, expectedRes)
})