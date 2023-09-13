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

function setupDB() {
  db.exec('DROP TABLE IF EXISTS DataTypes')
  db.exec(
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar);"
  )
}

test.beforeEach(setupDB)

/*
 * The tests below check that advanced data types
 * can be written into the DB, thereby, testing that
 * JS objects can be transformed to SQLite compatible values on writes
 * and then be converted back to JS objects on reads.
 */

test.serial('support date type', async (t) => {
  const date = '2023-08-07'
  const d = new Date(`${date} 23:28:35.421`)
  const res = await tbl.create({
    data: {
      id: 1,
      date: d,
    }
  })

  t.deepEqual(res.date, new Date(date))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1
    }
  })

  t.deepEqual(fetchRes?.date, new Date(date))
})

test.serial('support time type', async (t) => {
  const date = new Date('2023-08-07 18:28:35.421')
  const res = await tbl.create({
    data: {
      id: 1,
      time: date,
    }
  })

  t.deepEqual(res.time, new Date('1970-01-01 18:28:35.421'))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1
    }
  })

  t.deepEqual(fetchRes?.time, new Date('1970-01-01 18:28:35.421'))
})

test.serial('support timetz type', async (t) => {
  // Check that we store the time without taking into account timezones
  // such that upon reading we get the same time even if we are in a different time zone
  // test with 2 different time zones such that they cannot both coincide with the machine's timezone.
  const date1 = new Date('2023-08-07 18:28:35.421+02')
  const date2 = new Date('2023-08-07 18:28:35.421+03')
  const res1 = await tbl.create({
    data: {
      id: 1,
      timetz: date1,
    }
  })

  const res2 = await tbl.create({
    data: {
      id: 2,
      timetz: date2,
    }
  })

  t.deepEqual(res1.timetz, new Date('1970-01-01 18:28:35.421+02'))
  t.deepEqual(res2.timetz, new Date('1970-01-01 18:28:35.421+03'))

  const fetchRes1 = await tbl.findUnique({
    where: {
      id: 1
    }
  })

  const fetchRes2 = await tbl.findUnique({
    where: {
      id: 2
    }
  })

  t.deepEqual(fetchRes1?.timetz, new Date('1970-01-01 18:28:35.421+02'))
  t.deepEqual(fetchRes2?.timetz, new Date('1970-01-01 18:28:35.421+03'))
})

test.serial('support timestamp type', async (t) => {
  const date = new Date('2023-08-07 18:28:35.421')

  const res = await tbl.create({
    data: {
      id: 1,
      timestamp: date,
    }
  })

  t.deepEqual(res.timestamp, new Date('2023-08-07 18:28:35.421'))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1
    }
  })

  t.deepEqual(fetchRes?.timestamp, new Date('2023-08-07 18:28:35.421'))
})

test.serial('support timestamptz type', async (t) => {
  // Check that we store the timestamp without taking into account timezones
  // such that upon reading we get the same timestamp even if we are in a different time zone
  // test with 2 different time zones such that they cannot both coincide with the machine's timezone.
  const date1 = new Date('2023-08-07 18:28:35.421+02')
  const date2 = new Date('2023-08-07 18:28:35.421+03')

  const res1 = await tbl.create({
    data: {
      id: 1,
      timestamptz: date1,
    }
  })

  const res2 = await tbl.create({
    data: {
      id: 2,
      timestamptz: date2,
    }
  })

  t.deepEqual(res1.timestamptz, date1)
  t.deepEqual(res2.timestamptz, date2)

  const fetchRes1 = await tbl.findUnique({
    where: {
      id: 1
    }
  })

  const fetchRes2 = await tbl.findUnique({
    where: {
      id: 2
    }
  })

  t.deepEqual(fetchRes1?.timestamptz, date1)
  t.deepEqual(fetchRes2?.timestamptz, date2)
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
    },
    select: {
      id: true,
      timestamptz: true
    }
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1
    },
    select: {
      id: true,
      timestamptz: true
    }
  })

  t.deepEqual(fetchRes, expectedRes)
})
