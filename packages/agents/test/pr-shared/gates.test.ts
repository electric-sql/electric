import { describe, expect, it } from 'vitest'
import { evalGates, checkTemplate } from '../../src/agents/pr-shared/gates'

const baseDescription = `## Summary

Adds X.

## Linked issues

closes #1

## Test plan

- [ ] verify`

describe(`checkTemplate`, () => {
  it(`returns true when all three required headings have non-empty content`, () => {
    expect(checkTemplate(baseDescription)).toBe(true)
  })
  it(`returns false when a heading is missing`, () => {
    expect(
      checkTemplate(baseDescription.replace(`## Test plan`, `## Other`))
    ).toBe(false)
  })
  it(`returns false when a heading has empty content`, () => {
    expect(
      checkTemplate(
        `## Summary\n\n## Linked issues\n\nclose #1\n\n## Test plan\n\n- [ ] x`
      )
    ).toBe(false)
  })
})

describe(`evalGates`, () => {
  const ok = {
    pr_meta: { description: baseDescription, mergeable: true },
    checks: [{ conclusion: `success` }, { conclusion: `skipped` }],
    review_threads: [
      { severity: `must-fix`, status: `addressed` },
      { severity: `nit`, status: `open` },
    ],
    doc_plan: [{ status: `done` }],
  } as const

  it(`returns ready_to_merge when every gate is true`, () => {
    const g = evalGates(ok as any)
    expect(g.template_ok).toBe(true)
    expect(g.ci_green).toBe(true)
    expect(g.no_conflicts).toBe(true)
    expect(g.threads_resolved).toBe(true)
    expect(g.docs_ok).toBe(true)
    expect(g.ready_to_merge).toBe(true)
  })

  it(`blocks ready when any check failed`, () => {
    const g = evalGates({ ...ok, checks: [{ conclusion: `failure` }] } as any)
    expect(g.ci_green).toBe(false)
    expect(g.ready_to_merge).toBe(false)
  })

  it(`blocks ready when an open must-fix thread exists`, () => {
    const g = evalGates({
      ...ok,
      review_threads: [{ severity: `must-fix`, status: `open` }],
    } as any)
    expect(g.threads_resolved).toBe(false)
    expect(g.ready_to_merge).toBe(false)
  })

  it(`docs_ok is true when doc_plan is empty`, () => {
    expect(evalGates({ ...ok, doc_plan: [] } as any).docs_ok).toBe(true)
  })

  it(`no_conflicts is false when mergeable is false`, () => {
    expect(
      evalGates({ ...ok, pr_meta: { ...ok.pr_meta, mergeable: false } } as any)
        .no_conflicts
    ).toBe(false)
  })

  it(`treats mergeable === null as not-yet-known (false)`, () => {
    expect(
      evalGates({ ...ok, pr_meta: { ...ok.pr_meta, mergeable: null } } as any)
        .no_conflicts
    ).toBe(false)
  })
})
