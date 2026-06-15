import { describe, expect, it, vi } from 'vitest'
import { singleFlight } from './singleFlight'

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

describe(`singleFlight`, () => {
  it(`runs the action once and ignores re-invocation while it is in flight`, async () => {
    const gate = deferred()
    const fn = vi.fn(() => gate.promise)
    const flight = singleFlight(fn)

    flight.invoke()
    flight.invoke()
    flight.invoke()

    // The repeated taps that motivated this guard issue no extra calls.
    expect(fn).toHaveBeenCalledTimes(1)
    expect(flight.isPending()).toBe(true)

    gate.resolve()
    await tick()

    expect(flight.isPending()).toBe(false)
    flight.invoke()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it(`reports pending transitions through onPendingChange`, async () => {
    const gate = deferred()
    const changes: Array<boolean> = []
    const flight = singleFlight(
      () => gate.promise,
      (pending) => changes.push(pending)
    )

    flight.invoke()
    expect(changes).toEqual([true])

    gate.resolve()
    await tick()
    expect(changes).toEqual([true, false])
  })

  it(`clears pending after the action rejects`, async () => {
    const gate = deferred()
    const fn = vi.fn(() => gate.promise)
    const flight = singleFlight(fn)

    flight.invoke()
    gate.reject(new Error(`fork failed`))
    await tick()

    expect(flight.isPending()).toBe(false)
    flight.invoke()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it(`clears pending when the action throws synchronously`, () => {
    const flight = singleFlight(() => {
      throw new Error(`boom`)
    })

    expect(() => flight.invoke()).not.toThrow()
    expect(flight.isPending()).toBe(false)
  })
})
