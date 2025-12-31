import { vi } from 'vitest'

// Filter out the HTTP URL warning from console.warn to avoid test log spam
// The warning is tested explicitly in stream.test.ts
const originalWarn = console.warn
vi.spyOn(console, `warn`).mockImplementation((...args: unknown[]) => {
  const message = args[0]
  if (
    typeof message === `string` &&
    message.includes(`[Electric] Using HTTP (not HTTPS)`)
  ) {
    return // suppress
  }
  originalWarn.apply(console, args)
})
