import test from 'ava'
import Database from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3'
import { z } from 'zod'

const config = {
  app: 'app',
  env: 'env',
  migrations: [],
}

const conn = new Database(':memory:')

// Schema describing the DB
// can be defined manually, or generated
const dbSchemas = {
  items: z
    .object({
      value: z.string(),
      nbr: z.number(),
    })
    .strict(),
}

const { notifier, adapter, db } = await electrify(conn, dbSchemas, config)

async function runAndCheckNotifications(f: () => Promise<void>) {
  let notifications = 0
  const sub = notifier.subscribeToPotentialDataChanges((_notification) => {
    notifications = notifications + 1
  })

  await f()

  notifier.unsubscribeFromPotentialDataChanges(sub)
  return notifications
}

// Clean the DB environment
async function cleanDB() {
  await adapter.run({ sql: 'DROP TABLE IF EXISTS items' })
  await adapter.run({
    sql: 'CREATE TABLE IF NOT EXISTS items (value TEXT PRIMARY KEY NOT NULL, nbr INTEGER) WITHOUT ROWID;',
  })
}

// Clean the DB before each test
test.serial.beforeEach(async (_t) => {
  await cleanDB()
})

// Clean the DB after all tests
test.serial.after(async (_t) => {
  await adapter.run({ sql: 'DROP TABLE IF EXISTS items' })
})

test.serial('create runs potentiallyChanged', async (t) => {
  const insert = async () => {
    await db.items.create({
      data: {
        value: 'foo',
        nbr: 5,
      },
    })
  }

  const notifications = await runAndCheckNotifications(insert)
  t.is(notifications, 1)
})

test.serial('createMany runs potentiallyChanged', async (t) => {
  const insert = async () => {
    await db.items.createMany({
      data: [
        {
          value: 'foo',
          nbr: 5,
        },
        {
          value: 'bar',
          nbr: 6,
        },
      ],
    })
  }

  const notifications = await runAndCheckNotifications(insert)
  t.is(notifications, 1)
})

async function populate() {
  await db.items.createMany({
    data: [
      {
        value: 'foo',
        nbr: 5,
      },
      {
        value: 'bar',
        nbr: 6,
      },
    ],
  })
}

test.serial('findUnique does not run potentiallyChanged', async (t) => {
  await populate()

  const find = async () => {
    await db.items.findUnique({
      where: {
        value: 'foo',
      },
    })
  }

  const notifications = await runAndCheckNotifications(find)
  t.is(notifications, 0)
})

test.serial('findFirst does not run potentiallyChanged', async (t) => {
  const find = async () => {
    await db.items.findFirst({})
  }

  const notifications = await runAndCheckNotifications(find)
  t.is(notifications, 0)
})

test.serial('findMany does not run potentiallyChanged', async (t) => {
  const find = async () => {
    await db.items.findMany({})
  }

  const notifications = await runAndCheckNotifications(find)
  t.is(notifications, 0)
})

test.serial('update runs potentiallyChanged', async (t) => {
  await populate()

  const update = async () => {
    await db.items.update({
      data: {
        nbr: 18,
      },
      where: {
        value: 'foo',
      },
    })
  }

  const notifications = await runAndCheckNotifications(update)
  t.is(notifications, 1)
})

test.serial('updateMany runs potentiallyChanged', async (t) => {
  await populate()

  const update = async () => {
    await db.items.updateMany({
      data: {
        nbr: 18,
      },
    })
  }

  const notifications = await runAndCheckNotifications(update)
  t.is(notifications, 1)
})

test.serial('upsert runs potentiallyChanged', async (t) => {
  await populate()

  const upsert = async () => {
    await db.items.upsert({
      create: {
        value: 'foo',
        nbr: 18,
      },
      update: {
        nbr: 18,
      },
      where: {
        value: 'foo',
      },
    })
  }

  const notifications = await runAndCheckNotifications(upsert)
  t.is(notifications, 1)
})

test.serial('delete runs potentiallyChanged', async (t) => {
  await populate()

  const del = async () => {
    await db.items.delete({
      where: {
        value: 'foo',
      },
    })
  }

  const notifications = await runAndCheckNotifications(del)
  t.is(notifications, 1)
})

test.serial('deleteMany runs potentiallyChanged', async (t) => {
  await populate()

  const del = async () => {
    await db.items.deleteMany({
      where: {
        nbr: 5,
      },
    })
  }

  const notifications = await runAndCheckNotifications(del)
  t.is(notifications, 1)
})
