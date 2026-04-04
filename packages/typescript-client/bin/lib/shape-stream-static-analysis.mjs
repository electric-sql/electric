import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const PACKAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `..`,
  `..`
)
const GIT_ROOT = resolveGitRoot()

const CLIENT_FILE = path.join(PACKAGE_DIR, `src`, `client.ts`)
const STATE_MACHINE_FILE = path.join(
  PACKAGE_DIR,
  `src`,
  `shape-stream-state.ts`
)
const ANALYSIS_DIRS = [`src`, `test`, `bin`]
const ANALYSIS_EXTENSIONS = new Set([`.ts`, `.tsx`, `.js`, `.mjs`])
const ANALYSIS_EXCLUDED_DIRS = new Set([
  `dist`,
  `node_modules`,
  `junit`,
  `coverage`,
  `fixtures`,
])
const PROTOCOL_LITERAL_METHODS = new Set([
  `get`,
  `set`,
  `has`,
  `append`,
  `delete`,
])
const PROTOCOL_LITERAL_CANONICAL_VALUES = [
  `electric-cursor`,
  `electric-handle`,
  `electric-offset`,
  `electric-schema`,
  `electric-up-to-date`,
  `cursor`,
  `expired_handle`,
  `handle`,
  `live`,
  `offset`,
  `table`,
  `where`,
  `replica`,
  `params`,
  `experimental_live_sse`,
  `live_sse`,
  `log`,
  `subset__where`,
  `subset__limit`,
  `subset__offset`,
  `subset__order_by`,
  `subset__params`,
  `subset__where_expr`,
  `subset__order_by_expr`,
  `cache-buster`,
]
const PROTOCOL_LITERAL_BY_NORMALIZED = new Map(
  PROTOCOL_LITERAL_CANONICAL_VALUES.map((value) => [
    normalizeLiteral(value),
    value,
  ])
)

const SHARED_FIELD_IGNORE = new Set([
  `#syncState`,
  `#started`,
  `#connected`,
  `#error`,
  `#messageChain`,
  `#onError`,
  `#mode`,
  `#pauseLock`,
  `#subscribers`,
  `#snapshotTracker`,
  `#snapshotCounter`,
  `#unsubscribeFromVisibilityChanges`,
  `#unsubscribeFromWakeDetection`,
  `#transformer`,
  `#currentFetchUrl`,
  `#tickPromise`,
])

const ALLOWED_IGNORED_ACTION_CLASSES = new Set([`ErrorState`, `PausedState`])

export function analyzeTypeScriptClient(options = {}) {
  const packageDir = options.packageDir ?? PACKAGE_DIR
  const clientFile = path.join(packageDir, `src`, `client.ts`)
  const stateMachineFile = path.join(packageDir, `src`, `shape-stream-state.ts`)

  const clientAnalysis = analyzeShapeStreamClient(clientFile)
  const stateMachineAnalysis = analyzeStateMachine(stateMachineFile)
  const protocolLiteralAnalysis = analyzeProtocolLiterals(
    listAnalysisFiles(packageDir),
    {
      requireConstantsInFiles: (filePath) =>
        filePath.includes(`${path.sep}src${path.sep}`),
    }
  )

  const findings = clientAnalysis.findings
    .concat(stateMachineAnalysis.findings)
    .concat(protocolLiteralAnalysis.findings)
    .sort(compareFindings)

  return {
    packageDir,
    clientFile,
    stateMachineFile,
    findings,
    reports: {
      recursiveMethods: clientAnalysis.recursiveMethods,
      sharedFieldReport: clientAnalysis.sharedFieldReport,
      unboundedRetryReport: clientAnalysis.unboundedRetryReport,
      cacheBusterReport: clientAnalysis.cacheBusterReport,
      ignoredActionReport: stateMachineAnalysis.ignoredActionReport,
      protocolLiteralReport: protocolLiteralAnalysis.report,
    },
  }
}

export function analyzeShapeStreamClient(filePath = CLIENT_FILE) {
  const sourceFile = readSourceFile(filePath)
  const classDecl = sourceFile.statements.find(
    (statement) =>
      ts.isClassDeclaration(statement) && statement.name?.text === `ShapeStream`
  )

  if (!classDecl) {
    throw new Error(`Could not find ShapeStream class in ${filePath}`)
  }

  const classInfo = buildClassInfo(sourceFile, classDecl)
  const recursiveMethods = buildRecursiveMethodReport(classInfo)
  const sharedFieldReport = buildSharedFieldReport(classInfo)
  const unboundedRetryReport = buildUnboundedRetryReport(
    sourceFile,
    classDecl,
    recursiveMethods
  )
  const cacheBusterReport = build409CacheBusterReport(sourceFile, classDecl)
  const findings = sharedFieldReport
    .filter((report) => report.risky)
    .map((report) => ({
      kind: `shared-instance-field`,
      severity: `warning`,
      title: `Shared mutable field spans async boundaries: ${report.field}`,
      message:
        `${report.field} is written before an await or async internal call and ` +
        `is also consumed by other methods. This can leak retry/cache-buster state ` +
        `across concurrent call chains.`,
      file: filePath,
      line: report.primaryLine,
      locations: uniqueLocations([
        {
          file: filePath,
          line: report.primaryLine,
          label: `first async write`,
        },
        ...report.writerLines.map((line) => ({
          file: filePath,
          line,
          label: `writer`,
        })),
        ...report.readerLines.map((line) => ({
          file: filePath,
          line,
          label: `reader/reset`,
        })),
      ]),
      details: {
        field: report.field,
        writerMethods: report.writerMethods,
        readerMethods: report.readerMethods,
        reasons: report.reasons,
      },
    }))
    .concat(
      unboundedRetryReport
        .filter((entry) => !entry.hasBoundCheck)
        .map((entry) => ({
          kind: `unbounded-retry-loop`,
          severity: `warning`,
          title: `Unbounded recursive retry: ${entry.method} -> ${entry.callee}`,
          message:
            `${entry.method} contains a recursive call to ${entry.callee} at line ${entry.callLine} ` +
            `inside a catch block with no detectable retry bound (counter, type guard, or abort check). ` +
            `This can cause infinite retries when the error condition persists.`,
          file: filePath,
          line: entry.callLine,
          locations: [
            { file: filePath, line: entry.catchLine, label: `catch block` },
            { file: filePath, line: entry.callLine, label: `recursive call` },
          ],
          details: entry,
        }))
    )
    .concat(
      cacheBusterReport
        .filter((entry) => !entry.unconditional)
        .map((entry) => ({
          kind: `conditional-409-cache-buster`,
          severity: `warning`,
          title: `409 handler has conditional or missing cache buster in ${entry.method}`,
          message:
            `${entry.method} handles status 409 and retries via ${entry.retryCallee} at line ${entry.retryLine} ` +
            `but createCacheBuster() is ${entry.cacheBusterLine ? `conditional (line ${entry.cacheBusterLine})` : `missing`}. ` +
            `Every 409 retry must include an unconditional cache buster to guarantee a unique retry URL, ` +
            `otherwise same-handle 409s or proxy-cached responses can cause infinite retry loops.`,
          file: filePath,
          line: entry.retryLine,
          locations: [
            { file: filePath, line: entry.statusCheckLine, label: `409 check` },
            ...(entry.cacheBusterLine
              ? [{ file: filePath, line: entry.cacheBusterLine, label: `conditional cache buster` }]
              : []),
            { file: filePath, line: entry.retryLine, label: `retry call` },
          ],
          details: entry,
        }))
    )

  return {
    sourceFile,
    classInfo,
    recursiveMethods,
    sharedFieldReport,
    unboundedRetryReport,
    cacheBusterReport,
    findings,
  }
}

export function analyzeStateMachine(filePath = STATE_MACHINE_FILE) {
  const sourceFile = readSourceFile(filePath)
  const findings = []
  const ignoredActionReport = []

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue

    const className = statement.name.text
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.body || !member.name) {
        continue
      }

      const methodName = formatMemberName(member.name)
      const returnsIgnored = []

      walk(member.body, (node) => {
        if (!ts.isReturnStatement(node) || !node.expression) return
        if (!ts.isObjectLiteralExpression(node.expression)) return

        const actionProperty = getObjectLiteralPropertyValue(
          node.expression,
          `action`
        )
        if (actionProperty !== `ignored`) return

        const statePropertyNode = getObjectLiteralPropertyNode(
          node.expression,
          `state`
        )
        const stateIsThis =
          statePropertyNode != null &&
          ts.isPropertyAssignment(statePropertyNode) &&
          statePropertyNode.initializer.kind === ts.SyntaxKind.ThisKeyword

        returnsIgnored.push({
          line: getLine(sourceFile, node),
          stateIsThis,
        })
      })

      if (returnsIgnored.length === 0) continue

      ignoredActionReport.push({
        className,
        methodName,
        lines: returnsIgnored.map((entry) => entry.line),
      })

      if (ALLOWED_IGNORED_ACTION_CLASSES.has(className)) continue

      for (const entry of returnsIgnored) {
        findings.push({
          kind: `ignored-response-transition`,
          severity: `warning`,
          title: `Non-delegating state returns ignored action`,
          message:
            `${className}.${methodName} returns { action: 'ignored' } outside ` +
            `the delegate/error states. This is a high-risk pattern for retry loops ` +
            `when the caller keeps requesting with unchanged URL state.`,
          file: filePath,
          line: entry.line,
          locations: [
            {
              file: filePath,
              line: entry.line,
              label: `${className}.${methodName}`,
            },
          ],
          details: {
            className,
            methodName,
            stateIsThis: entry.stateIsThis,
          },
        })
      }
    }
  }

  return {
    sourceFile,
    findings,
    ignoredActionReport,
  }
}

export function analyzeProtocolLiterals(filePaths, options = {}) {
  const findings = []
  const report = []
  const requireConstantsInFiles =
    options.requireConstantsInFiles ?? (() => false)

  for (const filePath of filePaths) {
    const sourceFile = readSourceFile(filePath)

    walk(sourceFile, (node) => {
      const candidate = getProtocolLiteralCandidate(sourceFile, node)
      if (!candidate) return

      const requireConstants = requireConstantsInFiles(filePath)
      const kind =
        candidate.literal === candidate.canonical
          ? requireConstants
            ? `raw-protocol-literal`
            : null
          : `protocol-literal-drift`

      if (!kind) return

      report.push({
        ...candidate,
        kind,
      })

      findings.push({
        kind,
        severity: `warning`,
        title:
          kind === `raw-protocol-literal`
            ? `Raw Electric protocol literal should use shared constant`
            : `Near-miss Electric protocol literal: ${candidate.literal}`,
        message:
          kind === `raw-protocol-literal`
            ? `${candidate.literal} is a canonical Electric protocol literal ` +
              `used directly in implementation code. Import the shared constant ` +
              `instead to avoid drift between call sites.`
            : `${candidate.literal} is a near-miss for the canonical Electric ` +
              `protocol literal ${candidate.canonical}. Use the shared constant ` +
              `or canonical string to avoid URL/header drift.`,
        file: filePath,
        line: candidate.line,
        locations: [
          {
            file: filePath,
            line: candidate.line,
            label: candidate.context,
          },
        ],
        details: {
          literal: candidate.literal,
          canonical: candidate.canonical,
          context: candidate.context,
        },
      })
    })
  }

  return {
    findings: findings.sort(compareFindings),
    report: report.sort(compareReports),
  }
}

export function loadChangedLines(range, files) {
  const relativeFiles = files.map((file) => path.relative(GIT_ROOT, file))
  const diffOutput = execFileSync(
    `git`,
    [`diff`, `--unified=0`, `--no-color`, range, `--`, ...relativeFiles],
    {
      cwd: GIT_ROOT,
      encoding: `utf8`,
      stdio: [`ignore`, `pipe`, `pipe`],
    }
  )

  return parseChangedLines(diffOutput)
}

export function filterFindingsToChangedLines(findings, changedLines) {
  return findings.filter((finding) => {
    const locations = finding.locations?.length
      ? finding.locations
      : [{ file: finding.file, line: finding.line }]

    return locations.some((location) =>
      lineIsChanged(changedLines, location.file, location.line)
    )
  })
}

export function filterFindingsToChangedFiles(findings, changedLines) {
  const changedFiles = new Set(changedLines.keys())
  return findings.filter((finding) => changedFiles.has(finding.file))
}

export function formatAnalysisResult(result, options = {}) {
  const changedLines = options.changedLines
  const findings = changedLines
    ? filterFindingsToChangedLines(result.findings, changedLines)
    : result.findings

  const lines = []
  lines.push(`Findings: ${findings.length}`)

  if (findings.length === 0) {
    lines.push(`No findings.`)
  } else {
    for (const finding of findings) {
      lines.push(
        `${finding.severity.toUpperCase()} ${finding.kind} ` +
          `${path.relative(result.packageDir, finding.file)}:${finding.line}`
      )
      lines.push(`  ${finding.title}`)
      lines.push(`  ${finding.message}`)
    }
  }

  if (!changedLines) {
    lines.push(``)
    lines.push(`Recursive Methods:`)
    for (const report of result.reports.recursiveMethods) {
      const cycles =
        report.callees.length === 0
          ? `no internal calls`
          : report.callees.join(`, `)
      lines.push(
        `  ${report.name} (${path.relative(result.packageDir, report.file)}:${report.line}) -> ${cycles}`
      )
    }

    lines.push(``)
    lines.push(`Shared Field Candidates:`)
    for (const report of result.reports.sharedFieldReport) {
      const flag = report.risky ? `!` : `-`
      lines.push(
        `  ${flag} ${report.field}: writers=${report.writerMethods.join(`, `) || `none`} ` +
          `readers=${report.readerMethods.join(`, `) || `none`}`
      )
    }

    lines.push(``)
    lines.push(`Unbounded Retry Report:`)
    for (const report of result.reports.unboundedRetryReport) {
      const flag = report.hasBoundCheck ? `-` : `!`
      lines.push(
        `  ${flag} ${report.method} -> ${report.callee} ` +
          `(catch:${report.catchLine} call:${report.callLine}) ` +
          `bound=${report.boundKind ?? `none`}`
      )
    }

    lines.push(``)
    lines.push(`409 Cache Buster Report:`)
    for (const report of result.reports.cacheBusterReport) {
      const flag = report.unconditional ? `-` : `!`
      lines.push(
        `  ${flag} ${report.method} -> ${report.retryCallee} ` +
          `(409:${report.statusCheckLine} retry:${report.retryLine}) ` +
          `cacheBuster=${report.unconditional ? `unconditional` : report.cacheBusterLine ? `conditional:${report.cacheBusterLine}` : `missing`}`
      )
    }

    lines.push(``)
    lines.push(`Ignored Action Sites:`)
    for (const report of result.reports.ignoredActionReport) {
      lines.push(
        `  ${report.className}.${report.methodName} lines ${report.lines.join(`, `)}`
      )
    }

    lines.push(``)
    lines.push(`Protocol Literal Sites:`)
    if (result.reports.protocolLiteralReport.length === 0) {
      lines.push(`  none`)
    } else {
      for (const report of result.reports.protocolLiteralReport) {
        lines.push(
          `  ${report.kind} ${path.relative(result.packageDir, report.file)}:${report.line} ` +
            `${report.literal} -> ${report.canonical} (${report.context})`
        )
      }
    }
  }

  return lines.join(`\n`)
}

function analyzeMethod(sourceFile, methodNames, fieldNames, methodNode) {
  const name = formatMemberName(methodNode.name)
  const summary = {
    name,
    file: sourceFile.fileName,
    line: getLine(sourceFile, methodNode.name),
    async: methodNode.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword
    )
      ? true
      : false,
    public: !name.startsWith(`#`) && name !== `constructor`,
    calls: [],
    fieldReads: new Map(),
    fieldWrites: new Map(),
    awaits: [],
  }

  walk(methodNode.body, (node) => {
    if (ts.isAwaitExpression(node)) {
      summary.awaits.push(getLine(sourceFile, node))
      return
    }

    if (ts.isCallExpression(node)) {
      const callee = getThisMemberName(node.expression)
      if (callee && methodNames.has(callee)) {
        summary.calls.push({
          callee,
          line: getLine(sourceFile, node),
        })
      }
      return
    }

    if (!ts.isPropertyAccessExpression(node)) return

    const member = getThisMemberName(node)
    if (!member || methodNames.has(member) || !fieldNames.has(member)) return

    if (ts.isCallExpression(node.parent) && node.parent.expression === node) {
      return
    }

    const line = getLine(sourceFile, node)
    if (isWritePosition(node)) {
      pushMapArray(summary.fieldWrites, member, line)
    } else {
      pushMapArray(summary.fieldReads, member, line)
    }
  })

  return summary
}

function buildClassInfo(sourceFile, classDecl) {
  const fieldNames = new Set()
  const methodNames = new Set()
  const methods = new Map()

  for (const member of classDecl.members) {
    if (
      ts.isPropertyDeclaration(member) &&
      member.name &&
      (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name))
    ) {
      fieldNames.add(formatMemberName(member.name))
      continue
    }

    if (
      ts.isGetAccessorDeclaration(member) &&
      member.name &&
      (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name))
    ) {
      fieldNames.add(formatMemberName(member.name))
      continue
    }

    if (
      ts.isMethodDeclaration(member) &&
      member.name &&
      (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name))
    ) {
      methodNames.add(formatMemberName(member.name))
      continue
    }
  }

  for (const member of classDecl.members) {
    if (!ts.isMethodDeclaration(member) || !member.body || !member.name)
      continue
    methods.set(
      formatMemberName(member.name),
      analyzeMethod(sourceFile, methodNames, fieldNames, member)
    )
  }

  return {
    sourceFile,
    fieldNames,
    methodNames,
    methods,
  }
}

function buildRecursiveMethodReport(classInfo) {
  const graph = new Map()
  for (const [name, method] of classInfo.methods) {
    graph.set(name, [
      ...new Set(
        method.calls
          .map((call) => call.callee)
          .filter((callee) => callee !== name)
      ),
    ])
  }

  const recursiveSet = new Set()
  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length > 1) {
      component.forEach((name) => recursiveSet.add(name))
      continue
    }

    const [single] = component
    const method = classInfo.methods.get(single)
    if (method?.calls.some((call) => call.callee === single)) {
      recursiveSet.add(single)
    }
  }

  return [...classInfo.methods.values()]
    .filter((method) => recursiveSet.has(method.name))
    .map((method) => ({
      name: method.name,
      file: method.file,
      line: method.line,
      callees: [...new Set(method.calls.map((call) => call.callee))].sort(),
    }))
    .sort(compareReports)
}

function buildSharedFieldReport(classInfo) {
  const reports = []

  for (const field of [...classInfo.fieldNames].sort()) {
    if (SHARED_FIELD_IGNORE.has(field)) continue
    if (!isCandidateEphemeralField(field)) continue

    const writers = []
    const readers = []
    const reasons = []

    for (const method of classInfo.methods.values()) {
      const writeLines = method.fieldWrites.get(field) ?? []
      const readLines = method.fieldReads.get(field) ?? []

      if (writeLines.length > 0) {
        const hasAsyncBoundary = writeLines.some((line) =>
          hasAsyncBoundaryAfterLine(method, classInfo.methods, line)
        )

        writers.push({
          method: method.name,
          lines: writeLines,
          hasAsyncBoundary,
        })

        if (hasAsyncBoundary) {
          reasons.push(
            `${field} is written in ${method.name} before a later await/async internal call`
          )
        }
      }

      if (readLines.length > 0) {
        readers.push({
          method: method.name,
          lines: readLines,
        })
      }
    }

    if (writers.length === 0 && readers.length === 0) continue

    const writerMethods = writers.map((writer) => writer.method)
    const readerMethods = readers.map((reader) => reader.method)
    const writerLines = writers.flatMap((writer) => writer.lines)
    const readerLines = readers.flatMap((reader) => reader.lines)
    const crossMethodUse = new Set(writerMethods.concat(readerMethods)).size > 1
    const hasRiskyWriter = writers.some((writer) => writer.hasAsyncBoundary)
    const constructUrlConsumes = readers.some(
      (reader) => reader.method === `#constructUrl`
    )
    const publicMethodTouches = readers
      .concat(writers)
      .some((entry) => !entry.method.startsWith(`#`))
    const highRiskField = /(?:Buster|Retry)/.test(field)

    if (constructUrlConsumes) {
      reasons.push(
        `${field} is consumed by #constructUrl, which multiple paths call`
      )
    }
    if (publicMethodTouches) {
      reasons.push(`${field} is reachable from a public API surface`)
    }

    reports.push({
      field,
      risky:
        crossMethodUse &&
        hasRiskyWriter &&
        (constructUrlConsumes || highRiskField),
      primaryLine: writerLines[0] ?? readerLines[0],
      writerMethods,
      readerMethods,
      writerLines,
      readerLines,
      reasons: [...new Set(reasons)].sort(),
    })
  }

  return reports.sort(compareReports)
}

function buildUnboundedRetryReport(sourceFile, classDecl, recursiveMethods) {
  const report = []
  const recursiveNames = new Set(recursiveMethods.map((m) => m.name))

  for (const member of classDecl.members) {
    if (!ts.isMethodDeclaration(member) || !member.body || !member.name) continue
    const methodName = formatMemberName(member.name)
    if (!recursiveNames.has(methodName)) continue

    walk(member.body, (node) => {
      if (!ts.isCatchClause(node)) return

      const catchLine = getLine(sourceFile, node)

      walk(node.block, (inner) => {
        if (!ts.isCallExpression(inner)) return
        const callee = getThisMemberName(inner.expression)
        if (!callee || !recursiveNames.has(callee)) return

        const callLine = getLine(sourceFile, inner)
        const boundKind = classifyRetryBound(sourceFile, node, inner)

        report.push({
          method: methodName,
          callee,
          callLine,
          catchLine,
          hasBoundCheck: boundKind !== null,
          boundKind,
        })
      })
    })
  }

  return report.sort(compareReports)
}

/**
 * Finds all 409 status handlers in the ShapeStream class and verifies that
 * each one unconditionally calls createCacheBuster(). A 409 retry without
 * a cache buster risks producing identical retry URLs when the server
 * returns the same handle, causing infinite CDN-cached retry loops.
 */
function build409CacheBusterReport(sourceFile, classDecl) {
  const report = []

  for (const member of classDecl.members) {
    if (!ts.isMethodDeclaration(member) || !member.body || !member.name) continue
    const methodName = formatMemberName(member.name)

    walk(member.body, (node) => {
      // Look for if-statements that check e.status == 409 or e.status === 409
      if (!ts.isIfStatement(node)) return
      if (!is409StatusCheck(node.expression)) return

      const statusCheckLine = getLine(sourceFile, node)
      const block = node.thenStatement

      // Find retry calls (recursive this.# calls or return this.# calls)
      const retryCalls = []
      walk(block, (inner) => {
        if (!ts.isCallExpression(inner)) return
        const callee = getThisMemberName(inner.expression)
        if (callee) {
          retryCalls.push({
            callee,
            line: getLine(sourceFile, inner),
          })
        }
      })

      if (retryCalls.length === 0) return

      // Find all createCacheBuster() calls in the 409 block
      const cacheBusterCalls = []
      walk(block, (inner) => {
        if (
          ts.isCallExpression(inner) &&
          ts.isIdentifier(inner.expression) &&
          inner.expression.text === `createCacheBuster`
        ) {
          cacheBusterCalls.push({
            line: getLine(sourceFile, inner),
            conditional: isInsideIfBlock(inner, block),
          })
        }
      })

      // Determine the last retry call (the one that actually does the retry)
      const lastRetry = retryCalls[retryCalls.length - 1]

      if (cacheBusterCalls.length === 0) {
        report.push({
          method: methodName,
          statusCheckLine,
          retryCallee: lastRetry.callee,
          retryLine: lastRetry.line,
          cacheBusterLine: null,
          unconditional: false,
        })
      } else {
        // Check if ANY cache buster call is unconditional (not inside an if)
        const hasUnconditional = cacheBusterCalls.some((c) => !c.conditional)
        report.push({
          method: methodName,
          statusCheckLine,
          retryCallee: lastRetry.callee,
          retryLine: lastRetry.line,
          cacheBusterLine: cacheBusterCalls[0].line,
          unconditional: hasUnconditional,
        })
      }
    })
  }

  return report.sort(compareReports)
}

/**
 * Returns true if the expression contains a `.status == 409` or `.status === 409` check.
 * Recurses into `&&` and `||` expressions to handle compound conditions like
 * `e instanceof FetchError && e.status === 409`.
 */
function is409StatusCheck(expression) {
  if (!ts.isBinaryExpression(expression)) return false

  const op = expression.operatorToken.kind
  if (
    op === ts.SyntaxKind.EqualsEqualsToken ||
    op === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return (
      (is409Literal(expression.left) && isStatusAccess(expression.right)) ||
      (is409Literal(expression.right) && isStatusAccess(expression.left))
    )
  }

  if (
    op === ts.SyntaxKind.AmpersandAmpersandToken ||
    op === ts.SyntaxKind.BarBarToken
  ) {
    return is409StatusCheck(expression.left) || is409StatusCheck(expression.right)
  }

  return false
}

function is409Literal(node) {
  return ts.isNumericLiteral(node) && node.text === `409`
}

function isStatusAccess(node) {
  return ts.isPropertyAccessExpression(node) && node.name.text === `status`
}

/**
 * Returns true if a node is inside an if-statement's then or else block
 * within the given boundary node (the 409 handler block).
 */
function isInsideIfBlock(node, boundary) {
  let current = node.parent
  while (current && current !== boundary) {
    const parent = current.parent
    if (
      parent &&
      ts.isIfStatement(parent) &&
      (current === parent.thenStatement || current === parent.elseStatement)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function classifyRetryBound(sourceFile, catchClause, callNode) {
  const callLine = getLine(sourceFile, callNode)
  const enclosingConditions = collectEnclosingIfConditions(catchClause, callNode)

  if (findPriorCounterGuard(sourceFile, catchClause.block, callLine)) {
    return `counter`
  }

  for (const condition of enclosingConditions) {
    if (containsThisFieldComparison(condition)) return `counter`
  }

  for (const condition of enclosingConditions) {
    if (containsInstanceof(condition) || containsPropertyEquality(condition)) {
      return `type-guard`
    }
  }

  for (const condition of enclosingConditions) {
    if (containsAbortedAccess(condition)) return `abort-signal`
  }

  if (enclosingConditions.length > 0) return `callback-gate`

  return null
}

function collectEnclosingIfConditions(catchClause, callNode) {
  const conditions = []
  let current = callNode.parent

  while (current && current !== catchClause) {
    const parent = current.parent
    if (parent && ts.isIfStatement(parent) && current === parent.thenStatement) {
      conditions.push(parent.expression)
    }
    current = current.parent
  }

  return conditions
}

function findPriorCounterGuard(sourceFile, block, beforeLine) {
  let found = false
  walk(block, (node) => {
    if (found) return
    if (!ts.isIfStatement(node)) return
    if (getLine(sourceFile, node) >= beforeLine) return
    if (!containsThisFieldComparison(node.expression)) return
    if (!containsExitStatement(node.thenStatement)) return
    found = true
  })
  return found
}

function containsInstanceof(node) {
  let found = false
  walk(node, (inner) => {
    if (found) return
    if (
      ts.isBinaryExpression(inner) &&
      inner.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
    ) {
      found = true
    }
  })
  return found
}

function containsPropertyEquality(node) {
  let found = false
  walk(node, (inner) => {
    if (found) return
    if (!ts.isBinaryExpression(inner)) return
    const op = inner.operatorToken.kind
    if (
      op !== ts.SyntaxKind.EqualsEqualsToken &&
      op !== ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      return
    }
    if (
      ts.isPropertyAccessExpression(inner.left) ||
      ts.isPropertyAccessExpression(inner.right)
    ) {
      found = true
    }
  })
  return found
}

function containsAbortedAccess(node) {
  let found = false
  walk(node, (inner) => {
    if (found) return
    if (
      ts.isPropertyAccessExpression(inner) &&
      inner.name.text === `aborted`
    ) {
      found = true
    }
  })
  return found
}

function containsThisFieldComparison(node) {
  let found = false
  walk(node, (inner) => {
    if (found) return
    if (!ts.isBinaryExpression(inner)) return
    const op = inner.operatorToken.kind
    if (
      op !== ts.SyntaxKind.GreaterThanToken &&
      op !== ts.SyntaxKind.GreaterThanEqualsToken &&
      op !== ts.SyntaxKind.LessThanToken &&
      op !== ts.SyntaxKind.LessThanEqualsToken
    ) {
      return
    }
    if (isThisFieldAccess(inner.left) || isThisFieldAccess(inner.right)) {
      found = true
    }
  })
  return found
}

function isThisFieldAccess(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword
  )
}

function containsExitStatement(node) {
  let found = false
  walk(node, (inner) => {
    if (found) return
    if (ts.isReturnStatement(inner) || ts.isThrowStatement(inner)) {
      found = true
    }
  })
  return found
}

function stronglyConnectedComponents(graph) {
  let index = 0
  const stack = []
  const indices = new Map()
  const lowLinks = new Map()
  const onStack = new Set()
  const components = []

  const visit = (node) => {
    indices.set(node, index)
    lowLinks.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)

    for (const neighbor of graph.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        visit(neighbor)
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(neighbor)))
      } else if (onStack.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(neighbor)))
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return

    const component = []
    while (stack.length > 0) {
      const current = stack.pop()
      onStack.delete(current)
      component.push(current)
      if (current === node) break
    }
    components.push(component.sort())
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node)
  }

  return components
}

function parseChangedLines(diffOutput) {
  const changedLines = new Map()
  let currentFile

  for (const line of diffOutput.split(`\n`)) {
    if (line.startsWith(`+++ b/`)) {
      currentFile = path.join(GIT_ROOT, line.slice(6))
      continue
    }

    if (!line.startsWith(`@@`) || !currentFile) continue

    const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!match) continue

    const start = Number(match[1])
    const count = Number(match[2] ?? `1`)
    const lines = changedLines.get(currentFile) ?? new Set()
    const end = count === 0 ? start : start + count - 1

    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      lines.add(lineNumber)
    }
    changedLines.set(currentFile, lines)
  }

  return changedLines
}

function listAnalysisFiles(packageDir) {
  const filePaths = []

  for (const relativeDir of ANALYSIS_DIRS) {
    const absoluteDir = path.join(packageDir, relativeDir)
    if (!fs.existsSync(absoluteDir)) continue
    walkDirectory(absoluteDir, filePaths)
  }

  return filePaths.sort()
}

function walkDirectory(directory, filePaths) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(`.`)) continue
    if (ANALYSIS_EXCLUDED_DIRS.has(entry.name)) continue

    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      walkDirectory(absolutePath, filePaths)
      continue
    }

    if (!ANALYSIS_EXTENSIONS.has(path.extname(entry.name))) continue
    if (absolutePath === path.join(PACKAGE_DIR, `src`, `constants.ts`)) continue
    filePaths.push(absolutePath)
  }
}

function lineIsChanged(changedLines, file, line) {
  return changedLines.get(file)?.has(line) ?? false
}

function readSourceFile(filePath) {
  const text = fs.readFileSync(filePath, `utf8`)
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
}

function getProtocolLiteralCandidate(sourceFile, node) {
  if (ts.isCallExpression(node)) {
    return getProtocolLiteralCandidateFromCall(sourceFile, node)
  }

  if (isProtocolHeaderProperty(node)) {
    return getProtocolLiteralCandidateFromHeaderProperty(sourceFile, node)
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return getProtocolLiteralCandidateFromLiteral(sourceFile, node)
  }

  return null
}

function getProtocolLiteralCandidateFromCall(sourceFile, callExpression) {
  if (!ts.isPropertyAccessExpression(callExpression.expression)) return null
  if (!PROTOCOL_LITERAL_METHODS.has(callExpression.expression.name.text)) {
    return null
  }

  const [firstArg] = callExpression.arguments
  const literal = getStringLiteralValue(firstArg)
  if (!literal) return null

  const receiver = callExpression.expression.expression
  const receiverContext = getProtocolReceiverContext(receiver)
  if (!receiverContext) return null

  return createProtocolLiteralCandidate(
    sourceFile,
    firstArg,
    literal,
    `${receiverContext}.${callExpression.expression.name.text}`
  )
}

function getProtocolLiteralCandidateFromHeaderProperty(
  sourceFile,
  propertyNode
) {
  const literal = getPropertyNameValue(propertyNode.name)
  if (!literal) return null

  return createProtocolLiteralCandidate(
    sourceFile,
    propertyNode.name,
    literal,
    `headers object property`
  )
}

function getProtocolLiteralCandidateFromLiteral(sourceFile, node) {
  const literal = node.text
  if (!PROTOCOL_LITERAL_CANONICAL_VALUES.includes(literal)) return null

  const parent = node.parent
  if (!ts.isArrayLiteralExpression(parent)) return null
  if (!isProtocolLiteralArray(parent)) return null

  return createProtocolLiteralCandidate(
    sourceFile,
    node,
    literal,
    `protocol literal array`
  )
}

function createProtocolLiteralCandidate(sourceFile, node, literal, context) {
  const canonical = PROTOCOL_LITERAL_BY_NORMALIZED.get(
    normalizeLiteral(literal)
  )
  if (!canonical) return null

  return {
    file: sourceFile.fileName,
    line: getLine(sourceFile, node),
    literal,
    canonical,
    context,
  }
}

function getProtocolReceiverContext(receiver) {
  if (ts.isPropertyAccessExpression(receiver)) {
    if (receiver.name.text === `searchParams`) return `searchParams`
    if (receiver.name.text === `headers`) return `headers`
  }

  if (ts.isIdentifier(receiver) && receiver.text === `headers`) {
    return `headers`
  }

  return null
}

function isHeadersObjectLiteral(node) {
  const parent = node.parent

  if (
    ts.isPropertyAssignment(parent) &&
    getPropertyNameValue(parent.name) === `headers`
  ) {
    return true
  }

  if (
    ts.isNewExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === `Headers`
  ) {
    return true
  }

  return false
}

function isProtocolHeaderProperty(node) {
  if (!ts.isPropertyAssignment(node) || !node.name) return false
  if (!ts.isObjectLiteralExpression(node.parent)) return false
  return isHeadersObjectLiteral(node.parent)
}

function isProtocolLiteralArray(node) {
  const parent = node.parent
  if (!ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) {
    return false
  }

  return /(?:Header|Param)s$/.test(parent.name.text)
}

function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function getThisMemberName(node) {
  if (!ts.isPropertyAccessExpression(node)) return null
  if (node.expression.kind !== ts.SyntaxKind.ThisKeyword) return null
  return formatMemberName(node.name)
}

function isWritePosition(node) {
  const parent = node.parent
  if (!parent) return false

  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    return true
  }

  if (
    (ts.isPrefixUnaryExpression(parent) ||
      ts.isPostfixUnaryExpression(parent)) &&
    (parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true
  }

  return false
}

function getLine(sourceFile, node) {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  )
}

function formatMemberName(nameNode) {
  if (ts.isPrivateIdentifier(nameNode)) {
    return nameNode.text.startsWith(`#`) ? nameNode.text : `#${nameNode.text}`
  }
  if (
    ts.isIdentifier(nameNode) ||
    ts.isStringLiteral(nameNode) ||
    ts.isNumericLiteral(nameNode)
  ) {
    return `${nameNode.text}`
  }
  return nameNode.getText()
}

function getPropertyNameValue(nameNode) {
  if (
    ts.isIdentifier(nameNode) ||
    ts.isStringLiteral(nameNode) ||
    ts.isNoSubstitutionTemplateLiteral(nameNode)
  ) {
    return nameNode.text
  }

  return null
}

function getStringLiteralValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return null
}

function hasAsyncBoundaryAfterLine(method, methods, line) {
  if (method.awaits.some((awaitLine) => awaitLine > line)) return true

  return method.calls.some((call) => {
    if (call.line <= line) return false
    return methods.get(call.callee)?.async ?? false
  })
}

function isCandidateEphemeralField(field) {
  return /(?:Buster|Retry|Count|Counter|Recent|AbortController|Promise|Refresh|Duplicate)/.test(
    field
  )
}

function pushMapArray(map, key, value) {
  const values = map.get(key)
  if (values) {
    values.push(value)
    return
  }
  map.set(key, [value])
}

function uniqueLocations(locations) {
  const seen = new Set()
  const result = []

  for (const location of locations) {
    const key = `${location.file}:${location.line}:${location.label ?? ``}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(location)
  }

  return result
}

function getObjectLiteralPropertyNode(objectLiteral, propertyName) {
  return objectLiteral.properties.find((property) => {
    if (!ts.isPropertyAssignment(property) || !property.name) return false
    return formatMemberName(property.name) === propertyName
  })
}

function getObjectLiteralPropertyValue(objectLiteral, propertyName) {
  const property = getObjectLiteralPropertyNode(objectLiteral, propertyName)
  if (!property || !ts.isPropertyAssignment(property)) return undefined
  if (ts.isStringLiteral(property.initializer)) return property.initializer.text
  return undefined
}

function compareFindings(left, right) {
  const fileCompare = left.file.localeCompare(right.file)
  if (fileCompare !== 0) return fileCompare
  return left.line - right.line
}

function compareReports(left, right) {
  const leftLine = left.line ?? left.primaryLine ?? 0
  const rightLine = right.line ?? right.primaryLine ?? 0
  if (leftLine !== rightLine) return leftLine - rightLine
  return (left.file ?? ``).localeCompare(right.file ?? ``)
}

function resolveGitRoot() {
  try {
    return execFileSync(`git`, [`rev-parse`, `--show-toplevel`], {
      cwd: PACKAGE_DIR,
      encoding: `utf8`,
      stdio: [`ignore`, `pipe`, `ignore`],
    }).trim()
  } catch {
    return PACKAGE_DIR
  }
}

function normalizeLiteral(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, ``)
}
