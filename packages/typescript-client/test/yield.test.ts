import { describe, expect, it, vi, afterEach } from 'vitest'
import { yieldToMain, DEFAULT_YIELD_EVERY } from '../src/yield'

describe(`yieldToMain`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(`should export DEFAULT_YIELD_EVERY constant`, () => {
    expect(DEFAULT_YIELD_EVERY).toBe(1000)
  })

  it(`should return a promise that resolves`, async () => {
    const result = yieldToMain()
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toBeUndefined()
  })

  it(`should use scheduler.yield when available`, async () => {
    const mockYield = vi.fn().mockResolvedValue(undefined)
    type GlobalWithScheduler = { scheduler?: { yield?: () => Promise<void> } }
    const g = globalThis as unknown as GlobalWithScheduler
    const originalScheduler = g.scheduler

    // Mock scheduler.yield
    g.scheduler = { yield: mockYield }

    await yieldToMain()
    expect(mockYield).toHaveBeenCalled()

    // Restore
    if (originalScheduler) {
      g.scheduler = originalScheduler
    } else {
      delete g.scheduler
    }
  })

  it(`should fall back to setTimeout when scheduler.yield is not available`, async () => {
    type GlobalWithScheduler = { scheduler?: { yield?: () => Promise<void> } }
    const g = globalThis as unknown as GlobalWithScheduler
    const originalScheduler = g.scheduler

    // Remove scheduler
    delete g.scheduler

    // Track that setTimeout is used
    const setTimeoutSpy = vi.spyOn(globalThis, `setTimeout`)

    await yieldToMain()

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0)

    // Restore
    if (originalScheduler) {
      g.scheduler = originalScheduler
    }
    setTimeoutSpy.mockRestore()
  })

  it(`should yield control to allow other tasks to run`, async () => {
    const executionOrder: number[] = []

    // Start a promise that uses yieldToMain
    const yieldingTask = (async () => {
      executionOrder.push(1)
      await yieldToMain()
      executionOrder.push(3)
    })()

    // Queue a microtask/macrotask that should run during the yield
    setTimeout(() => executionOrder.push(2), 0)

    await yieldingTask
    // Wait for setTimeout to complete
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The order should be 1, 2, 3 because yieldToMain allows the setTimeout to run
    expect(executionOrder).toEqual([1, 2, 3])
  })
})
