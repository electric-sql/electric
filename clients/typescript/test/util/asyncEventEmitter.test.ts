import test from 'ava'
import { AsyncEventEmitter } from '../../src/util/asyncEventEmitter'

const delay = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

// Test that the AsyncEventEmitter correctly handles multiple events
test('test AsyncEventEmitter multiple events', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event1: () => void | Promise<void>
    event2: () => void | Promise<void>
  }>()

  const log: Array<number> = []

  const listener1 = () => {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        log.push(1)
        resolve()
      }, 20)
    })
  }

  const listener2 = () => {
    log.push(2)
  }

  emitter.on('event1', listener1)
  emitter.on('event2', listener2)

  emitter.enqueueEmit('event1')
  emitter.enqueueEmit('event2')

  // Give the emitter some time to process the queue
  await delay(100)
  t.deepEqual(log, [1, 2])
})

// Test that the AsyncEventEmitter calls one-time listeners only once
test('test AsyncEventEmitter once listeners', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event: () => void | Promise<void>
  }>()

  let ctr = 0

  const listener1 = () => {
    ctr++
  }

  const listener2 = () => {
    ctr++
  }

  const listener3 = () => {
    ctr++
  }

  emitter.once('event', listener1)
  emitter.once('event', listener2)
  emitter.enqueueEmit('event')

  emitter.once('event', listener3)
  emitter.enqueueEmit('event')

  await delay(100)
  t.is(ctr, 3)
})

// Test that listeners can be prepended
test('test AsyncEventEmitter prependListener', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event: () => void | Promise<void>
  }>()

  let log: Array<Number> = []

  const listener1 = () => {
    log.push(1)
  }

  const listener2 = () => {
    log.push(2)
  }

  emitter.on('event', listener1)
  emitter.prependListener('event', listener2)

  emitter.enqueueEmit('event')
  await delay(100)
  t.deepEqual(log, [2, 1])
})

// Test that the AsyncEventEmitter correctly removes listeners
test('test AsyncEventEmitter removeListener', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event: () => void | Promise<void>
  }>()

  let l1,
    l2,
    l3,
    l4 = false

  const listener1 = () => {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        l1 = true
        resolve()
      }, 10)
    })
  }

  const listener2 = () => {
    l2 = true
  }

  const listener3 = () => {
    l3 = true
  }

  const listener4 = () => {
    l4 = true
  }

  emitter.on('event', listener1)
  emitter.on('event', listener2)
  emitter.on('event', listener3)
  emitter.on('event', listener4)

  emitter.removeListener('event', listener2)
  emitter.off('event', listener4)

  emitter.enqueueEmit('event')

  await delay(100)
  t.assert(l1)
  t.assert(!l2)
  t.assert(l3)
  t.assert(!l4)
})

// Test that the AsyncEventEmitter correctly removes all listeners
test('test AsyncEventEmitter remove listeners', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event: () => void | Promise<void>
  }>()

  let l1,
    l2 = false

  const listener1 = () => {
    l1 = true
  }

  const listener2 = () => {
    l2 = true
  }

  emitter.on('event', listener1)
  t.is(emitter.listenerCount('event'), 1)

  emitter.on('event', listener2)
  t.is(emitter.listenerCount('event'), 2)

  emitter.removeAllListeners('event')
  t.is(emitter.listenerCount('event'), 0)

  emitter.enqueueEmit('event')

  await delay(100)
  t.assert(!l1)
  t.assert(!l2)
})

// Test that eventNames returns the correct event names
test('test AsyncEventEmitter eventNames', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event1: () => void | Promise<void>
    event2: () => void | Promise<void>
  }>()

  emitter.on('event1', () => {})
  emitter.on('event2', () => {})

  const eventNames = emitter.eventNames()
  t.deepEqual(eventNames, ['event1', 'event2'])

  emitter.removeAllListeners('event1')
  const eventNames2 = emitter.eventNames()
  t.deepEqual(eventNames2, ['event2'])

  emitter.removeAllListeners()
  const eventNames3 = emitter.eventNames()
  t.deepEqual(eventNames3, [])
})

// Test that the AsyncEventEmitter correctly handles errors
test('test AsyncEventEmitter handles errors correctly', async (t) => {
  const emitter = new AsyncEventEmitter<{
    event: () => void | Promise<void>
    error: (err: Error) => void | Promise<void>
  }>()

  const err = new Error('test error')

  // If an error event is emitted and there are no listeners, the error is thrown
  try {
    emitter.enqueueEmit('error', err)
    t.fail()
  } catch (err: any) {
    t.is(err.message, 'test error')
  }

  // If an error event is emitted and there are listeners, the listeners are called
  let called = false
  emitter.on('error', (err) => {
    called = true
    t.is(err.message, 'test error')
  })

  emitter.enqueueEmit('error', err)

  await delay(100)
  t.is(called, true)
})
