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

interface CacheBusterReport {
  method: string
  statusCheckLine: number
  retryCallee: string
  retryLine: number
  cacheBusterLine: number | null
  unconditional: boolean
}

interface TailPositionAwaitReport {
  method: string
  callee: string
  awaitLine: number
  isParked: boolean
}

interface ErrorPathPublishReport {
  method: string
  callee: string
  callLine: number
  context: string
  contextLine: number
  isInErrorPath: boolean
}

interface TypeScriptClientAnalysisResult {
  findings: AnalysisFinding[]
  reports: {
    recursiveMethods: RecursiveMethodReport[]
    unboundedRetryReport: UnboundedRetryReport[]
    cacheBusterReport: CacheBusterReport[]
    tailPositionAwaitReport: TailPositionAwaitReport[]
    errorPathPublishReport: ErrorPathPublishReport[]
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

    // Every recursive call in a catch block should have a recognizable bound
    // (counter check, type guard, abort signal, or callback gate)
    for (const entry of result.reports.unboundedRetryReport) {
      expect(entry.hasBoundCheck).toBe(true)
    }
  })

  it(`does not report conditional 409 cache busters`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const conditionalFindings = result.findings.filter(
      (entry) => entry.kind === `conditional-409-cache-buster`
    )

    expect(conditionalFindings).toEqual([])

    // Every 409 handler should have an unconditional cache buster
    for (const entry of result.reports.cacheBusterReport) {
      expect(entry.unconditional).toBe(true)
    }
  })

  it(`does not report parked tail-position awaits in recursive methods`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const parkedFindings = result.findings.filter(
      (entry) => entry.kind === `parked-tail-await`
    )

    expect(parkedFindings).toEqual([])

    for (const entry of result.reports.tailPositionAwaitReport) {
      expect(entry.isParked).toBe(false)
    }
  })

  it(`does not call #publish or #onMessages in error handling paths`, async () => {
    const { analyzeTypeScriptClient } = await loadAnalyzerModule()
    const result = analyzeTypeScriptClient()
    const errorPathFindings = result.findings.filter(
      (entry) => entry.kind === `error-path-publish`
    )

    expect(errorPathFindings).toEqual([])

    for (const entry of result.reports.errorPathPublishReport) {
      expect(entry.isInErrorPath).toBe(false)
    }
  })

  it(`includes all internal protocol QUERY_PARAM constants in ELECTRIC_PROTOCOL_QUERY_PARAMS`, async () => {
    // Internal protocol params must be listed in ELECTRIC_PROTOCOL_QUERY_PARAMS
    // so canonicalShapeKey strips them. Missing entries cause cache key
    // divergence between code paths (e.g., SSE vs long-polling).
    const constants = await import(`../src/constants`)
    const protocolParams = new Set(constants.ELECTRIC_PROTOCOL_QUERY_PARAMS)

    const userFacingParams = new Set([
      `COLUMNS_QUERY_PARAM`,
      `TABLE_QUERY_PARAM`,
      `WHERE_QUERY_PARAM`,
      `REPLICA_PARAM`,
      `WHERE_PARAMS_PARAM`,
    ])

    const internalParamExports = Object.entries(constants)
      .filter(
        ([key]) =>
          key.endsWith(`_QUERY_PARAM`) &&
          key !== `ELECTRIC_PROTOCOL_QUERY_PARAMS` &&
          !userFacingParams.has(key)
      )
      .map(([key, value]) => ({ key, value: value as string }))

    expect(internalParamExports.length).toBeGreaterThan(0)

    const missing = internalParamExports.filter(
      ({ value }) => !protocolParams.has(value)
    )

    expect(missing.map(({ key }) => key)).toEqual([])
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
