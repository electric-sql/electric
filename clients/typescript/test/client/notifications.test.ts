import test from 'ava'
import Database from 'better-sqlite3'
import { MockRegistry } from '../../src/satellite/mock'
import { EventNotifier } from '../../src/notifiers'
import { mockElectricClient } from '../satellite/common'
import { EVENT_NAMES } from '../../src/notifiers/event'

const conn = new Database(':memory:')

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
    t.assert(
      !Object.prototype.hasOwnProperty.call(registry.satellites, conn.name)
    )
  }
)
