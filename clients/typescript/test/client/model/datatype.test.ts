import test from 'ava'
import Database from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema, JsonNull } from '../generated'
import { ZodError } from 'zod'

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
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar, 'bool' int, 'uuid' varchar, 'int2' int2, 'int4' int4, 'int8' int8, 'float4' real, 'float8' real, 'json' varchar, 'relatedId' int);"
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
    },
  })

  t.deepEqual(res.date, new Date(date))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.deepEqual(fetchRes?.date, new Date(date))
})

test.serial('support date type passed as string', async (t) => {
  const date = '2023-08-07'
  const res = await tbl.create({
    data: {
      id: 1,
      date: date,
    },
  })

  t.deepEqual(res.date, new Date(date))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.deepEqual(fetchRes?.date, new Date(date))
})

test.serial('support time type', async (t) => {
  const date = new Date('2023-08-07 18:28:35.421')
  const res = await tbl.create({
    data: {
      id: 1,
      time: date,
    },
  })

  t.deepEqual(res.time, new Date('1970-01-01 18:28:35.421'))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
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
    },
  })

  const res2 = await tbl.create({
    data: {
      id: 2,
      timetz: date2,
    },
  })

  t.deepEqual(res1.timetz, new Date('1970-01-01 18:28:35.421+02'))
  t.deepEqual(res2.timetz, new Date('1970-01-01 18:28:35.421+03'))

  const fetchRes1 = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  const fetchRes2 = await tbl.findUnique({
    where: {
      id: 2,
    },
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
    },
  })

  t.deepEqual(res.timestamp, new Date('2023-08-07 18:28:35.421'))

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.deepEqual(fetchRes?.timestamp, new Date('2023-08-07 18:28:35.421'))
})

test.serial('support timestamp type - input date with offset', async (t) => {
  const date = new Date('2023-08-07 18:28:35.421+05')

  const res = await tbl.create({
    data: {
      id: 1,
      timestamp: date,
    },
  })

  t.deepEqual(res.timestamp, date)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.deepEqual(fetchRes?.timestamp, date)
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
    },
  })

  const res2 = await tbl.create({
    data: {
      id: 2,
      timestamptz: date2,
    },
  })

  t.deepEqual(res1.timestamptz, date1)
  t.deepEqual(res2.timestamptz, date2)

  const fetchRes1 = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  const fetchRes2 = await tbl.findUnique({
    where: {
      id: 2,
    },
  })

  t.deepEqual(fetchRes1?.timestamptz, date1)
  t.deepEqual(fetchRes2?.timestamptz, date2)
})

test.serial('support null value for timestamptz type', async (t) => {
  const expectedRes = {
    id: 1,
    timestamptz: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      timestamptz: null,
    },
    select: {
      id: true,
      timestamptz: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      timestamptz: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial('support boolean type', async (t) => {
  // Check that we can store booleans
  const res = await tbl.createMany({
    data: [
      {
        id: 1,
        bool: true,
      },
      {
        id: 2,
        bool: false,
      },
    ],
  })

  t.deepEqual(res, {
    count: 2,
  })

  const rows = await tbl.findMany({
    select: {
      id: true,
      bool: true,
    },
    orderBy: {
      id: 'asc',
    },
  })

  t.deepEqual(rows, [
    {
      id: 1,
      bool: true,
    },
    {
      id: 2,
      bool: false,
    },
  ])

  // Check that it rejects invalid values
  await t.throwsAsync(
    tbl.create({
      data: {
        id: 3,
        // @ts-ignore
        bool: 'true',
      },
    }),
    {
      instanceOf: ZodError,
      message: /Expected boolean, received string/,
    }
  )
})

test.serial('support null value for boolean type', async (t) => {
  const expectedRes = {
    id: 1,
    bool: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      bool: null,
    },
    select: {
      id: true,
      bool: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      bool: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial('support uuid type', async (t) => {
  const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  const res = await tbl.create({
    data: {
      id: 1,
      uuid: uuid,
    },
  })

  t.assert(res.id === 1 && res.uuid === uuid)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.is(fetchRes?.uuid, uuid)

  // Check that it rejects invalid uuids
  await t.throwsAsync(
    tbl.create({
      data: {
        id: 2,
        // the UUID below has 1 character too much in the last group
        uuid: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111',
      },
    }),
    {
      instanceOf: ZodError,
      message: /Invalid uuid/,
    }
  )
})

test.serial('support null value for uuid type', async (t) => {
  const expectedRes = {
    id: 1,
    uuid: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      uuid: null,
    },
    select: {
      id: true,
      uuid: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      uuid: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial('support int2 type', async (t) => {
  const validInt1 = 32767
  const invalidInt1 = 32768

  const validInt2 = -32768
  const invalidInt2 = -32769

  const res = await tbl.createMany({
    data: [
      {
        id: 1,
        int2: validInt1,
      },
      {
        id: 2,
        int2: validInt2,
      },
    ],
  })

  t.deepEqual(res, {
    count: 2,
  })

  // Check that it rejects invalid integers
  const invalidInts = [invalidInt1, invalidInt2]
  let id = 3
  for (const invalidInt of invalidInts) {
    await t.throwsAsync(
      tbl.create({
        data: {
          id: id++,
          int2: invalidInt,
        },
      }),
      {
        instanceOf: ZodError,
        message:
          /(Number must be less than or equal to 32767)|(Number must be greater than or equal to -32768)/,
      }
    )
  }
})

test.serial('support null values for int2 type', async (t) => {
  const expectedRes = {
    id: 1,
    int2: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      int2: null,
    },
    select: {
      id: true,
      int2: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      int2: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial('support int4 type', async (t) => {
  const validInt1 = 2147483647
  const invalidInt1 = 2147483648

  const validInt2 = -2147483648
  const invalidInt2 = -2147483649

  const res = await tbl.createMany({
    data: [
      {
        id: 1,
        int4: validInt1,
      },
      {
        id: 2,
        int4: validInt2,
      },
    ],
  })

  t.deepEqual(res, {
    count: 2,
  })

  // Check that it rejects invalid integers
  const invalidInts = [invalidInt1, invalidInt2]
  let id = 3
  for (const invalidInt of invalidInts) {
    await t.throwsAsync(
      tbl.create({
        data: {
          id: id++,
          int4: invalidInt,
        },
      }),
      {
        instanceOf: ZodError,
        message:
          /(Number must be less than or equal to 2147483647)|(Number must be greater than or equal to -2147483648)/,
      }
    )
  }
})

test.serial('support null values for int4 type', async (t) => {
  const expectedRes = {
    id: 1,
    int4: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      int4: null,
    },
    select: {
      id: true,
      int4: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      int4: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial('support float4 type', async (t) => {
  const validFloat1 = 1.402823e36
  const validFloat2 = -1.402823e36
  const floats = [
    {
      id: 1,
      float4: validFloat1,
    },
    {
      id: 2,
      float4: validFloat2,
    },
    {
      id: 3,
      float4: +Infinity,
    },
    {
      id: 4,
      float4: -Infinity,
    },
    {
      id: 5,
      float4: NaN,
    },
  ]

  const res = await tbl.createMany({
    data: floats,
  })

  t.deepEqual(res, {
    count: 5,
  })

  // Check that we can read the floats back
  const fetchRes = await tbl.findMany({
    select: {
      id: true,
      float4: true,
    },
    orderBy: {
      id: 'asc',
    },
  })

  t.deepEqual(
    fetchRes,
    floats.map((o) => ({ ...o, float4: Math.fround(o.float4) }))
  )
})

test.serial('converts numbers outside float4 range', async (t) => {
  const tooPositive = 2 ** 150
  const tooNegative = -(2 ** 150)
  const tooSmallPositive = 2 ** -150
  const tooSmallNegative = -(2 ** -150)
  const floats = [
    {
      id: 1,
      float4: tooPositive,
    },
    {
      id: 2,
      float4: tooNegative,
    },
    {
      id: 3,
      float4: tooSmallPositive,
    },
    {
      id: 4,
      float4: tooSmallNegative,
    },
  ]

  const res = await tbl.createMany({
    data: floats,
  })

  t.deepEqual(res, {
    count: 4,
  })

  // Check that we can read the floats back
  const fetchRes = await tbl.findMany({
    select: {
      id: true,
      float4: true,
    },
    orderBy: {
      id: 'asc',
    },
  })

  t.deepEqual(fetchRes, [
    {
      id: 1,
      float4: Infinity,
    },
    {
      id: 2,
      float4: -Infinity,
    },
    {
      id: 3,
      float4: 0,
    },
    {
      id: 4,
      float4: 0,
    },
  ])
})
test.serial('support float8 type', async (t) => {
  const validFloat1 = 1.7976931348623157e308
  const validFloat2 = -1.7976931348623157e308
  const floats = [
    {
      id: 1,
      float8: validFloat1,
    },
    {
      id: 2,
      float8: validFloat2,
    },
    {
      id: 3,
      float8: +Infinity,
    },
    {
      id: 4,
      float8: -Infinity,
    },
    {
      id: 5,
      float8: NaN,
    },
  ]

  const res = await tbl.createMany({
    data: floats,
  })

  t.deepEqual(res, {
    count: 5,
  })

  // Check that we can read the floats back
  const fetchRes = await tbl.findMany({
    select: {
      id: true,
      float8: true,
    },
    orderBy: {
      id: 'asc',
    },
  })

  t.deepEqual(fetchRes, floats)
})

test.serial('support null values for float8 type', async (t) => {
  const expectedRes = {
    id: 1,
    float8: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      float8: null,
    },
    select: {
      id: true,
      float8: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      float8: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial('support BigInt type', async (t) => {
  //db.defaultSafeIntegers(true) // enables BigInt support
  const validBigInt1 = BigInt('9223372036854775807')
  const validBigInt2 = BigInt('-9223372036854775808')
  const bigInts = [
    {
      id: 1,
      int8: validBigInt1,
    },
    {
      id: 2,
      int8: validBigInt2,
    },
  ]

  const res = await tbl.createMany({
    data: bigInts,
  })

  t.deepEqual(res, {
    count: 2,
  })

  // Check that we can read the big ints back
  const fetchRes = await tbl.findMany({
    select: {
      id: true,
      int8: true,
    },
    orderBy: {
      id: 'asc',
    },
  })

  t.deepEqual(fetchRes, bigInts)
  //db.defaultSafeIntegers(false) // disables BigInt support
})

test.serial('support null values for BigInt type', async (t) => {
  const expectedRes = {
    id: 1,
    int8: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      int8: null,
    },
    select: {
      id: true,
      int8: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      int8: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})

test.serial(
  'throw error when value is out of range for BigInt type',
  async (t) => {
    const invalidBigInt1 = BigInt('9223372036854775808')
    const invalidBigInt2 = BigInt('-9223372036854775809')

    await t.throwsAsync(
      tbl.create({
        data: {
          id: 1,
          int8: invalidBigInt1,
        },
      }),
      {
        instanceOf: ZodError,
        message: /BigInt must be less than or equal to 9223372036854775807/,
      }
    )

    await t.throwsAsync(
      tbl.create({
        data: {
          id: 2,
          int8: invalidBigInt2,
        },
      }),
      {
        instanceOf: ZodError,
        message: /too_small/,
      }
    )
  }
)


test.serial('support JSON type', async (t) => {
  const json = { a: 1, b: true, c: { d: 'nested' }, e: [1, 2, 3], f: null }
  const res = await tbl.create({
    data: {
      id: 1,
      json,
    },
  })

  t.deepEqual(res.json, json)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.deepEqual(fetchRes?.json, json)

  // Also test that we can write the special JsonNull value
  const res2 = await tbl.create({
    data: {
      id: 2,
      json: JsonNull,
    },
  })

  t.deepEqual(res2.json, JsonNull)

  const fetchRes2 = await tbl.findUnique({
    where: {
      id: 2,
    },
  })

  t.deepEqual(fetchRes2?.json, JsonNull)
})

test.serial('support null values for JSON type', async (t) => {
  const expectedRes = {
    id: 1,
    json: null,
  }

  const res = await tbl.create({
    data: {
      id: 1,
      json: null,
    },
    select: {
      id: true,
      json: true,
    },
  })

  t.deepEqual(res, expectedRes)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    select: {
      id: true,
      json: true,
    },
  })

  t.deepEqual(fetchRes, expectedRes)
})
