#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  analyzeTypeScriptClient,
  filterFindingsToChangedFiles,
  filterFindingsToChangedLines,
  formatAnalysisResult,
  loadChangedLines,
} from './lib/shape-stream-static-analysis.mjs'

const args = process.argv.slice(2)
const failOnFindings = args.includes(`--fail-on-findings`)
const json = args.includes(`--json`)

const explicitRangeIndex = args.findIndex((arg) => arg === `--range`)
const explicitRange =
  explicitRangeIndex >= 0 ? args[explicitRangeIndex + 1] : undefined
const explicitScopeIndex = args.findIndex((arg) => arg === `--scope`)
const scope = explicitScopeIndex >= 0 ? args[explicitScopeIndex + 1] : `file`

const result = analyzeTypeScriptClient()
const range = explicitRange ?? getDefaultRange()
const changedLines = loadChangedLines(range, [
  result.clientFile,
  result.stateMachineFile,
])
const findings =
  scope === `line`
    ? filterFindingsToChangedLines(result.findings, changedLines)
    : filterFindingsToChangedFiles(result.findings, changedLines)

if (json) {
  console.log(
    JSON.stringify(
      {
        range,
        scope,
        findings,
      },
      null,
      2
    )
  )
} else {
  console.log(`Range: ${range}`)
  console.log(`Scope: ${scope}`)
  if (scope === `line`) {
    console.log(formatAnalysisResult(result, { changedLines }))
  } else {
    console.log(
      formatAnalysisResult({
        ...result,
        findings,
      })
    )
  }
}

if (failOnFindings && findings.length > 0) {
  process.exitCode = 1
}

function getDefaultRange() {
  try {
    const mergeBase = execFileSync(`git`, [`merge-base`, `origin/main`, `HEAD`], {
      encoding: `utf8`,
      stdio: [`ignore`, `pipe`, `ignore`],
    }).trim()

    if (mergeBase.length > 0) {
      return `${mergeBase}...HEAD`
    }
  } catch {}

  return `HEAD~1..HEAD`
}
