import { QualifiedTablename } from './tablename'
import { DbNamespace } from './types'

import sqliteParser from 'sqlite-parser'
import { WalkBuilder } from 'walkjs'

const dangerousKeywords = [
  'add',
  'alter',
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

export const parseTableNames = (sqlQuery: string, defaultNamespace: DbNamespace): QualifiedTablename[] => {
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

const _ensureQualified = (candidate: string, defaultNamespace: DbNamespace): string => {
  if (candidate.includes('.')) {
    return candidate
  }

  return `${defaultNamespace}.${candidate}`
}
