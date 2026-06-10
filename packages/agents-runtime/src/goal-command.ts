import type { SlashCommandDefinition } from './composer-input'
import type { HandlerContext } from './types'

// Static registry entry so the composer offers /goal in autocomplete.
// Kept next to the parser so the definition and the grammar it
// describes can't drift apart.
export const GOAL_SLASH_COMMAND: SlashCommandDefinition = {
  name: `goal`,
  description: `Session goal: set <objective> [--tokens N|unlimited] | show | complete | clear`,
  arguments: [
    {
      name: `subcommand`,
      type: `string`,
      required: true,
      description: `set | show | complete | clear`,
    },
    {
      name: `args`,
      type: `string`,
      description: `objective text and flags, e.g. "ship X" --tokens 50k`,
    },
  ],
}

export type GoalCommand =
  | { kind: `set`; objective: string; tokenBudget?: number | null }
  | { kind: `clear` }
  | { kind: `show` }
  | { kind: `complete` }
  | { kind: `error`; message: string }

const GOAL_PREFIX = `/goal`
const UNLIMITED_TOKENS = new Set([`infinite`, `unlimited`, `none`])

export function isGoalCommandText(text: string): boolean {
  if (!text) return false
  const trimmed = text.trimStart()
  if (!trimmed.startsWith(GOAL_PREFIX)) return false
  const next = trimmed.charAt(GOAL_PREFIX.length)
  return next === `` || next === ` ` || next === `\t` || next === `\n`
}

export function parseGoalCommand(text: string): GoalCommand {
  const trimmed = text.trim()
  const afterPrefix = trimmed.slice(GOAL_PREFIX.length).trim()
  if (afterPrefix.length === 0) {
    return {
      kind: `error`,
      message: `Usage: /goal set <objective> [--tokens N|unlimited] | /goal clear | /goal show | /goal complete`,
    }
  }
  const tokens = tokenize(afterPrefix)
  const [subcommand, ...rest] = tokens
  switch (subcommand) {
    case `set`:
      return parseSet(rest)
    case `clear`:
      return { kind: `clear` }
    case `show`:
    case `status`:
      return { kind: `show` }
    case `complete`:
    case `done`:
      return { kind: `complete` }
    default:
      return {
        kind: `error`,
        message: `Unknown subcommand "${subcommand}". Use /goal set, /goal clear, /goal show, or /goal complete.`,
      }
  }
}

function parseSet(rest: Array<string>): GoalCommand {
  if (rest.length === 0) {
    return {
      kind: `error`,
      message: `Usage: /goal set <objective> [--tokens N|unlimited]`,
    }
  }
  // tokenBudget: undefined = use default; null = unlimited; number = explicit cap.
  let tokenBudget: number | null | undefined
  let unlimited = false
  const objectiveParts: Array<string> = []
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
    if (token === `--unlimited`) {
      unlimited = true
      continue
    }
    if (token === `--tokens` || token === `-t`) {
      const value = rest[i + 1]
      if (!value) {
        return {
          kind: `error`,
          message: `--tokens requires a value (number, "50k", "1m", or "unlimited")`,
        }
      }
      const parsed = parseTokens(value)
      if (parsed === `invalid`) {
        return {
          kind: `error`,
          message: `--tokens value "${value}" is not a valid count (use a positive integer, "50k", "1m", or "unlimited")`,
        }
      }
      tokenBudget = parsed
      i += 1
      continue
    }
    if (token.startsWith(`--tokens=`)) {
      const value = token.slice(`--tokens=`.length)
      const parsed = parseTokens(value)
      if (parsed === `invalid`) {
        return {
          kind: `error`,
          message: `--tokens value "${value}" is not a valid count`,
        }
      }
      tokenBudget = parsed
      continue
    }
    objectiveParts.push(token)
  }
  const objective = objectiveParts.join(` `).trim()
  if (!objective) {
    return {
      kind: `error`,
      message: `Objective is required: /goal set <objective> [--tokens N]`,
    }
  }
  if (unlimited) tokenBudget = null
  return tokenBudget === undefined
    ? { kind: `set`, objective }
    : { kind: `set`, objective, tokenBudget }
}

function parseTokens(raw: string): number | null | `invalid` {
  const value = raw.trim().toLowerCase()
  if (UNLIMITED_TOKENS.has(value)) return null
  const match = /^([0-9]+(?:\.[0-9]+)?)([km])?$/.exec(value)
  if (!match) return `invalid`
  const base = parseFloat(match[1]!)
  if (!Number.isFinite(base) || base <= 0) return `invalid`
  const suffix = match[2]
  const multiplier = suffix === `k` ? 1_000 : suffix === `m` ? 1_000_000 : 1
  return Math.round(base * multiplier)
}

function tokenize(input: string): Array<string> {
  const out: Array<string> = []
  let current = ``
  let quote: `"` | `'` | null = null
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i)
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === `"` || ch === `'`) {
      quote = ch
      continue
    }
    if (ch === ` ` || ch === `\t` || ch === `\n`) {
      if (current.length > 0) {
        out.push(current)
        current = ``
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) out.push(current)
  return out
}

export interface GoalDispatchResult {
  handled: boolean
  message?: string
}

function formatTokenCount(n: number): string {
  if (n < 1_000) return `${n}`
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

export function dispatchGoalCommand(
  ctx: Pick<
    HandlerContext,
    `setGoal` | `clearGoal` | `getGoal` | `markGoalComplete`
  >,
  command: GoalCommand
): GoalDispatchResult {
  switch (command.kind) {
    case `set`: {
      const input =
        command.tokenBudget === undefined
          ? { objective: command.objective }
          : { objective: command.objective, tokenBudget: command.tokenBudget }
      const entry = ctx.setGoal(input)
      const budgetLabel =
        entry.tokenBudget === null
          ? `unlimited`
          : `${formatTokenCount(entry.tokenBudget)} tokens`
      return {
        handled: true,
        message: `Goal set: ${entry.objective} (budget: ${budgetLabel})`,
      }
    }
    case `clear`: {
      const cleared = ctx.clearGoal()
      return {
        handled: true,
        message: cleared ? `Goal cleared` : `No goal to clear`,
      }
    }
    case `complete`: {
      const updated = ctx.markGoalComplete()
      return {
        handled: true,
        message: updated ? `Goal marked complete` : `No goal to mark complete`,
      }
    }
    case `show`: {
      const goal = ctx.getGoal()
      if (!goal) return { handled: true, message: `No goal set` }
      const budgetLabel =
        goal.tokenBudget === null
          ? `${formatTokenCount(goal.tokensUsed)} tokens used (unlimited)`
          : `${formatTokenCount(goal.tokensUsed)} / ${formatTokenCount(
              goal.tokenBudget
            )} tokens`
      return {
        handled: true,
        message: `Goal: ${goal.objective} (${budgetLabel}, ${goal.status})${
          goal.summary ? `\nSummary: ${goal.summary}` : ``
        }`,
      }
    }
    case `error`:
      return { handled: true, message: command.message }
  }
}
