import test from 'ava'
import Database from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema } from '../generated'
import { DataTypes, Dummy } from '../generated/client'

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
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar, 'bool' int, 'uuid' varchar, 'int2' int2, 'int4' int4, 'int8' int8, 'float8' real, 'relatedId' int);"
  )

  db.exec('DROP TABLE IF EXISTS Dummy')
  db.exec("CREATE TABLE Dummy('id' int PRIMARY KEY, 'timestamp' varchar);")
}

test.beforeEach(setupDB)

/*
 * The tests below check that the DAL correctly transforms JS objects in user input.
 */

test.serial('findUnique transforms JS objects to SQLite', async (t) => {
  const date = '2023-09-13 23:33:04.271'

  await electric.adapter.run({
    sql: `INSERT INTO DataTypes('id', 'timestamp') VALUES (1, '${date}')`,
  })

  const res = await tbl.findUnique({
    where: {
      timestamp: new Date(date),
    },
  })

  t.deepEqual(res?.timestamp, new Date(date))
})

test.serial('findFirst transforms JS objects to SQLite', async (t) => {
  const date = '2023-09-13 23:33:04.271'

  await electric.adapter.run({
    sql: `INSERT INTO DataTypes('id', 'timestamp') VALUES (1, '${date}')`,
  })

  const res = await tbl.findFirst({
    where: {
      timestamp: new Date(date),
    },
  })

  t.deepEqual(res?.timestamp, new Date(date))
})

test.serial('findFirst transforms booleans to integer in SQLite', async (t) => {
  await electric.adapter.run({
    sql: `INSERT INTO DataTypes('id', 'bool') VALUES (1, 0), (2, 1)`,
  })

  const res = await tbl.findFirst({
    where: {
      bool: true,
    },
  })

  t.is(res?.id, 2)
  t.is(res?.bool, true)
})

test.serial(
  'findFirst transforms JS objects in equals filter to SQLite',
  async (t) => {
    const date = '2023-09-13 23:33:04.271'

    await electric.adapter.run({
      sql: `INSERT INTO DataTypes('id', 'timestamp') VALUES (1, '${date}')`,
    })

    const res = await tbl.findFirst({
      where: {
        timestamp: {
          gt: new Date('2023-09-13 23:33:03.271'),
        },
      },
    })

    t.deepEqual(res?.timestamp, new Date(date))
  }
)

test.serial(
  'findFirst transforms JS objects in not filter to SQLite',
  async (t) => {
    const date1 = '2023-09-13 23:33:04.271'
    const date2 = '2023-09-12 16:04:39.034'

    await electric.adapter.run({
      sql: `INSERT INTO DataTypes('id', 'timestamp') VALUES (1, '${date1}'), (2, '${date2}')`,
    })

    const res = await tbl.findFirst({
      where: {
        timestamp: {
          not: new Date(date1),
        },
      },
    })

    t.deepEqual(res?.timestamp, new Date(date2))
  }
)

test.serial(
  'findFirst transforms JS objects in deeply nested filter to SQLite',
  async (t) => {
    const date = '2023-09-13 23:33:04.271'

    await electric.adapter.run({
      sql: `INSERT INTO DataTypes('id', 'timestamp') VALUES (1, '${date}')`,
    })

    const res = await tbl.findFirst({
      where: {
        timestamp: {
          gt: new Date('2023-09-13 23:33:03.271'),
        },
      },
    })

    t.deepEqual(res?.timestamp, new Date(date))
  }
)

test.serial(
  'findMany transforms JS objects in `in` filter to SQLite',
  async (t) => {
    const date1 = '2023-09-13 23:33:04.271'
    const date2 = '2023-09-12 16:04:39.034'
    const date3 = '2023-09-11 08:19:21.827'

    await electric.adapter.run({
      sql: `INSERT INTO DataTypes('id', 'timestamp') VALUES (1, '${date1}'), (2, '${date2}'), (3, '${date3}')`,
    })

    const res = await tbl.findMany({
      where: {
        timestamp: {
          in: [new Date(date1), new Date(date2)],
        },
      },
    })

    t.deepEqual(
      res.map((row) => row.timestamp),
      [new Date(date1), new Date(date2)]
    )
  }
)

test.serial('create transforms nested JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')

  const record = {
    id: 1,
    timestamp: date1,
    related: {
      create: {
        id: 2,
        timestamp: date2,
      },
    },
  }

  const res = (await tbl.create({
    data: record,
    include: {
      related: true,
    },
  })) as DataTypes & { related: Dummy }

  t.deepEqual(res.id, 1)
  t.deepEqual(res.timestamp, date1)
  t.deepEqual(res.related.id, 2)
  t.deepEqual(res.related.timestamp, date2)

  const fetchRes = (await tbl.findUnique({
    where: {
      id: 1,
    },
    include: {
      related: true,
    },
  })) as DataTypes & { related: Dummy }

  t.deepEqual(fetchRes.id, 1)
  t.deepEqual(fetchRes.timestamp, date1)
  t.deepEqual(fetchRes.related.id, 2)
  t.deepEqual(fetchRes.related.timestamp, date2)
})

const dateNulls = {
  date: null,
  time: null,
  timetz: null,
  timestamp: null,
  timestamptz: null,
  bool: null,
  int2: null,
  int4: null,
  int8: null,
  float8: null,
  uuid: null,
}

const nulls = {
  ...dateNulls,
  relatedId: null,
}

test.serial('createMany transforms JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')

  const record1 = {
    id: 1,
    timestamp: date1,
  }

  const record2 = {
    id: 2,
    timestamp: date2,
  }

  const res = await tbl.createMany({
    data: [record1, record2],
  })

  t.is(res.count, 2)

  const fetchRes = await tbl.findMany({
    where: {
      id: {
        in: [1, 2],
      },
    },
  })

  t.deepEqual(fetchRes, [
    {
      ...nulls,
      ...record1,
    },
    {
      ...nulls,
      ...record2,
    },
  ])
})

test.serial('update transforms JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')

  await tbl.create({
    data: {
      id: 1,
      timestamp: date1,
      related: {
        create: {
          id: 2,
          timestamp: date2,
        },
      },
    },
  })

  const updateRes = await tbl.update({
    data: {
      timestamp: date2,
      related: {
        update: {
          timestamp: date1,
        },
      },
    },
    where: {
      id: 1,
    },
    include: {
      related: true,
    },
  })

  const expected = {
    ...dateNulls,
    id: 1,
    timestamp: date2,
    relatedId: 2,
    related: {
      id: 2,
      timestamp: date1,
    },
  }

  t.deepEqual(updateRes, expected)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    include: {
      related: true,
    },
  })

  t.deepEqual(fetchRes, expected)
})

test.serial('updateMany transforms JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')
  const date3 = new Date('2023-09-11 23:33:04.271')

  await tbl.create({
    data: {
      id: 1,
      timestamp: date1,
    },
  })

  await tbl.create({
    data: {
      id: 2,
      timestamp: date2,
    },
  })

  const { count } = await tbl.updateMany({
    data: {
      timestamp: date3,
    },
    where: {
      timestamp: date1,
    },
  })

  t.is(count, 1)

  const fetchRes = await tbl.findMany({
    select: {
      timestamp: true,
    },
  })

  t.deepEqual(fetchRes, [{ timestamp: date3 }, { timestamp: date2 }])
})

test.serial('upsert transforms JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')
  const date3 = new Date('2023-09-11 23:33:04.271')

  const row1 = {
    id: 1,
    timestamp: date1,
    related: {
      create: {
        id: 2,
        timestamp: date2,
      },
    },
  }

  // upsert will create row1
  const createRes = await tbl.upsert({
    create: row1,
    update: {
      timestamp: date1,
    },
    where: {
      id: 1,
    },
    include: {
      related: true,
    },
  })

  t.deepEqual(createRes, {
    ...dateNulls,
    id: 1,
    timestamp: date1,
    related: {
      id: 2,
      timestamp: date2,
    },
    relatedId: 2,
  })

  const updateRes = await tbl.upsert({
    create: row1,
    update: {
      timestamp: date3,
      related: {
        update: {
          timestamp: date3,
        },
      },
    },
    where: {
      id: 1,
    },
    include: {
      related: true,
    },
  })

  const expected = {
    ...dateNulls,
    id: 1,
    timestamp: date3,
    related: {
      id: 2,
      timestamp: date3,
    },
    relatedId: 2,
  }

  t.deepEqual(updateRes, expected)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
    include: {
      related: true,
    },
  })

  t.deepEqual(fetchRes, expected)
})

test.serial('delete transforms JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')

  const row1 = {
    id: 1,
    timestamp: date1,
    related: {
      create: {
        id: 2,
        timestamp: date2,
      },
    },
  }

  const createRes = await tbl.create({
    data: row1,
    include: {
      related: true,
    },
  })

  const expected = {
    ...dateNulls,
    id: 1,
    timestamp: date1,
    related: {
      id: 2,
      timestamp: date2,
    },
    relatedId: 2,
  }

  t.deepEqual(createRes, expected)

  const deleteRes = await tbl.delete({
    where: {
      timestamp: date1,
    },
    include: {
      related: true,
    },
  })

  t.deepEqual(deleteRes, expected)

  const fetchRes = await tbl.findUnique({
    where: {
      id: 1,
    },
  })

  t.is(fetchRes, null)
})

test.serial('deleteMany transforms JS objects to SQLite', async (t) => {
  const date1 = new Date('2023-09-13 23:33:04.271')
  const date2 = new Date('2023-09-12 23:33:04.271')
  const date3 = new Date('2023-09-11 23:33:04.271')

  const o1 = {
    id: 1,
    timestamp: date1,
  }

  const o2 = {
    id: 2,
    timestamp: date2,
  }

  const o3 = {
    id: 3,
    timestamp: date3,
  }

  const { count } = await tbl.createMany({
    data: [o1, o2, o3],
  })

  t.is(count, 3)

  const deleteRes = await tbl.deleteMany({
    where: {
      timestamp: {
        in: [o1.timestamp, o2.timestamp],
      },
    },
  })

  t.is(deleteRes.count, 2)

  const fetchRes = await tbl.findMany({
    select: {
      id: true,
      timestamp: true,
    },
  })

  t.deepEqual(fetchRes, [o3])
})
