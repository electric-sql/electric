import { describe, it, expect, vi } from 'vitest'
import { isPromise, asyncOrCall, asyncOrIterable } from '../src/async-or'

describe(`isPromise`, () => {
  it(`should return true for a Promise object`, () => {
    const promise = Promise.resolve(42)
    expect(isPromise(promise)).toBe(true)
  })

  it(`should return false for non-Promise values`, () => {
    expect(isPromise(42)).toBe(false)
    expect(isPromise({})).toBe(false)
    expect(isPromise(`not a promise`)).toBe(false)
    expect(isPromise(null)).toBe(false)
    expect(isPromise(undefined)).toBe(false)
  })

  it(`should return false for an object without a "then" function`, () => {
    expect(isPromise({ then: `not a function` })).toBe(false)
  })
})

describe(`asyncOrCall`, () => {
  it(`should call the callback directly for non-Promise values`, () => {
    const callback = vi.fn()
    const value = 42
    asyncOrCall(value, callback)
    expect(callback).toHaveBeenCalledWith(value)
  })

  it(`should return a resolved Promise value and call the callback for Promises`, async () => {
    const callback = vi.fn()
    const value = 42
    const promise = Promise.resolve(value)
    await asyncOrCall(promise, callback)
    expect(callback).toHaveBeenCalledWith(value)
  })

  it(`should call the onError callback on synchronous errors`, () => {
    const callback = vi.fn(() => {
      throw new Error(`Test Error`)
    })
    const onError = vi.fn()
    asyncOrCall(42, callback, onError)
    expect(onError).toHaveBeenCalledWith(new Error(`Test Error`))
  })

  it(`should call the onError callback on Promise rejection`, async () => {
    const callback = vi.fn()
    const onError = vi.fn()
    const promise = Promise.reject(new Error(`Test Error`))
    await asyncOrCall(promise, callback, onError)
    expect(onError).toHaveBeenCalledWith(new Error(`Test Error`))
  })

  it(`should throw an error if no onError handler is provided and an error occurs`, () => {
    const callback = vi.fn(() => {
      throw new Error(`Test Error`)
    })
    expect(() => asyncOrCall(42, callback)).toThrow(`Test Error`)
  })
})

describe(`asyncOrIterable`, () => {
  it(`should iterate over a synchronous iterable and call the callback for each item`, () => {
    const callback = vi.fn()
    const iterable = [1, 2, 3]
    asyncOrIterable(iterable, callback)
    expect(callback).toHaveBeenCalledTimes(3)
    expect(callback).toHaveBeenCalledWith(1)
    expect(callback).toHaveBeenCalledWith(2)
    expect(callback).toHaveBeenCalledWith(3)
  })

  it(`should iterate over an asynchronous iterable and call the callback for each item`, async () => {
    const callback = vi.fn()
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield 1
        yield 2
        yield 3
      },
    }

    await asyncOrIterable(asyncIterable, callback)
    expect(callback).toHaveBeenCalledTimes(3)
    expect(callback).toHaveBeenCalledWith(1)
    expect(callback).toHaveBeenCalledWith(2)
    expect(callback).toHaveBeenCalledWith(3)
  })
})
