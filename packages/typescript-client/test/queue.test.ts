import { describe, it, expect, vi } from 'vitest'
import { AsyncProcessingQueue, MessageProcessor } from '../src/queue'

describe(`AsyncProcessingQueue`, () => {
  it(`should process synchronous callbacks in order`, () => {
    let last = 0
    const cb1 = vi.fn().mockImplementationOnce(() => (last = 1))
    const cb2 = vi.fn().mockImplementationOnce(() => (last = 2))
    const processor = new AsyncProcessingQueue()

    processor.process(cb1)
    processor.process(cb2)

    expect(cb1).toHaveBeenCalledOnce()
    expect(cb2).toHaveBeenCalledOnce()
    expect(last).toBe(2)
  })

  it(`should process asynchronous callbacks in order`, async () => {
    let last = 0
    const cb1 = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((res) => setTimeout(() => res((last = 1)), 10))
      )
    const cb2 = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((res) => setTimeout(() => res((last = 2)), 5))
      )
    const processor = new AsyncProcessingQueue()

    processor.process(cb1)
    processor.process(cb2)

    expect(cb1).toHaveBeenCalledOnce()
    expect(cb2).not.toHaveBeenCalled()

    await processor.waitForProcessing()
    expect(cb1).toHaveBeenCalledOnce()
    expect(cb2).toHaveBeenCalledOnce()
    expect(last).toBe(2)
  })

  it(`should process both async and sync callbacks in order`, async () => {
    let last = 0
    const cb1 = vi.fn().mockImplementation(() => (last = 1))
    const cb2 = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((res) => setTimeout(() => res((last = 2)), 10))
      )
    const cb3 = vi.fn().mockImplementation(() => (last = 3))
    const cb4 = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((res) => setTimeout(() => res((last = 4)), 5))
      )

    const processor = new AsyncProcessingQueue()

    processor.process(cb1)
    processor.process(cb2)
    processor.process(cb3)
    processor.process(cb4)

    expect(cb1).toHaveBeenCalledOnce()
    expect(cb2).toHaveBeenCalledOnce()
    expect(cb3).not.toHaveBeenCalled()
    expect(cb4).not.toHaveBeenCalled()
    expect(last).toBe(1) // only sync has been called so far

    await processor.waitForProcessing()

    expect(cb3).toHaveBeenCalledOnce()
    expect(cb4).toHaveBeenCalledOnce()
    expect(last).toBe(4)
  })

  it(`should complete processing when waitForProcessing is called multiple times`, async () => {
    const cb = vi.fn(() => Promise.resolve())
    const processor = new AsyncProcessingQueue()

    processor.process(cb)
    await processor.waitForProcessing() // First call

    processor.process(cb)
    await processor.waitForProcessing() // Second call

    expect(cb).toHaveBeenCalledTimes(2)
  })

  it(`should not resolve waitForProcessing if calls are added`, async () => {
    const resolvers: Array<() => void> = []
    let finishedProcessing = false

    const cb = vi.fn(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    )
    const processor = new AsyncProcessingQueue()

    processor.process(cb)
    processor.waitForProcessing().then(() => {
      finishedProcessing = true
    })

    processor.process(cb)
    await new Promise((res) => setTimeout(res))
    expect(finishedProcessing).toBe(false)

    resolvers[0]!()
    await new Promise((res) => setTimeout(res))
    expect(finishedProcessing).toBe(false)

    resolvers[1]!()
    await new Promise((res) => setTimeout(res))
    expect(finishedProcessing).toBe(true)
    expect(cb).toHaveBeenCalledTimes(2)
  })
})

describe(`MessageProcessor`, () => {
  it(`should queue up both async and sync processing in order`, async () => {
    const callback = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => Promise.resolve())

    const processor = new MessageProcessor(callback)
    const messages1 = [`msg1`]
    const messages2 = [`msg2`]
    const messages3 = [`msg3`]
    const messages4 = [`msg4`]

    processor.process(messages1)
    processor.process(messages2)
    processor.process(messages3)
    processor.process(messages4)

    await processor.waitForProcessing()

    expect(callback).toHaveBeenCalledTimes(4)
    expect(callback).toHaveBeenNthCalledWith(1, messages1)
    expect(callback).toHaveBeenNthCalledWith(2, messages2)
    expect(callback).toHaveBeenNthCalledWith(3, messages3)
    expect(callback).toHaveBeenNthCalledWith(4, messages4)
  })

  it(`should process messages sequentially with slow asynchronous callbacks`, async () => {
    const callback = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(() => resolve(), 50))
    )
    const processor = new MessageProcessor(callback)
    const messages1 = [`msg1`]
    const messages2 = [`msg2`]
    const messages3 = [`msg3`]

    processor.process(messages1)
    processor.process(messages2)
    processor.process(messages3)

    await processor.waitForProcessing()

    expect(callback).toHaveBeenNthCalledWith(1, messages1)
    expect(callback).toHaveBeenNthCalledWith(2, messages2)
    expect(callback).toHaveBeenNthCalledWith(3, messages3)
  })
})
