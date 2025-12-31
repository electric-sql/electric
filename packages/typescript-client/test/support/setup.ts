import { vi } from 'vitest'

// Suppress the HTTP URL warning in tests to avoid log spam.
// The warning is tested explicitly in stream.test.ts.
// Match on prefix to avoid fragile full-message matching.
const originalWarn = console.warn
vi.spyOn(console, `warn`).mockImplementation((...args: unknown[]) => {
  const message = args[0]
  if (typeof message === `string` && message.startsWith(`[Electric]`)) {
    return // suppress Electric warnings in tests
  }
  originalWarn.apply(console, args)
})
