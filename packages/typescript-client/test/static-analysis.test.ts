import { describe, expect, it } from 'vitest'
import { analyzeTypeScriptClient } from '../bin/lib/shape-stream-static-analysis.mjs'

describe(`shape-stream static analysis`, () => {
  it(`does not report shared retry/cache-buster field hazards in the client`, () => {
    const result = analyzeTypeScriptClient()
    const sharedFieldFindings = result.findings.filter(
      (entry) => entry.kind === `shared-instance-field`
    )

    expect(sharedFieldFindings).toEqual([])
  })

  it(`includes the main recursive client loops in the report`, () => {
    const result = analyzeTypeScriptClient()
    const recursiveMethods = result.reports.recursiveMethods.map(
      (entry) => entry.name
    )

    expect(recursiveMethods).toContain(`#requestShape`)
    expect(recursiveMethods).toContain(`#fetchSnapshotWithRetry`)
  })

  it(`does not report ignored-action findings for the current state machine`, () => {
    const result = analyzeTypeScriptClient()
    const ignoredActionFindings = result.findings.filter(
      (entry) => entry.kind === `ignored-response-transition`
    )

    expect(ignoredActionFindings).toEqual([])
  })
})
