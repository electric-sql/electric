import type { McpToolError } from '../types'

export const DEFAULT_TIMEOUT_MS = 120_000
export const MAX_TIMEOUT_MS = 600_000

export function normalizeTimeoutMs(ms: number | undefined): number {
  if (typeof ms !== `number` || !Number.isFinite(ms)) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.min(Math.max(Math.trunc(ms), 1), MAX_TIMEOUT_MS)
}

class TimeoutError extends Error implements McpToolError {
  kind = `timeout` as const
  constructor(ms: number) {
    super(`MCP tool call timed out after ${ms}ms`)
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeoutMs = normalizeTimeoutMs(ms)
  let timer: NodeJS.Timeout | undefined
  const guard = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs)
  })
  return Promise.race([p, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}
