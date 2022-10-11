import sqliteParser from 'sqlite-parser'
import { WalkBuilder } from 'walkjs'

import { QualifiedTablename } from './tablename'
import { DbNamespace } from './types'

const dangerousKeywords = [
  'add',
  'alter',
  'commit',
  'create',
  'delete',
  'drop',
  'exec',
  'insert',
  'select into',
  'set',
  'truncate',
  'update'
]

const dangerousKeywordsExp: RegExp = new RegExp(
  dangerousKeywords.map(keyword => `\\b${keyword}\\b`)
    .join('|'),
  'imu'
)

// XXX ideally this could be schema aware to know about dangerous
// stored functions. But it's not the end of the world if we miss
// some updates as the user can notify manually and the satellite
// still picks up the changes via polling.
//
// XXX it's also possible to implement this per statement using
// https://www.sqlite.org/c3ref/stmt_readonly.html
export const isPotentiallyDangerous = (stmt: string): boolean => {
  return dangerousKeywordsExp.test(stmt)
}

export const parseTableNames = (sqlQuery: string, defaultNamespace: DbNamespace = 'main'): QualifiedTablename[] => {
  const ast = sqliteParser(sqlQuery)
  if (ast.type !== 'statement') { throw 'Invalid SQL statement' }
  if (ast.statement.length !== 1) { throw 'Query must be a single SQL statement.' }

  const statement = ast.statement[0]
  if (statement.type !== 'statement' || statement.variant !== 'select') {
    throw 'Query must be a valid SELECT statement.'
  }

  const results: QualifiedTablename[] = []
  const resultSet: Set<string> = new Set()

  new WalkBuilder()
    .withSimpleCallback((node) => {
      const result = _ensureQualified(node.val.name, defaultNamespace).toLowerCase()

      resultSet.add(result)
    })
    .withGlobalFilter(_isTableIdentifier)
    .walk(statement.from)

  Array.from(resultSet).sort().forEach((value: string) => {
    const [ namespace, tablename ] = value.split('.')

    results.push(new QualifiedTablename(namespace, tablename))
  })

  return results
}

const _isTableIdentifier = (node: any): boolean => {
  if (node.nodeType !== 'object') { return false }

  const { val } = node
  if (!val.hasOwnProperty('variant')) { return false }
  if (!val.hasOwnProperty('type')) { return false }

  if (val.type !== 'identifier' || val.variant !== 'table') {
    return false
  }

  return true
}

const _ensureQualified = (candidate: string, defaultNamespace: DbNamespace = 'main'): string => {
  if (candidate.includes('.')) {
    return candidate
  }

  return `${defaultNamespace}.${candidate}`
}

// XXX Only works when statements start on new lines.
// XXX We need to remove this. It's not a good approach.
export const parseSqlIntoStatements = (sql: string): string[] => {
  const ast = sqliteParser(sql)
  if (ast.type !== "statement" || ast.variant !== "list") {
    return [sql]
  }

  const statements = ast.statement
  if (statements.length < 2) {
    return [sql]
  }

  const lines = sql
    .replace(/^-- .*\n?/gm, '')
    .split('\n')
    .filter(s => s.trim() !== '')

  let cursor = 0
  const statementLineIndexes = []

  for (let i = 0; i < statements.length; i++) {
    const { action, variant } = statements[i]

    let matchString = `${variant}`
    if (variant === "transaction") {
      matchString = `${action}`
    }

    while (true) {
      const line = lines[cursor]

      if (line === undefined) {
        throw new Error(`Failed to find line starting with: ${matchString}`)
      }

      if (!line.trimStart().toLowerCase().startsWith(matchString)) {
        cursor += 1
      }
      else {
        statementLineIndexes.push(cursor)

        cursor += 1
        break
      }
    }
  }

  const results: string[] = []

  for (let i = 0; i < statementLineIndexes.length; i++) {
    const start = statementLineIndexes[i]
    const end = statementLineIndexes[i + 1]

    const stmtLines = lines.slice(start, end)
    results.push(stmtLines.join('\n').trim())
  }

  return results
}
