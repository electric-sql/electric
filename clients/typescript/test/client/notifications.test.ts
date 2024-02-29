import test from 'ava'
import Database from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3'
import { schema } from './generated'
import { MockRegistry } from '../../src/satellite/mock'
import { EventNotifier } from '../../src/notifiers'
import { mockElectricClient } from '../satellite/common'
import { EVENT_NAMES } from '../../src/notifiers/event'

const conn = new Database(':memory:')
const config = {}

const { notifier, adapter, db } = await electrify(conn, schema, config, {
  registry: new MockRegistry(),
})
await db.Items.sync() // sync the Items table

async function runAndCheckNotifications(f: () => Promise<void>) {
  let notifications = 0
  const unsubscribe = notifier.subscribeToPotentialDataChanges(
    (_notification) => {
      notifications = notifications + 1
    }
  )

  await f()

  unsubscribe()
  return notifications
}

// Clean the DB environment
async function cleanDB() {
  await adapter.run({ sql: 'DROP TABLE IF EXISTS Items' })
  await adapter.run({
    sql: 'CREATE TABLE IF NOT EXISTS Items (value TEXT PRIMARY KEY NOT NULL, nbr INTEGER) WITHOUT ROWID;',
  })
}

// Clean the DB before each test
test.serial.beforeEach(async (_t) => {
  await cleanDB()
})

// Clean the DB after all tests
test.serial.after(async (_t) => {
  await adapter.run({ sql: 'DROP TABLE IF EXISTS Items' })
})

test.serial('create runs potentiallyChanged', async (t) => {
  const insert = async () => {
    await db.Items.create({
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
    await db.Items.createMany({
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
  await db.Items.createMany({
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
    await db.Items.findUnique({
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
    await db.Items.findFirst({})
  }

  const notifications = await runAndCheckNotifications(find)
  t.is(notifications, 0)
})

test.serial('findMany does not run potentiallyChanged', async (t) => {
  const find = async () => {
    await db.Items.findMany({})
  }

  const notifications = await runAndCheckNotifications(find)
  t.is(notifications, 0)
})

test.serial('update runs potentiallyChanged', async (t) => {
  await populate()

  const update = async () => {
    await db.Items.update({
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
    await db.Items.updateMany({
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
    await db.Items.upsert({
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
    await db.Items.delete({
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
    await db.Items.deleteMany({
      where: {
        nbr: 5,
      },
    })
  }

  const notifications = await runAndCheckNotifications(del)
  t.is(notifications, 1)
})

test.serial(
  'electrification registers process and unregisters on close thereby releasing resources',
  async (t) => {
    const registry = new MockRegistry()
    const electric = await mockElectricClient(conn, registry)

    // Check that satellite is registered
    const satellite = electric.satellite
    t.is(registry.satellites[conn.name], satellite)

    // Check that the listeners are registered
    const notifier = electric.notifier as EventNotifier
    const events = [
      EVENT_NAMES.authChange,
      EVENT_NAMES.potentialDataChange,
      EVENT_NAMES.connectivityStateChange,
    ]
    events.forEach((eventName) => {
      t.assert(notifier.events.listenerCount(eventName) > 0)
    })

    // Close the Electric client
    await electric.close()

    // Check that the listeners are unregistered
    events.forEach((eventName) => {
      t.is(notifier.events.listenerCount(eventName), 0)
    })

    // Check that the Satellite process is unregistered
    t.assert(!registry.satellites.hasOwnProperty(conn.name))
  }
)
