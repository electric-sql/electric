import { readFileSync } from 'node:fs'
import type { CodingAgentKind } from '../../src/types'

const KEY_FILE = `/tmp/.electric-coding-agents-env`

export interface TestEnv {
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}

let cached: TestEnv | null = null

export function loadTestEnv(): TestEnv {
  if (cached) return cached
  let raw: string
  try {
    raw = readFileSync(KEY_FILE, `utf-8`)
  } catch {
    cached = {}
    return cached
  }
  const out: TestEnv = {}
  for (const line of raw.split(`\n`)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(`#`)) continue
    const eq = trimmed.indexOf(`=`)
    if (eq < 0) continue
    const k = trimmed.slice(0, eq) as keyof TestEnv
    const v = trimmed.slice(eq + 1)
    if (
      k === `ANTHROPIC_API_KEY` ||
      k === `ANTHROPIC_MODEL` ||
      k === `OPENAI_API_KEY` ||
      k === `OPENAI_MODEL`
    ) {
      out[k] = v
    }
  }
  if (!out.ANTHROPIC_MODEL) out.ANTHROPIC_MODEL = `claude-haiku-4-5-20251001`
  cached = out
  return cached
}

/**
 * Return the env map a sandbox should run with for a given kind, or
 * `null` if the required key is missing. Tests use the null return
 * to skip a kind's `describe.each` block cleanly.
 */
export function envForKind(
  env: TestEnv,
  kind: CodingAgentKind
): Record<string, string> | null {
  if (kind === `claude`) {
    if (!env.ANTHROPIC_API_KEY) return null
    return {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ...(env.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: env.ANTHROPIC_MODEL } : {}),
    }
  }
  if (kind === `codex`) {
    if (!env.OPENAI_API_KEY) return null
    return {
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ...(env.OPENAI_MODEL ? { OPENAI_MODEL: env.OPENAI_MODEL } : {}),
    }
  }
  return null
}

export interface AdapterTestProbe {
  prompt: string
  expectsResponseMatching: RegExp
  model?: string
}

export function probeForKind(
  env: TestEnv,
  kind: CodingAgentKind
): AdapterTestProbe {
  if (kind === `claude`) {
    return {
      prompt: `Reply with the single word: ok`,
      expectsResponseMatching: /ok/i,
      model: env.ANTHROPIC_MODEL,
    }
  }
  return {
    prompt: `Reply with the single word: ok`,
    expectsResponseMatching: /ok/i,
    model: env.OPENAI_MODEL,
  }
}
