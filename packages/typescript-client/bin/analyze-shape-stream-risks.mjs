#!/usr/bin/env node

import {
  analyzeTypeScriptClient,
  formatAnalysisResult,
} from './lib/shape-stream-static-analysis.mjs'

const args = new Set(process.argv.slice(2))
const result = analyzeTypeScriptClient()
const findings = result.findings

if (args.has(`--json`)) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(formatAnalysisResult(result))
}

if (args.has(`--fail-on-findings`) && findings.length > 0) {
  process.exitCode = 1
}
