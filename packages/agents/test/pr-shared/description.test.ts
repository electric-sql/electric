import { describe, expect, it } from 'vitest'
import { renderManagedSummary } from '../../src/agents/pr-shared/description'

describe(`renderManagedSummary`, () => {
  const original = `## Summary
human-authored

<!-- agent-managed:summary -->
old machine block
<!-- /agent-managed:summary -->

## Test plan
- [ ] verify`

  it(`replaces only the content between markers`, () => {
    const out = renderManagedSummary(original, `NEW MACHINE BLOCK`)
    expect(out).toContain(`human-authored`)
    expect(out).toContain(`NEW MACHINE BLOCK`)
    expect(out).not.toContain(`old machine block`)
    expect(out).toContain(`## Test plan`)
  })

  it(`appends a managed block when markers are absent`, () => {
    const out = renderManagedSummary(`## Summary\nx`, `AUTO`)
    expect(out).toContain(`<!-- agent-managed:summary -->`)
    expect(out).toContain(`AUTO`)
    expect(out).toContain(`<!-- /agent-managed:summary -->`)
  })

  it(`is idempotent — second render with same input is unchanged`, () => {
    const once = renderManagedSummary(original, `AUTO`)
    const twice = renderManagedSummary(once, `AUTO`)
    expect(twice).toBe(once)
  })
})
