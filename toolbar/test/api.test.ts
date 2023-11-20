import { expect, test } from 'vitest'

import browserEnv from '@ikscodes/browser-env'
browserEnv()

import { DatabaseAdapter } from 'electric-sql/react-native'
import { MockRegistry } from 'electric-sql/satellite/mock'
import { Migrator } from 'electric-sql/migrators'
import { ElectricConfig } from 'electric-sql/config'
import { SocketFactory } from 'electric-sql/sockets'
import { Notifier } from 'electric-sql/notifiers'
import { clientApi } from '../src'

test('identity', async () => {
  const adapter = {} as DatabaseAdapter
  const migrator = {} as Migrator
  const notifier = {} as Notifier
  const socketFactory = {} as SocketFactory
  const config: ElectricConfig = {
    auth: {
      token: 'test-token ',
    },
  }

  const mockRegistry = new MockRegistry()

  const s1 = await mockRegistry.startProcess(
    'a.db',
    adapter,
    migrator,
    notifier,
    socketFactory,
    config,
  )

  const s2 = await mockRegistry.startProcess(
    'b.db',
    adapter,
    migrator,
    notifier,
    socketFactory,
    config,
  )
  const api = clientApi(mockRegistry)
  const names = api.getSatelliteNames()
  expect(names).toStrictEqual(['a.db', 'b.db'])
})
