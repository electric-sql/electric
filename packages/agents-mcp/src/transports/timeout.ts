import type { McpToolError } from '../types'

export const DEFAULT_TIMEOUT_MS = 30_000

class TimeoutError extends Error implements McpToolError {
  kind = `timeout` as const
  constructor(ms: number) {
    super(`MCP tool call timed out after ${ms}ms`)
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const guard = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([p, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}
