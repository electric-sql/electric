import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

interface AnalysisFinding {
  kind: string
  details?: {
    literal?: string
    canonical?: string
  }
}

interface RecursiveMethodReport {
  name: string
}

interface UnboundedRetryReport {
  method: string
  callee: string
  callLine: number
  catchLine: number
  hasBoundCheck: boolean
  boundKind: string | null
}

interface TypeScriptClientAnalysisResult {
  findings: AnalysisFinding[]
  reports: {
    recursiveMethods: RecursiveMethodReport[]
    unboundedRetryReport: UnboundedRetryReport[]
  }
}

type AnalyzerModule = {
  analyzeTypeScriptClient: () => TypeScriptClientAnalysisResult
  analyzeProtocolLiterals: (
    filePaths: string[],
    options?: {
      requireConstantsInFiles?: (filePath: string) => boolean
    }
  ) => {
    findings: AnalysisFinding[]
  }
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

  it(`does not report unbounded retry loops in recursive catch blocks`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const unboundedFindings = result.findings.filter(
      (entry) => entry.kind === `unbounded-retry-loop`
    )

    expect(unboundedFindings).toEqual([])

    // Heuristic check: every recursive call in a catch block should have
    // a recognizable bound pattern (counter check, type guard, or abort signal)
    for (const entry of result.reports.unboundedRetryReport) {
      expect(entry.hasBoundCheck).toBe(true)
    }
  })

  it(`reports near-miss Electric protocol literals`, async () => {
    const { analyzeProtocolLiterals } = await loadAnalyzerModule()
    const fixturePath = path.resolve(
      process.cwd(),
      `test/fixtures/static-analysis/protocol-literal-near-miss.ts`
    )

    const result = analyzeProtocolLiterals([fixturePath])
    const literals = result.findings
      .filter((entry) => entry.kind === `protocol-literal-drift`)
      .map((entry) => [entry.details?.literal, entry.details?.canonical])

    expect(literals).toContainEqual([`cache_buster`, `cache-buster`])
    expect(literals).toContainEqual([`electric_handle`, `electric-handle`])
  })

  it(`reports raw Electric protocol literals when constants are required`, async () => {
    const { analyzeProtocolLiterals } = await loadAnalyzerModule()
    const fixturePath = path.resolve(
      process.cwd(),
      `test/fixtures/static-analysis/protocol-literal-raw.ts`
    )

    const result = analyzeProtocolLiterals([fixturePath], {
      requireConstantsInFiles: () => true,
    })
    const literals = result.findings
      .filter((entry) => entry.kind === `raw-protocol-literal`)
      .map((entry) => [entry.details?.literal, entry.details?.canonical])

    expect(literals).toContainEqual([`electric-handle`, `electric-handle`])
    expect(literals).toContainEqual([`electric-offset`, `electric-offset`])
    expect(literals).toContainEqual([`electric-schema`, `electric-schema`])
  })
})
