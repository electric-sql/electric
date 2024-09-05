import { describe, it, expect, vi } from 'vitest'
import { MessageProcessor } from '../src/queue'

describe(`MessageProcessor`, () => {
  it(`should call the callback function with the given messages synchronously`, () => {
    const callback = vi.fn()
    const processor = new MessageProcessor(callback)
    const messages1 = [`msg1`, `msg2`]
    const messages2 = [`msg3`, `msg4`]

    processor.process(messages1)
    processor.process(messages2)

    expect(callback).toHaveBeenNthCalledWith(1, messages1)
    expect(callback).toHaveBeenNthCalledWith(2, messages2)
  })

  it(`should queue up async processing and process messages sequentially`, async () => {
    const callback = vi.fn(() => Promise.resolve())
    const processor = new MessageProcessor(callback)
    const messages1 = [`msg1`, `msg2`]
    const messages2 = [`msg3`, `msg4`]

    processor.process(messages1)
    processor.process(messages2)

    expect(callback).toHaveBeenCalledWith(messages1)
    expect(callback).not.toHaveBeenCalledWith(messages2)

    await processor.waitForProcessing()

    expect(callback).toHaveBeenNthCalledWith(2, messages2)
  })

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

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(1, messages1)
    expect(callback).toHaveBeenNthCalledWith(2, messages2)

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

  it(`should complete processing when waitForProcessing is called multiple times`, async () => {
    const callback = vi.fn(() => Promise.resolve())
    const processor = new MessageProcessor(callback)
    const messages = [`msg1`]

    processor.process(messages)
    await processor.waitForProcessing() // First call

    processor.process(messages)
    await processor.waitForProcessing() // Second call

    expect(callback).toHaveBeenCalledTimes(2)
  })

  it(`should not resolve waitForProcessing if calls are added`, async () => {
    const resolvers: Array<() => void> = []
    let finishedProcessing = false

    const callback = vi.fn(
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    )
    const processor = new MessageProcessor(callback)
    const messages = [`msg1`]

    processor.process(messages)
    processor.waitForProcessing().then(() => {
      finishedProcessing = true
    })

    processor.process(messages)
    resolvers[0]!()
    await new Promise((res) => setTimeout(res))
    expect(finishedProcessing).toBe(false)

    resolvers[1]!()
    await new Promise((res) => setTimeout(res))
    expect(finishedProcessing).toBe(true)
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
