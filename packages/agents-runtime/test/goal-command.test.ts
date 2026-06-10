import { describe, expect, it } from 'vitest'
import {
  dispatchGoalCommand,
  isGoalCommandText,
  parseGoalCommand,
} from '../src/goal-command'
import type { GoalEntry, GoalInput, HandlerContext } from '../src/index'

describe(`isGoalCommandText`, () => {
  it(`matches /goal with a trailing space or end-of-line`, () => {
    expect(isGoalCommandText(`/goal`)).toBe(true)
    expect(isGoalCommandText(`/goal `)).toBe(true)
    expect(isGoalCommandText(`/goal set X`)).toBe(true)
    expect(isGoalCommandText(`  /goal show`)).toBe(true)
  })

  it(`does not match unrelated text`, () => {
    expect(isGoalCommandText(`/goalkeeper`)).toBe(false)
    expect(isGoalCommandText(`hello /goal`)).toBe(false)
    expect(isGoalCommandText(``)).toBe(false)
    expect(isGoalCommandText(`/help`)).toBe(false)
  })
})

describe(`parseGoalCommand`, () => {
  it(`parses /goal set with a quoted objective`, () => {
    expect(parseGoalCommand(`/goal set "ship feature X"`)).toEqual({
      kind: `set`,
      objective: `ship feature X`,
    })
  })

  it(`parses /goal set with --tokens (number)`, () => {
    expect(parseGoalCommand(`/goal set "ship X" --tokens 50000`)).toEqual({
      kind: `set`,
      objective: `ship X`,
      tokenBudget: 50000,
    })
  })

  it(`parses --tokens with k/m suffixes`, () => {
    expect(parseGoalCommand(`/goal set foo --tokens 50k`)).toEqual({
      kind: `set`,
      objective: `foo`,
      tokenBudget: 50_000,
    })
    expect(parseGoalCommand(`/goal set foo --tokens 1.2m`)).toEqual({
      kind: `set`,
      objective: `foo`,
      tokenBudget: 1_200_000,
    })
  })

  it(`accepts --tokens=N inline form`, () => {
    expect(parseGoalCommand(`/goal set foo --tokens=20k`)).toEqual({
      kind: `set`,
      objective: `foo`,
      tokenBudget: 20_000,
    })
  })

  it(`parses --tokens unlimited as null`, () => {
    expect(parseGoalCommand(`/goal set foo --tokens unlimited`)).toEqual({
      kind: `set`,
      objective: `foo`,
      tokenBudget: null,
    })
    expect(parseGoalCommand(`/goal set foo --tokens infinite`)).toEqual({
      kind: `set`,
      objective: `foo`,
      tokenBudget: null,
    })
  })

  it(`accepts --unlimited as a standalone flag`, () => {
    expect(parseGoalCommand(`/goal set foo --unlimited`)).toEqual({
      kind: `set`,
      objective: `foo`,
      tokenBudget: null,
    })
  })

  it(`leaves tokenBudget undefined when not specified (runtime defaults it)`, () => {
    const parsed = parseGoalCommand(`/goal set "ship X"`)
    expect(parsed.kind).toBe(`set`)
    if (parsed.kind === `set`) {
      expect(parsed.tokenBudget).toBeUndefined()
    }
  })

  it(`returns clear / show / complete`, () => {
    expect(parseGoalCommand(`/goal clear`)).toEqual({ kind: `clear` })
    expect(parseGoalCommand(`/goal show`)).toEqual({ kind: `show` })
    expect(parseGoalCommand(`/goal status`)).toEqual({ kind: `show` })
    expect(parseGoalCommand(`/goal complete`)).toEqual({ kind: `complete` })
    expect(parseGoalCommand(`/goal done`)).toEqual({ kind: `complete` })
  })

  it(`reports error on bare /goal`, () => {
    expect(parseGoalCommand(`/goal`).kind).toBe(`error`)
  })

  it(`reports error on unknown subcommand`, () => {
    expect(parseGoalCommand(`/goal foo bar`).kind).toBe(`error`)
  })

  it(`reports error on /goal set with no objective`, () => {
    expect(parseGoalCommand(`/goal set`).kind).toBe(`error`)
    expect(parseGoalCommand(`/goal set --tokens 50k`).kind).toBe(`error`)
  })

  it(`reports error on invalid token budget`, () => {
    expect(parseGoalCommand(`/goal set foo --tokens`).kind).toBe(`error`)
    expect(parseGoalCommand(`/goal set foo --tokens abc`).kind).toBe(`error`)
    expect(parseGoalCommand(`/goal set foo --tokens 0`).kind).toBe(`error`)
    expect(parseGoalCommand(`/goal set foo --tokens -1`).kind).toBe(`error`)
  })
})

describe(`dispatchGoalCommand`, () => {
  function makeStubCtx(initialGoal?: GoalEntry) {
    let goal: GoalEntry | undefined = initialGoal
    const ctx = {
      setGoal: (input: GoalInput) => {
        const tokenBudget =
          input.tokenBudget === undefined ? 50_000 : input.tokenBudget
        const next: GoalEntry = {
          id: `goal`,
          objective: input.objective,
          status: input.status ?? `active`,
          tokenBudget,
          tokensUsed: 0,
          createdAt: 1,
          updatedAt: 1,
        }
        goal = next
        return next
      },
      clearGoal: () => {
        if (!goal) return false
        goal = undefined
        return true
      },
      getGoal: () => goal,
      markGoalComplete: () => {
        if (!goal) return undefined
        const next: GoalEntry = { ...goal, status: `complete`, updatedAt: 2 }
        goal = next
        return next
      },
    } satisfies Pick<
      HandlerContext,
      `setGoal` | `clearGoal` | `getGoal` | `markGoalComplete`
    >
    return { ctx, getGoal: () => goal }
  }

  it(`dispatches set and stores the goal with the requested budget`, () => {
    const stub = makeStubCtx()
    const result = dispatchGoalCommand(stub.ctx, {
      kind: `set`,
      objective: `ship X`,
      tokenBudget: 20_000,
    })
    expect(result.handled).toBe(true)
    expect(stub.getGoal()?.objective).toBe(`ship X`)
    expect(stub.getGoal()?.tokenBudget).toBe(20_000)
  })

  it(`dispatches set with unlimited budget`, () => {
    const stub = makeStubCtx()
    dispatchGoalCommand(stub.ctx, {
      kind: `set`,
      objective: `explore`,
      tokenBudget: null,
    })
    expect(stub.getGoal()?.tokenBudget).toBeNull()
  })

  it(`dispatches clear and removes the goal`, () => {
    const stub = makeStubCtx({
      id: `goal`,
      objective: `existing`,
      status: `active`,
      tokenBudget: 10_000,
      tokensUsed: 0,
      createdAt: 0,
      updatedAt: 0,
    })
    const result = dispatchGoalCommand(stub.ctx, { kind: `clear` })
    expect(result.handled).toBe(true)
    expect(stub.getGoal()).toBeUndefined()
  })

  it(`dispatches complete and flips status`, () => {
    const stub = makeStubCtx({
      id: `goal`,
      objective: `existing`,
      status: `active`,
      tokenBudget: 10_000,
      tokensUsed: 2_000,
      createdAt: 0,
      updatedAt: 0,
    })
    dispatchGoalCommand(stub.ctx, { kind: `complete` })
    expect(stub.getGoal()?.status).toBe(`complete`)
  })

  it(`reports "no goal" on show when none is set`, () => {
    const stub = makeStubCtx()
    const result = dispatchGoalCommand(stub.ctx, { kind: `show` })
    expect(result.message).toMatch(/no goal/i)
  })

  it(`reports current goal on show with formatted tokens`, () => {
    const stub = makeStubCtx({
      id: `goal`,
      objective: `ship X`,
      status: `active`,
      tokenBudget: 50_000,
      tokensUsed: 12_345,
      createdAt: 0,
      updatedAt: 0,
    })
    const result = dispatchGoalCommand(stub.ctx, { kind: `show` })
    expect(result.message).toMatch(/ship X/)
    expect(result.message).toMatch(/12k.*50k/)
  })

  it(`labels show output as unlimited when budget is null`, () => {
    const stub = makeStubCtx({
      id: `goal`,
      objective: `explore`,
      status: `active`,
      tokenBudget: null,
      tokensUsed: 7,
      createdAt: 0,
      updatedAt: 0,
    })
    const result = dispatchGoalCommand(stub.ctx, { kind: `show` })
    expect(result.message).toMatch(/unlimited/)
  })
})
