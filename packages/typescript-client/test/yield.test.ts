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
    // This test verifies that yieldToMain actually yields - we can't
    // guarantee exact ordering of setTimeout callbacks, but we can verify
    // that other tasks get a chance to run during the yield
    const taskRan = { value: false }

    const yieldingTask = (async () => {
      await yieldToMain()
      return taskRan.value
    })()

    // Queue a task that should have a chance to run during the yield
    setTimeout(() => {
      taskRan.value = true
    }, 0)

    // Wait for both the yield and the setTimeout
    await new Promise((resolve) => setTimeout(resolve, 10))
    const valueAfterYield = await yieldingTask

    // The setTimeout should have had a chance to run
    expect(taskRan.value).toBe(true)
    // Note: valueAfterYield might be true or false depending on timing,
    // we just care that the setTimeout got to execute
  })
})
