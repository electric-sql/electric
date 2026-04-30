import { readFileSync } from 'node:fs'

const KEY_FILE = `/tmp/.electric-coding-agents-env`

export interface TestEnv {
  ANTHROPIC_API_KEY: string
  ANTHROPIC_MODEL: string
}

let cached: TestEnv | null = null

export function loadTestEnv(): TestEnv {
  if (cached) return cached
  let raw: string
  try {
    raw = readFileSync(KEY_FILE, `utf-8`)
  } catch {
    throw new Error(
      `Integration tests require ${KEY_FILE} (mode 600) with ANTHROPIC_API_KEY=… and ANTHROPIC_MODEL=…`
    )
  }
  const out: Partial<TestEnv> = {}
  for (const line of raw.split(`\n`)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(`#`)) continue
    const eq = trimmed.indexOf(`=`)
    if (eq < 0) continue
    const k = trimmed.slice(0, eq)
    const v = trimmed.slice(eq + 1)
    if (k === `ANTHROPIC_API_KEY` || k === `ANTHROPIC_MODEL`) out[k] = v
  }
  if (!out.ANTHROPIC_API_KEY) {
    throw new Error(`${KEY_FILE} must contain ANTHROPIC_API_KEY=…`)
  }
  cached = {
    ANTHROPIC_API_KEY: out.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: out.ANTHROPIC_MODEL ?? `claude-haiku-4-5-20251001`,
  }
  return cached
}
