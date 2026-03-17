import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

interface AnalysisFinding {
  kind: string
}

interface RecursiveMethodReport {
  name: string
}

interface TypeScriptClientAnalysisResult {
  findings: AnalysisFinding[]
  reports: {
    recursiveMethods: RecursiveMethodReport[]
  }
}

type AnalyzerModule = {
  analyzeTypeScriptClient: () => TypeScriptClientAnalysisResult
}

async function loadAnalyzerModule(): Promise<AnalyzerModule> {
  const moduleUrl = pathToFileURL(
    path.resolve(process.cwd(), `bin/lib/shape-stream-static-analysis.mjs`)
  ).href

  return import(moduleUrl) as Promise<AnalyzerModule>
}

describe(`shape-stream static analysis`, () => {
  it(`does not report shared retry/cache-buster field hazards in the client`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const sharedFieldFindings = result.findings.filter(
      (entry) => entry.kind === `shared-instance-field`
    )

    expect(sharedFieldFindings).toEqual([])
  })

  it(`includes the main recursive client loops in the report`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const recursiveMethods = result.reports.recursiveMethods.map(
      (entry) => entry.name
    )

    expect(recursiveMethods).toContain(`#requestShape`)
    expect(recursiveMethods).toContain(`#fetchSnapshotWithRetry`)
  })

  it(`does not report ignored-action findings for the current state machine`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const ignoredActionFindings = result.findings.filter(
      (entry) => entry.kind === `ignored-response-transition`
    )

    expect(ignoredActionFindings).toEqual([])
  })
})
